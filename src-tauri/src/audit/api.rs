//! Routes API — JSON uniquement, mêmes routes et mêmes réponses que l'ancien serveur Fastify.

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::Path;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde::Serialize;
use serde::ser::SerializeMap;
use serde_json::{Map, Value, json};

use super::chrome::{Navigateur, trouver_navigateur};
use super::config::{DUREE_PAGE_ESTIMEE_MS, LIMITE_DECOUVERTE};
use super::modes::{Capacite, capacite_machine, resoudre_mode};
use super::nombre::parse_int_texte;
use super::rapport::{Moyennes, Progression, calculer_moyennes, calculer_progression, construire_rapport};
use super::store::{RefusSuppression, est_termine};
use super::taches::{self, audit_actif, interrompre_audit, lancer_audit, lancer_decouverte};
use super::validate::{valider_max_pages, valider_selection, valider_url};
use super::{contexte, journal};

/// Objet JSON aux clés dans l'ordre donné (le `Map` de serde_json les trie).
struct Objet(Vec<(&'static str, Value)>);

impl Serialize for Objet {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(self.0.len()))?;
        for (cle, valeur) in &self.0 {
            map.serialize_entry(cle, valeur)?;
        }
        map.end()
    }
}

macro_rules! objet {
    ($($cle:literal : $valeur:expr),* $(,)?) => {
        Objet(vec![$(($cle, json!($valeur))),*])
    };
}

const JSON_UTF8: &str = "application/json; charset=utf-8";

