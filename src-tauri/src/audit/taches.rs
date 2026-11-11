//! Tâches de fond : découverte des pages, puis audits Lighthouse par une équipe de processus.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::json;

use super::chrome::{Navigateur, trouver_navigateur};
use super::config::{LIMITE_DECOUVERTE, RUN_TIMEOUT_MS};
use super::processus::{Controle, Evenement, Membre};
use super::store::NouvellePage;
use super::{contexte, ecoindex, journal};

// Délai de garde d'une page : ses deux runs (bureau + mobile) ont chacun leur propre timeout dans
// le processus de mesure ; au-delà, c'est le processus lui-même qui ne répond plus.
const GARDE_PAGE: Duration = Duration::from_millis(2 * RUN_TIMEOUT_MS + 60_000);

/// Attente maximale d'une fermeture propre avant de tuer un processus de mesure.
const DELAI_FERMETURE: Duration = Duration::from_secs(15);

/// Délai accordé au processus pour annoncer qu'il est prêt.
const DELAI_DEMARRAGE: Duration = Duration::from_secs(30);

/// Audit en cours : son job et les processus de son équipe.
pub struct Reservation {
    job_id: u64,
    equipe: Mutex<HashMap<u64, Arc<Controle>>>,
    compteur: AtomicU64,
}

impl Reservation {
    fn membres(&self) -> Vec<Arc<Controle>> {
        verrou(&self.equipe).values().cloned().collect()
    }
}

static AUDIT: Mutex<Option<Arc<Reservation>>> = Mutex::new(None);

/// Passe à `true` à l'arrêt de l'application : plus aucune page n'est lancée.
static ARRET: AtomicBool = AtomicBool::new(false);

/// Sérialise « audit déjà en cours ? » → lancement (les requêtes arrivent sur plusieurs threads).
pub static LANCEMENT: Mutex<()> = Mutex::new(());

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Identifiant de l'audit en cours, ou `None`.
pub fn audit_actif() -> Option<u64> {
    verrou(&AUDIT).as_ref().map(|r| r.job_id)
}

fn toujours_actif(reservation: &Arc<Reservation>) -> bool {
    verrou(&AUDIT).as_ref().is_some_and(|r| Arc::ptr_eq(r, reservation))
}

/// Doit-on s'arrêter avant la page suivante ?
fn doit_arreter(job_id: u64) -> bool {
    ARRET.load(Ordering::SeqCst) || contexte().store.annulation_demandee(job_id)
}

/// Message d'une tâche qui a paniqué.
fn message_panique(erreur: tokio::task::JoinError) -> String {
    if let Ok(charge) = erreur.try_into_panic() {
        if let Some(s) = charge.downcast_ref::<&str>() {
            return (*s).to_string();
        }
        if let Some(s) = charge.downcast_ref::<String>() {
            return s.clone();
        }
    }
    "erreur inattendue".to_string()
}

/* Phase 1 — découverte des pages */

/// Lance la découverte en arrière-plan.
pub fn lancer_decouverte(job_id: u64) {
    tokio::spawn(async move {
        // Filet de sécurité : une découverte qui panique ne laisse pas le job bloqué.
        if let Err(e) = tokio::spawn(executer_decouverte(job_id)).await {
            let message = message_panique(e);
            journal::erreur(&format!("audit {job_id} : erreur inattendue pendant la découverte ({message})"));
            contexte().store.echouer(job_id, &message);
        }
    });
}