fn repondre(code: StatusCode, corps: &impl Serialize) -> Response {
    match serde_json::to_vec(corps) {
        Ok(octets) => (code, [(header::CONTENT_TYPE, JSON_UTF8)], octets).into_response(),
        Err(e) => {
            journal::erreur(&format!("réponse impossible à sérialiser ({e})"));
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn erreur(code: StatusCode, message: &str) -> Response {
    repondre(code, &objet! { "error": message })
}

/// Erreur au format de Fastify (corps illisible…).
fn erreur_fastify(code: StatusCode, code_interne: &str, message: &str) -> Response {
    repondre(
        code,
        &objet! {
            "statusCode": code.as_u16(),
            "code": code_interne,
            "error": code.canonical_reason().unwrap_or(""),
            "message": message,
        },
    )
}

/// Tout ce que renvoie cette API est un état vivant : jamais servi depuis un cache navigateur.
async fn sans_cache(mut reponse: Response) -> Response {
    reponse.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    reponse
}

pub fn routeur() -> Router {
    Router::new()
        .route("/api/etat", get(etat))
        .route("/api/discover", post(decouvrir))
        .route("/api/discover/{job_id}", get(decouverte))
        .route("/api/audit/{job_id}", post(auditer))
        .route("/api/status/{job_id}", get(statut))
        .route("/api/report/{job_id}", get(rapport))
        .route("/api/report/{job_id}/export", get(exporter))
        .route("/api/jobs", get(historique))
        .route("/api/jobs/{job_id}/cancel", post(annuler))
        .route("/api/jobs/{job_id}", delete(supprimer))
        .fallback(introuvable)
        .method_not_allowed_fallback(introuvable)
        .layer(middleware::map_response(sans_cache))
}

/// Route inconnue : la même réponse que Fastify.
async fn introuvable(methode: Method, uri: Uri) -> Response {
    let chemin = uri.path_and_query().map_or(uri.path(), |p| p.as_str());
    repondre(
        StatusCode::NOT_FOUND,
        &objet! {
            "message": format!("Route {methode}:{chemin} not found"),
            "error": "Not Found",
            "statusCode": 404,
        },
    )
}

/* Helpers de requête */

/// Corps de la requête (JSON ou formulaire HTML), et `true` pour une soumission de formulaire.
fn lire_corps(entetes: &HeaderMap, octets: &Bytes) -> Result<(Map<String, Value>, bool), Response> {
    let type_contenu = entetes
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let media = type_contenu.split(';').next().unwrap_or("").trim().to_string();

    // Fallback sans JavaScript : un <form> natif envoie du x-www-form-urlencoded.
    if type_contenu.contains("application/x-www-form-urlencoded") {
        let mut corps = Map::new();
        for (cle, valeur) in url::form_urlencoded::parse(octets) {
            let valeur = Value::String(valeur.into_owned());
            match corps.get_mut(cle.as_ref()) {
                Some(Value::Array(liste)) => liste.push(valeur),
                Some(ancienne) => *ancienne = Value::Array(vec![ancienne.take(), valeur]),
                None => {
                    corps.insert(cle.into_owned(), valeur);
                }
            }
        }
        return Ok((corps, true));
    }

    if media == "application/json" {
        if octets.is_empty() {
            return Err(erreur_fastify(
                StatusCode::BAD_REQUEST,
                "FST_ERR_CTP_EMPTY_JSON_BODY",
                "Body cannot be empty when content-type is set to 'application/json'",
            ));
        }
        return match serde_json::from_slice::<Value>(octets) {
            Ok(Value::Object(corps)) => Ok((corps, false)),
            Ok(_) => Ok((Map::new(), false)),
            Err(_) => Err(erreur_fastify(
                StatusCode::BAD_REQUEST,
                "FST_ERR_CTP_INVALID_JSON_BODY",
                "Body is not valid JSON but content-type is set to 'application/json'",
            )),
        };
    }

    if octets.is_empty() || media.is_empty() || media == "text/plain" {
        return Ok((Map::new(), false));
    }
    Err(erreur_fastify(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "FST_ERR_CTP_INVALID_MEDIA_TYPE",
        &format!("Unsupported Media Type: {media}"),
    ))
}

/// `None` si l'identifiant n'est pas un entier positif (lu comme `parseInt`).
fn lire_job_id(brut: &str) -> Option<u64> {
    parse_int_texte(brut).filter(|n| *n > 0.0).map(|n| n as u64)
}

fn job_introuvable() -> Response {
    erreur(StatusCode::NOT_FOUND, "Audit introuvable ou supprimé.")
}

/// Identifiant d'un job existant, ou la bonne réponse d'erreur.
fn charger_job(brut: &str) -> Result<u64, Response> {
    let Some(id) = lire_job_id(brut) else {
        return Err(erreur(StatusCode::BAD_REQUEST, "Identifiant de job invalide."));
    };
    match contexte().store.avec_job(id, |_| ()) {
        Some(()) => Ok(id),
        None => Err(job_introuvable()),
    }
}

/* GET /api/etat — le navigateur d'audit est-il disponible ? */

#[derive(Serialize)]
#[serde(untagged)]
enum EtatNavigateur {
    Trouve { trouve: bool, nom: &'static str, chemin: String },
    Absent { trouve: bool, erreur: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Etat {
    navigateur: EtatNavigateur,
    audit_en_cours: Option<u64>,
    // Pages mesurables en même temps (mode rapide), et ce qui la limite : voir modes.rs.
    capacite: Capacite,
    // Gardé pour l'interface : l'application embarque son moteur, jamais « à relancer ».
    redemarrage_necessaire: bool,
}

async fn etat() -> Response {
    // Recherche refaite à chaque appel : l'utilisateur a pu installer Chrome entre-temps.
    let navigateur = match trouver_navigateur() {
        Navigateur::Trouve { nom, chemin, .. } => {
            EtatNavigateur::Trouve { trouve: true, nom, chemin: chemin.display().to_string() }
        }
        Navigateur::Absent { erreur } => EtatNavigateur::Absent { trouve: false, erreur },
    };
    repondre(
        StatusCode::OK,
        &Etat {
            navigateur,
            audit_en_cours: audit_actif(),
            capacite: capacite_machine(),
            redemarrage_necessaire: false,
        },
    )
}

/* POST /api/discover — création du job + découverte des pages */

async fn decouvrir(entetes: HeaderMap, octets: Bytes) -> Response {
    let (corps, formulaire) = match lire_corps(&entetes, &octets) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let url = match valider_url(corps.get("url")) {
        Ok(u) => u,
        Err(e) => return repondre(StatusCode::BAD_REQUEST, &objet! { "error": e, "champ": "url" }),
    };
    let max_pages = valider_max_pages(corps.get("maxPages"));

    let job_id = contexte().store.creer(url.clone(), max_pages);
    journal::info(&format!("audit {job_id} : créé pour {url} ({max_pages} pages au plus)"));
    lancer_decouverte(job_id);

    // Fallback sans JavaScript : un <form> natif ne sait pas lire du JSON.
    if formulaire {
        return Response::builder()
            .status(StatusCode::SEE_OTHER)
            .header(header::LOCATION, format!("/rapport/{job_id}"))
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::SEE_OTHER.into_response());
    }

    repondre(
        StatusCode::CREATED,
        &objet! {
            "jobId": job_id,
            "url": url,
            "maxPages": max_pages,
            "limiteDecouverte": LIMITE_DECOUVERTE,
            "status": "discovering",
        },
    )
}

/* GET /api/discover/:jobId — résultat de la découverte */

async fn decouverte(Path(brut): Path<String>) -> Response {
    let id = match charger_job(&brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    contexte()
        .store
        .avec_job(id, |job| {
            repondre(
                StatusCode::OK,
                &objet! {
                    "jobId": job.id,
                    "targetUrl": job.target_url,
                    "status": job.status,
                    // `true` dès que les pages sont proposées ou l'audit déjà lancé.
                    "ready": job.status != "discovering" && !job.discovered_urls.is_empty(),
                    "sitemapUsed": job.sitemap_used,
                    "discoveredUrls": job.discovered_urls,
                    "maxPages": job.max_pages,
                    "limiteDecouverte": LIMITE_DECOUVERTE,
                    "error": job.error,
                },
            )
        })
        .unwrap_or_else(job_introuvable)
}

/* POST /api/audit/:jobId — validation de la sélection + lancement */

async fn auditer(Path(brut): Path<String>, entetes: HeaderMap, octets: Bytes) -> Response {
    let corps = match lire_corps(&entetes, &octets) {
        Ok((c, _)) => c,
        Err(r) => return r,
    };
    valider_et_lancer(&brut, &corps)
}

/// Partie synchrone du lancement, sous verrou : deux lancements rapprochés ne passent pas tous les deux.
fn valider_et_lancer(brut: &str, corps: &Map<String, Value>) -> Response {
    let _garde = taches::LANCEMENT.lock().unwrap_or_else(|e| e.into_inner());
    let store = &contexte().store;

    let id = match charger_job(brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let Some((status, cible)) = store.avec_job(id, |j| (j.status.clone(), j.target_url.clone())) else {
        return job_introuvable();
    };

    if status != "reviewing" {
        return repondre(
            StatusCode::CONFLICT,
            &objet! { "error": "Cet audit n’est plus en attente de validation.", "status": status },
        );
    }

    // Un seul audit à la fois.
    if let Some(actif) = audit_actif() {
        return repondre(
            StatusCode::CONFLICT,
            &objet! {
                "error": format!("Un audit est déjà en cours (n° {actif}). Attendez sa fin ou arrêtez-le avant d’en lancer un autre."),
                "auditEnCours": actif,
            },
        );
    }

    // Sans navigateur, inutile de lancer quoi que ce soit : message actionnable.
    let nom_navigateur = match trouver_navigateur() {
        Navigateur::Trouve { nom, .. } => nom,
        Navigateur::Absent { erreur } => {
            return repondre(
                StatusCode::SERVICE_UNAVAILABLE,
                &objet! { "error": erreur, "champ": "navigateur" },
            );
        }
    };

    let urls = match valider_selection(corps.get("selectedUrls"), &cible) {
        Ok(u) => u,
        Err(e) => return erreur(StatusCode::BAD_REQUEST, &e),
    };

    // Mode d'audit choisi (économe, rapide, personnalisé) : voir modes.rs.
    let reglages = resoudre_mode(corps.get("mode"), corps.get("simultanes"), urls.len());

    if !store.confirmer_selection(id, urls.clone(), &reglages) {
        // L'état a changé entre la lecture et l'écriture (double clic…).
        return erreur(StatusCode::CONFLICT, "Cet audit n’est plus en attente de validation.");
    }

    // Estimation de départ : la durée d'une page relevée sur les audits déjà faits sur ce poste.
    let duree_page = store.duree_page_historique(reglages.simultanes).unwrap_or(DUREE_PAGE_ESTIMEE_MS as f64);
    store.noter_duree_estimee(id, duree_page);

    lancer_audit(id);
    journal::info(&format!(
        "audit {id} : sélection validée ({} page(s), {nom_navigateur}, mode {}, {} simultanée(s)), audit lancé",
        urls.len(),
        reglages.mode,
        reglages.simultanes
    ));

    let pages = urls.len() as u64;
    repondre(
        StatusCode::OK,
        &objet! {
            "jobId": id,
            "status": "running",
            "pages": pages,
            "selectedUrls": urls,
            "mode": reglages.mode,
            "simultanes": reglages.simultanes,
            // Estimation affichée avant le premier résultat mesuré.
            "dureeEstimeeMs": pages.div_ceil(reglages.simultanes) * duree_page.round() as u64,
        },
    )
}

/* GET /api/status/:jobId — avancement en direct */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Statut<'a> {
    job_id: u64,
    target_url: &'a str,
    status: &'a str,
    current_url: Option<&'a str>,
    // Toutes les pages en cours de mesure (plusieurs en mode rapide ou personnalisé).
    current_urls: Vec<&'a str>,
    mode: &'a str,
    simultanes: u64,
    sitemap_used: Option<bool>,
    // `processedPages` inclut les pages en erreur ; `errorPages` les isole.
    processed_pages: u64,
    error_pages: usize,
    total_pages: u64,
    cancel_requested: bool,
    finished: bool,
    error: Option<&'a str>,
    progression: Progression,
    created_at: Option<&'a str>,
    started_at: Option<&'a str>,
    audit_started_at: Option<&'a str>,
    finished_at: Option<&'a str>,
}

async fn statut(Path(brut): Path<String>) -> Response {
    let id = match charger_job(&brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    contexte()
        .store
        .avec_job(id, |job| {
            let mut current_urls: Vec<&str> = job.current_urls.iter().map(String::as_str).collect();
            if current_urls.is_empty()
                && let Some(u) = job.current_url.as_deref()
            {
                current_urls.push(u);
            }
            repondre(
                StatusCode::OK,
                &Statut {
                    job_id: job.id,
                    target_url: &job.target_url,
                    status: &job.status,
                    current_url: job.current_url.as_deref(),
                    current_urls,
                    mode: job.mode.as_deref().unwrap_or("personnalise"),
                    simultanes: job.simultanes.unwrap_or(1),
                    sitemap_used: job.sitemap_used,
                    processed_pages: job.processed_pages,
                    error_pages: job.pages_en_erreur(),
                    total_pages: job.total_pages,
                    cancel_requested: job.cancel_requested,
                    finished: est_termine(&job.status),
                    error: job.error.as_deref(),
                    progression: calculer_progression(job),
                    created_at: job.created_at.as_deref(),
                    started_at: job.started_at.as_deref(),
                    audit_started_at: job.audit_started_at.as_deref(),
                    finished_at: job.finished_at.as_deref(),
                },
            )
        })
        .unwrap_or_else(job_introuvable)
}

/* GET /api/report/:jobId — rapport complet */

async fn rapport(Path(brut): Path<String>) -> Response {
    let id = match charger_job(&brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    contexte()
        .store
        .avec_job(id, |job| repondre(StatusCode::OK, &construire_rapport(job)))
        .unwrap_or_else(job_introuvable)
}

/* GET /api/report/:jobId/export — rapport à télécharger */

async fn exporter(Path(brut): Path<String>) -> Response {
    let id = match charger_job(&brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    contexte()
        .store
        .avec_job(id, |job| {
            let hote = url::Url::parse(&job.target_url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_string))
                .map(|h| {
                    h.chars()
                        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
                        .collect::<String>()
                })
                .unwrap_or_else(|| "site".into());
            let jour: String = job.created_at.as_deref().unwrap_or("").chars().take(10).collect();
            let suffixe = if jour.is_empty() { String::new() } else { format!("-{jour}") };
            let nom = format!("attachment; filename=\"eco-audit-{}-{hote}{suffixe}.json\"", job.id);

            let texte = match serde_json::to_string_pretty(&construire_rapport(job)) {
                Ok(t) => t,
                Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
            let mut reponse = (StatusCode::OK, [(header::CONTENT_TYPE, JSON_UTF8)], texte).into_response();
            if let Ok(valeur) = HeaderValue::from_str(&nom) {
                reponse.headers_mut().insert(header::CONTENT_DISPOSITION, valeur);
            }
            reponse
        })
        .unwrap_or_else(job_introuvable)
}

/* GET /api/jobs — historique : tous les audits enregistrés */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntreeHistorique {
    job_id: u64,
    target_url: String,
    status: String,
    created_at: Option<String>,
    processed_pages: u64,
    error_pages: usize,
    averages: Moyennes,
}

#[derive(Serialize)]
struct Historique {
    jobs: Vec<EntreeHistorique>,
}

async fn historique() -> Response {
    let jobs = contexte().store.lister(|job| EntreeHistorique {
        job_id: job.id,
        target_url: job.target_url.clone(),
        status: job.status.clone(),
        created_at: job.created_at.clone(),
        processed_pages: job.processed_pages,
        error_pages: job.pages_en_erreur(),
        averages: calculer_moyennes(&job.pages.iter().collect::<Vec<_>>()),
    });
    repondre(StatusCode::OK, &Historique { jobs })
}

/* POST /api/jobs/:jobId/cancel — arrêt immédiat */

async fn annuler(Path(brut): Path<String>) -> Response {
    let id = match charger_job(&brut) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let store = &contexte().store;
    let status = store.avec_job(id, |j| j.status.clone()).unwrap_or_default();

    if !store.demander_arret(id) {
        return repondre(
            StatusCode::CONFLICT,
            &objet! { "error": "Cet audit est déjà terminé.", "status": status },
        );
    }

    // Chrome est tué tout de suite : la page en cours est abandonnée, les pages déjà auditées
    // restent.
    interrompre_audit(id);
    journal::info(&format!("audit {id} : arrêt demandé par l’utilisateur"));

    repondre(StatusCode::OK, &objet! { "jobId": id, "cancelRequested": true })
}

/* DELETE /api/jobs/:jobId — suppression */

async fn supprimer(Path(brut): Path<String>) -> Response {
    let Some(id) = lire_job_id(&brut) else {
        return erreur(StatusCode::BAD_REQUEST, "Identifiant de job invalide.");
    };

    match contexte().store.supprimer(id) {
        Err(RefusSuppression::Introuvable) => {
            erreur(StatusCode::NOT_FOUND, "Audit introuvable ou déjà supprimé.")
        }
        // Un audit en cours produit encore des écritures : le supprimer ferait travailler la tâche
        // sur un job disparu.
        Err(RefusSuppression::EnCours(status)) => repondre(
            StatusCode::CONFLICT,
            &objet! {
                "error": "Cet audit est en cours : arrêtez-le d’abord, puis réessayez.",
                "status": status,
            },
        ),
        Ok(()) => {
            journal::info(&format!("audit {id} : supprimé à la demande"));
            repondre(StatusCode::OK, &objet! { "jobId": id, "deleted": true })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiant_comme_parseint() {
        assert_eq!(lire_job_id("12"), Some(12));
        assert_eq!(lire_job_id("12abc"), Some(12));
        assert_eq!(lire_job_id("0"), None);
        assert_eq!(lire_job_id("-3"), None);
        assert_eq!(lire_job_id("abc"), None);
    }

    #[test]
    fn objet_dans_l_ordre() {
        let o = objet! { "error": "x", "champ": "url", "auditEnCours": 3 };
        assert_eq!(serde_json::to_string(&o).unwrap(), r#"{"error":"x","champ":"url","auditEnCours":3}"#);
    }

    #[test]
    fn corps_formulaire_et_json() {
        let mut entetes = HeaderMap::new();
        entetes.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/x-www-form-urlencoded"));
        let (corps, formulaire) = lire_corps(&entetes, &Bytes::from_static(b"url=ex.fr&maxPages=10")).unwrap();
        assert!(formulaire);
        assert_eq!(corps.get("maxPages"), Some(&json!("10")));

        entetes.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        assert!(lire_corps(&entetes, &Bytes::from_static(b"{nope")).is_err());
        let (corps, formulaire) = lire_corps(&entetes, &Bytes::from_static(br#"{"url":"a"}"#)).unwrap();
        assert!(!formulaire && corps.get("url") == Some(&json!("a")));
        assert!(lire_corps(&HeaderMap::new(), &Bytes::new()).unwrap().0.is_empty());
    }
}