/// Cherche les pages du site et rend la main à l'utilisateur.
async fn executer_decouverte(job_id: u64) {
    let store = &contexte().store;
    let Some((cible, max_pages)) = store.avec_job(job_id, |j| (j.target_url.clone(), j.max_pages)) else {
        return;
    };

    journal::info(&format!("audit {job_id} : découverte des pages de {cible}"));

    // Le garde-fou s'applique même si le fichier contenait une valeur plus élevée.
    let limite = max_pages.min(LIMITE_DECOUVERTE) as usize;

    let decouverte = match crate::decouverte::decouvrir(&cible, limite).await {
        Ok(d) => d,
        Err(e) => {
            store.echouer(job_id, &format!("Découverte impossible : {e}"));
            journal::avert(&format!("audit {job_id} : échec de la découverte ({e})"));
            return;
        }
    };

    // L'utilisateur a pu demander l'arrêt pendant la découverte.
    if store.annulation_demandee(job_id) {
        store.arreter(job_id);
        journal::info(&format!("audit {job_id} : arrêt demandé pendant la découverte"));
        return;
    }

    if decouverte.urls.is_empty() {
        store.echouer(
            job_id,
            "Aucune page trouvée (site injoignable ou entièrement interdit par robots.txt).",
        );
        journal::info(&format!("audit {job_id} : aucune page trouvée"));
        return;
    }

    let nombre = decouverte.urls.len();
    let source = if decouverte.sitemap_utilise { "sitemap" } else { "crawl" };
    store.decouverte_terminee(job_id, decouverte.sitemap_utilise, decouverte.urls);
    journal::info(&format!(
        "audit {job_id} : {nombre} page(s) proposée(s) ({source}), en attente de validation"
    ));
}

/* Phase 2 — audits Lighthouse, par une équipe de processus */

/// Lance l'audit en arrière-plan (appelé sous `LANCEMENT`, après vérification qu'aucun ne tourne).
pub fn lancer_audit(job_id: u64) {
    let reservation = Arc::new(Reservation {
        job_id,
        equipe: Mutex::new(HashMap::new()),
        compteur: AtomicU64::new(0),
    });
    *verrou(&AUDIT) = Some(reservation.clone());

    tokio::spawn(async move {
        if let Err(e) = tokio::spawn(executer_audit(job_id, reservation.clone())).await {
            let message = message_panique(e);
            journal::erreur(&format!("audit {job_id} : erreur inattendue pendant l’audit ({message})"));
            for membre in reservation.membres() {
                membre.tuer();
            }
            contexte().store.echouer(job_id, &message);
        }
        let mut actif = verrou(&AUDIT);
        if actif.as_ref().is_some_and(|r| Arc::ptr_eq(r, &reservation)) {
            *actif = None;
        }
    });
}

// Arrêt immédiat de l'audit en cours : chaque processus tue son Chrome, ce qui fait échouer sans
// attendre les runs Lighthouse en cours.
pub fn interrompre_audit(job_id: u64) {
    let Some(reservation) = verrou(&AUDIT).clone() else { return };
    if reservation.job_id != job_id {
        return;
    }
    for membre in reservation.membres() {
        arreter_membre(membre);
    }
}

// Demande à un processus de s'arrêter tout de suite (il tue son Chrome et nettoie son profil
// temporaire), puis le tue s'il n'est pas sorti à temps.
fn arreter_membre(membre: Arc<Controle>) {
    if membre.est_sorti() {
        return;
    }
    membre.envoyer_type("arreter");
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        membre.tuer();
    });
}

/// État partagé par l'équipe d'un audit.
struct Equipe<'a> {
    job_id: u64,
    urls: &'a [String],
    chrome: std::path::PathBuf,
    priorite_basse: bool,
    reservation: &'a Reservation,
    a_faire: Mutex<VecDeque<String>>,
    en_cours: Mutex<HashSet<String>>,
    echec: Mutex<Option<String>>,
}

impl Equipe<'_> {
    fn maj_en_cours(&self) {
        let en_cours = verrou(&self.en_cours);
        let urls = self.urls.iter().filter(|u| en_cours.contains(*u)).cloned().collect();
        drop(en_cours);
        contexte().store.pages_en_cours(self.job_id, urls);
    }

    fn noter_echec(&self, message: &str, remplacer: bool) {
        let mut echec = verrou(&self.echec);
        if remplacer || echec.is_none() {
            *echec = Some(message.to_string());
        }
    }
}

// Audite les pages retenues par l'utilisateur, avec `simultanes` processus en parallèle (1 en mode
// économe).
async fn executer_audit(job_id: u64, reservation: Arc<Reservation>) {
    let store = &contexte().store;
    let lu = store.avec_job(job_id, |j| {
        (j.selected_urls.clone(), j.simultanes, j.mode.clone(), j.priorite_basse.unwrap_or(false))
    });
    let Some((urls, simultanes, mode, priorite_basse)) = lu else { return };

    if urls.is_empty() {
        store.echouer(job_id, "Aucune page sélectionnée pour l’audit.");
        return;
    }

    let chrome = match trouver_navigateur() {
        Navigateur::Trouve { chemin, .. } => chemin,
        Navigateur::Absent { erreur } => {
            store.echouer(job_id, &erreur);
            journal::erreur(&format!("audit {job_id} : échec de l’audit ({erreur})"));
            return;
        }
    };

    let simultanes = (simultanes.filter(|n| *n > 0).unwrap_or(1) as usize).min(urls.len()).max(1);
    journal::info(&format!(
        "audit {job_id} : démarré ({} page(s), mode {}, {simultanes} simultanée(s){})",
        urls.len(),
        mode.as_deref().unwrap_or("personnalise"),
        if priorite_basse { ", priorité basse" } else { "" }
    ));

    let equipe = Equipe {
        job_id,
        urls: &urls,
        chrome,
        priorite_basse,
        reservation: &reservation,
        a_faire: Mutex::new(urls.iter().cloned().collect()),
        en_cours: Mutex::new(HashSet::new()),
        echec: Mutex::new(None),
    };

    futures_util::future::join_all((0..simultanes).map(|rang| membre_d_equipe(&equipe, rang))).await;

    let echec = verrou(&equipe.echec).take();
    match echec {
        Some(e) if !doit_arreter(job_id) => {
            // Chrome introuvable ou impossible à démarrer : l'audit ne peut pas continuer.
            store.echouer(job_id, &e);
            journal::erreur(&format!("audit {job_id} : échec de l’audit ({e})"));
        }
        _ if doit_arreter(job_id) => {
            store.arreter(job_id);
            let conservees = store.avec_job(job_id, |j| j.processed_pages).unwrap_or(0);
            journal::info(&format!("audit {job_id} : arrêté ({conservees} page(s) conservée(s))"));
        }
        _ => {
            store.terminer(job_id);
            journal::info(&format!("audit {job_id} : terminé"));
        }
    }
}

/// Un membre de l'équipe : un processus de mesure, remplacé s'il cesse de répondre.
async fn membre_d_equipe(equipe: &Equipe<'_>, rang: usize) {
    let ctx = contexte();
    loop {
        if doit_arreter(equipe.job_id) {
            return;
        }

        let mut membre = match Membre::lancer(
            &ctx.node,
            &ctx.dossier_mesure,
            &equipe.chrome,
            equipe.priorite_basse,
            rang,
        ) {
            Ok(m) => m,
            Err(e) => {
                journal::erreur(&format!("processus de mesure impossible à lancer ({e})"));
                equipe.noter_echec("Un processus d’audit n’a pas pu démarrer.", false);
                return;
            }
        };
        let cle = equipe.reservation.compteur.fetch_add(1, Ordering::SeqCst);
        verrou(&equipe.reservation.equipe).insert(cle, membre.controle.clone());

        let remplacer = mesurer(equipe, &mut membre, rang).await;

        // Fermeture propre (Chrome et son profil temporaire), sinon de force.
        if !membre.controle.est_sorti() {
            let fin = if doit_arreter(equipe.job_id) { "arreter" } else { "terminer" };
            membre.controle.envoyer_type(fin);
            if !membre.attendre_sortie(DELAI_FERMETURE).await {
                membre.controle.tuer();
            }
        }
        verrou(&equipe.reservation.equipe).remove(&cle);

        if !remplacer {
            return;
        }
    }
}

/// Confie des pages au processus jusqu'à épuisement ; `true` s'il faut le remplacer.
async fn mesurer(equipe: &Equipe<'_>, membre: &mut Membre, rang: usize) -> bool {
    let store = &contexte().store;
    let job_id = equipe.job_id;

    if !matches!(membre.attendre(DELAI_DEMARRAGE).await, Evenement::Pret) {
        equipe.noter_echec("Un processus d’audit n’a pas pu démarrer.", false);
        return false;
    }

    loop {
        if verrou(&equipe.echec).is_some() || doit_arreter(job_id) {
            return false;
        }
        let Some(url) = verrou(&equipe.a_faire).pop_front() else {
            return false;
        };

        verrou(&equipe.en_cours).insert(url.clone());
        equipe.maj_en_cours();
        let numero = equipe.urls.iter().position(|u| *u == url).map_or(0, |i| i + 1);
        journal::info(&format!(
            "audit {job_id} (processus {}) : page {numero}/{} - {url}",
            rang + 1,
            equipe.urls.len()
        ));

        membre.controle.envoyer(json!({ "type": "auditer", "url": url }));
        let reponse = membre.attendre(GARDE_PAGE).await;

        verrou(&equipe.en_cours).remove(&url);
        equipe.maj_en_cours();

        // Arrêt pendant la page : Chrome a été tué en plein run, le résultat est incomplet.
        if doit_arreter(job_id) {
            return false;
        }

        let cause = match reponse {
            Evenement::Echec(message) => {
                equipe.noter_echec(&message, true);
                return false;
            }
            Evenement::Resultat(r) => {
                let r = *r;
                if r.status == "error" {
                    journal::avert(&format!(
                        "audit {job_id} : page en erreur {url} ({})",
                        r.error.as_deref().unwrap_or("")
                    ));
                }
                store.enregistrer_page(
                    job_id,
                    NouvellePage {
                        url: r.url,
                        status: r.status,
                        desktop_scores: r.desktop_scores,
                        mobile_scores: r.mobile_scores,
                        desktop_recommandations: r.desktop_recommandations,
                        mobile_recommandations: r.mobile_recommandations,
                        // L'éco-index est calculé ici, à partir des mesures brutes du run bureau.
                        ecoindex: r.mesures.as_ref().map(ecoindex::construire),
                        error: r.error,
                        duration_ms: r.duration_ms,
                    },
                );
                continue;
            }
            Evenement::Delai => "delai",
            Evenement::Sorti | Evenement::Pret => "sorti",
        };

        // Processus sorti ou muet au-delà du délai de garde : la page est comptée en erreur, et le
        // processus remplacé pour la suite.
        store.enregistrer_page(
            job_id,
            NouvellePage {
                url: url.clone(),
                status: "error".into(),
                error: Some(if cause == "delai" {
                    "Le processus d’audit ne répondait plus : page abandonnée.".into()
                } else {
                    "Le processus d’audit s’est arrêté pendant la mesure.".into()
                }),
                ..NouvellePage::default()
            },
        );
        journal::avert(&format!("audit {job_id} : processus de mesure remplacé ({cause}) après {url}"));
        membre.controle.tuer();
        return true;
    }
}

/* Arrêt de l'application */

// Arrêt synchrone : chaque processus tue son Chrome tout de suite, l'audit passe en `stopped` avec
// ses pages déjà auditées ; au-delà de quelques secondes, tout est tué de force.
pub fn arreter_taches() {
    ARRET.store(true, Ordering::SeqCst);

    let Some(reservation) = verrou(&AUDIT).clone() else { return };
    for membre in reservation.membres() {
        membre.envoyer_type("arreter");
    }

    let attendre = |delai: Duration| {
        let fin = Instant::now() + delai;
        while toujours_actif(&reservation) && Instant::now() < fin {
            std::thread::sleep(Duration::from_millis(50));
        }
    };

    attendre(Duration::from_secs(5));
    if toujours_actif(&reservation) {
        for membre in reservation.membres() {
            membre.tuer();
        }
        attendre(Duration::from_millis(1500));
    }

    // Dernier filet : aucun processus ni Chrome ne survit, et l'état final est écrit.
    for membre in reservation.membres() {
        membre.tuer();
    }
    if toujours_actif(&reservation) {
        let store = &contexte().store;
        if store.avec_job(reservation.job_id, |j| j.status == "running").unwrap_or(false) {
            store.arreter(reservation.job_id);
        }
    }
}
