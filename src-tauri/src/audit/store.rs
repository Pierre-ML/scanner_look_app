//! Stockage des audits : en mémoire, recopié sur disque (un JSON par audit) à chaque changement.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::ecoindex::EcoIndex;
use super::journal;
use super::modes::ReglagesMode;
use super::nombre::Nombre;

/// États depuis lesquels un job ne bougera plus tout seul.
pub const ETATS_TERMINES: [&str; 3] = ["done", "stopped", "error"];

pub fn est_termine(status: &str) -> bool {
    ETATS_TERMINES.contains(&status)
}

/// Les 4 scores Lighthouse d'un run, sur 100.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scores {
    pub performance: Option<Nombre>,
    pub accessibility: Option<Nombre>,
    pub best_practices: Option<Nombre>,
    pub seo: Option<Nombre>,
}

/// Point en échec relevé par Lighthouse, texte d'origine.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Recommandation {
    pub id: String,
    pub categorie: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub titre: Option<String>,
    pub description: String,
    pub valeur: Option<String>,
    pub score: Nombre,
    pub poids: Nombre,
    pub elements: Vec<String>,
}

/// Résultat enregistré d'une page.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Page {
    pub id: u64,
    pub url: String,
    pub status: String,
    pub desktop_scores: Option<Scores>,
    pub mobile_scores: Option<Scores>,
    pub desktop_recommandations: Option<Vec<Recommandation>>,
    pub mobile_recommandations: Option<Vec<Recommandation>>,
    pub ecoindex: Option<EcoIndex>,
    pub error: Option<String>,
    pub duration_ms: Option<Nombre>,
    pub audited_at: Option<String>,
    /// Champs inconnus (fichier modifié à la main…) : conservés tels quels.
    #[serde(flatten)]
    pub autres: Map<String, Value>,
}

/// Page mesurée, avant enregistrement.
#[derive(Clone, Debug, Default)]
pub struct NouvellePage {
    pub url: String,
    pub status: String,
    pub desktop_scores: Option<Scores>,
    pub mobile_scores: Option<Scores>,
    pub desktop_recommandations: Option<Vec<Recommandation>>,
    pub mobile_recommandations: Option<Vec<Recommandation>>,
    pub ecoindex: Option<EcoIndex>,
    pub error: Option<String>,
    pub duration_ms: Option<f64>,
}

/// Un audit, tel qu'enregistré dans `<id>.json` (même ordre de champs que le serveur Node).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Job {
    pub id: u64,
    pub target_url: String,
    pub max_pages: u64,
    pub status: String,
    // true = pages issues d'un sitemap, false = crawl, null = pas encore découvert
    pub sitemap_used: Option<bool>,
    pub discovered_urls: Vec<String>,
    pub selected_urls: Vec<String>,
    pub total_pages: u64,
    pub processed_pages: u64,
    pub current_url: Option<String>,
    pub current_urls: Vec<String>,
    pub cancel_requested: bool,
    pub error: Option<String>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub audit_started_at: Option<String>,
    pub finished_at: Option<String>,
    pub pages: Vec<Page>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simultanes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priorite_basse: Option<bool>,
    #[serde(flatten)]
    pub autres: Map<String, Value>,
}

impl Job {
    /// Nombre de pages terminées en erreur.
    pub fn pages_en_erreur(&self) -> usize {
        self.pages.iter().filter(|p| p.status == "error").count()
    }
}

/// Raison d'un refus de suppression.
pub enum RefusSuppression {
    Introuvable,
    EnCours(String),
}

struct Interne {
    jobs: HashMap<u64, Job>,
    prochain_id: u64,
}

/// Les audits : id → job, et le dossier où ils sont recopiés.
pub struct Store {
    dossier: PathBuf,
    interne: Mutex<Interne>,
}

/// Date ISO 8601 en UTC, à la milliseconde (`new Date().toISOString()`).
pub fn horodatage(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);
    let ms = d.as_millis() as i64;
    let jours = ms.div_euclid(86_400_000);
    let reste = ms.rem_euclid(86_400_000);

    // Conversion jours → date civile (algorithme de H. Hinnant).
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let jde = z - ere * 146_097;
    let ade = (jde - jde / 1460 + jde / 36_524 - jde / 146_096) / 365;
    let jda = jde - (365 * ade + ade / 4 - ade / 100);
    let mp = (5 * jda + 2) / 153;
    let jour = jda - (153 * mp + 2) / 5 + 1;
    let mois = if mp < 10 { mp + 3 } else { mp - 9 };
    let annee = ade + ere * 400 + i64::from(mois <= 2);

    format!(
        "{annee:04}-{mois:02}-{jour:02}T{:02}:{:02}:{:02}.{:03}Z",
        reste / 3_600_000,
        reste / 60_000 % 60,
        reste / 1000 % 60,
        reste % 1000
    )
}

fn maintenant() -> String {
    horodatage(SystemTime::now())
}

/// `String(message).slice(0, 1000)` : coupe à 1000 unités UTF-16.
fn couper(message: &str, max: usize) -> String {
    let mut unites = 0;
    let mut fin = message.len();
    for (i, c) in message.char_indices() {
        unites += c.len_utf16();
        if unites > max {
            fin = i;
            break;
        }
    }
    message[..fin].to_string()
}

impl Store {
    pub fn new(dossier: PathBuf) -> Self {
        Store { dossier, interne: Mutex::new(Interne { jobs: HashMap::new(), prochain_id: 1 }) }
    }

    pub fn dossier(&self) -> &Path {
        &self.dossier
    }

    fn verrou(&self) -> std::sync::MutexGuard<'_, Interne> {
        self.interne.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn chemin_job(&self, id: u64) -> PathBuf {
        self.dossier.join(format!("{id}.json"))
    }

    /// Écrit le job sur disque (fichier temporaire puis renommage).
    fn enregistrer(&self, job: &Job) {
        if let Err(e) = self.ecrire(job) {
            journal::erreur(&format!("audit {} : écriture impossible ({e})", job.id));
        }
    }

    fn ecrire(&self, job: &Job) -> std::io::Result<()> {
        let cible = self.chemin_job(job.id);
        let temporaire = self.dossier.join(format!("{}.json.tmp", job.id));
        let texte = serde_json::to_string_pretty(job).map_err(std::io::Error::other)?;
        std::fs::write(&temporaire, texte)?;

        let mut essai = 0;
        loop {
            match std::fs::rename(&temporaire, &cible) {
                Ok(()) => return Ok(()),
                // Fichier lu au même moment (antivirus, indexation) : on réessaie un peu plus tard.
                Err(e) if essai < 4 && matches!(e.kind(), ErrorKind::PermissionDenied | ErrorKind::ResourceBusy) => {
                    std::thread::sleep(Duration::from_millis(50 * (essai + 1)));
                    essai += 1;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// Applique une modification à un job existant, puis l'enregistre.
    fn modifier(&self, id: u64, changer: impl FnOnce(&mut Job)) -> bool {
        let mut interne = self.verrou();
        let Some(job) = interne.jobs.get_mut(&id) else {
            return false;
        };
        changer(job);
        self.enregistrer(job);
        true
    }

    /// Charge les audits enregistrés ; renvoie le nombre d'audits interrompus remis en ordre.
    pub fn charger(&self) -> std::io::Result<usize> {
        std::fs::create_dir_all(&self.dossier)?;
        let mut interne = self.verrou();
        let mut interrompus = 0;

        for entree in std::fs::read_dir(&self.dossier)?.flatten() {
            let nom = entree.file_name().to_string_lossy().into_owned();
            let Some(base) = nom.strip_suffix(".json") else { continue };
            if base.is_empty() || !base.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }

            // Fichier illisible (modifié à la main…) : ignoré, jamais supprimé.
            let Ok(texte) = std::fs::read_to_string(entree.path()) else { continue };
            let Ok(valeur) = serde_json::from_str::<Value>(&texte) else { continue };
            if !valeur.get("id").and_then(Value::as_u64).is_some_and(|id| id > 0) {
                continue;
            }
            let Ok(mut job) = serde_json::from_value::<Job>(valeur) else {
                journal::avert(&format!("{nom} : format inattendu, audit ignoré"));
                continue;
            };

            interne.prochain_id = interne.prochain_id.max(job.id + 1);

            if !est_termine(&job.status) {
                let garde = job.processed_pages > 0;
                job.status = if garde { "stopped" } else { "error" }.into();
                job.error = (!garde)
                    .then(|| "Audit interrompu : le serveur a été arrêté pendant le traitement.".into());
                job.current_url = None;
                job.current_urls = Vec::new();
                if job.finished_at.as_deref().is_none_or(str::is_empty) {
                    job.finished_at = Some(maintenant());
                }
                self.enregistrer(&job);
                interrompus += 1;
            }
            interne.jobs.insert(job.id, job);
        }

        Ok(interrompus)
    }

    /* Lectures */

    /// Lit un job sans le copier.
    pub fn avec_job<R>(&self, id: u64, lire: impl FnOnce(&Job) -> R) -> Option<R> {
        self.verrou().jobs.get(&id).map(lire)
    }

    /// Tous les audits, du plus récent au plus ancien.
    pub fn lister<R>(&self, mut lire: impl FnMut(&Job) -> R) -> Vec<R> {
        let interne = self.verrou();
        let mut jobs: Vec<&Job> = interne.jobs.values().collect();
        jobs.sort_by(|a, b| b.id.cmp(&a.id));
        jobs.into_iter().map(&mut lire).collect()
    }

    /// Drapeau d'annulation ; un job disparu (supprimé pendant l'audit) compte comme annulé.
    pub fn annulation_demandee(&self, id: u64) -> bool {
        self.verrou().jobs.get(&id).is_none_or(|j| j.cancel_requested)
    }

    /* Écritures */

    /// Crée un job.
    pub fn creer(&self, target_url: String, max_pages: u64) -> u64 {
        let mut interne = self.verrou();
        let id = interne.prochain_id;
        interne.prochain_id += 1;
        let job = Job {
            id,
            target_url,
            max_pages,
            status: "discovering".into(),
            created_at: Some(maintenant()),
            started_at: Some(maintenant()),
            ..Job::default()
        };
        self.enregistrer(&job);
        interne.jobs.insert(id, job);
        id
    }

    /// Enregistre le résultat de la découverte et passe la main à l'utilisateur.
    pub fn decouverte_terminee(&self, id: u64, sitemap_used: bool, urls: Vec<String>) {
        let mut interne = self.verrou();
        let Some(job) = interne.jobs.get_mut(&id) else { return };
        if job.status != "discovering" {
            return;
        }
        job.sitemap_used = Some(sitemap_used);
        job.total_pages = urls.len() as u64;
        job.discovered_urls = urls;
        job.status = "reviewing".into();
        self.enregistrer(job);
    }

    /// Fige la sélection de l'utilisateur et passe le job en `running`.
    pub fn confirmer_selection(&self, id: u64, urls: Vec<String>, reglages: &ReglagesMode) -> bool {
        let mut interne = self.verrou();
        let Some(job) = interne.jobs.get_mut(&id) else { return false };
        if job.status != "reviewing" {
            return false;
        }
        job.total_pages = urls.len() as u64;
        job.selected_urls = urls;
        job.status = "running".into();
        job.audit_started_at = Some(maintenant());
        job.mode = Some(reglages.mode.clone());
        job.simultanes = Some(reglages.simultanes);
        job.priorite_basse = Some(reglages.priorite_basse);
        self.enregistrer(job);
        true
    }

    /// Demande l'arrêt d'un job ; `false` s'il est introuvable ou déjà terminé.
    pub fn demander_arret(&self, id: u64) -> bool {
        let mut interne = self.verrou();
        let Some(job) = interne.jobs.get_mut(&id) else { return false };
        if est_termine(&job.status) {
            return false;
        }
        job.cancel_requested = true;
        if job.status == "reviewing" {
            job.status = "stopped".into();
            job.current_url = None;
            job.current_urls = Vec::new();
            job.finished_at = Some(maintenant());
        }
        self.enregistrer(job);
        true
    }

    /// Pages en cours de mesure (plusieurs en mode parallèle), affichées en direct.
    pub fn pages_en_cours(&self, id: u64, urls: Vec<String>) {
        self.modifier(id, |job| {
            // `currentUrl` (la première) reste servie pour les clients qui n'en lisent qu'une.
            job.current_url = urls.first().cloned();
            job.current_urls = urls;
        });
    }

    /// Ajoute le résultat d'une page et met le compteur à jour dans la même écriture.
    pub fn enregistrer_page(&self, id: u64, page: NouvellePage) {
        self.modifier(id, |job| {
            job.pages.push(Page {
                id: job.pages.len() as u64 + 1,
                url: page.url,
                status: page.status,
                desktop_scores: page.desktop_scores,
                mobile_scores: page.mobile_scores,
                desktop_recommandations: page.desktop_recommandations,
                mobile_recommandations: page.mobile_recommandations,
                ecoindex: page.ecoindex,
                error: page.error.filter(|e| !e.is_empty()),
                duration_ms: page.duration_ms.filter(|d| *d != 0.0 && !d.is_nan()).map(Nombre),
                audited_at: Some(maintenant()),
                autres: Map::new(),
            });
            job.processed_pages = job.pages.len() as u64;
        });
    }

    fn clore(&self, id: u64, status: &str, erreur: Option<String>) {
        self.modifier(id, |job| {
            job.status = status.into();
            if let Some(e) = erreur {
                job.error = Some(e);
            }
            job.current_url = None;
            job.current_urls = Vec::new();
            job.finished_at = Some(maintenant());
        });
    }

    pub fn terminer(&self, id: u64) {
        self.clore(id, "done", None);
    }

    /// Arrêt demandé : les pages déjà auditées sont conservées.
    pub fn arreter(&self, id: u64) {
        self.clore(id, "stopped", None);
    }

    pub fn echouer(&self, id: u64, message: &str) {
        self.clore(id, "error", Some(couper(message, 1000)));
    }

    /// Supprime un audit à la demande de l'utilisateur.
    pub fn supprimer(&self, id: u64) -> Result<(), RefusSuppression> {
        let mut interne = self.verrou();
        let Some(job) = interne.jobs.get(&id) else {
            return Err(RefusSuppression::Introuvable);
        };
        if job.status == "running" || job.status == "discovering" {
            return Err(RefusSuppression::EnCours(job.status.clone()));
        }
        interne.jobs.remove(&id);
        if let Err(e) = std::fs::remove_file(self.chemin_job(id))
            && e.kind() != ErrorKind::NotFound
        {
            journal::erreur(&format!("audit {id} : suppression du fichier impossible ({e})"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horodatage_iso() {
        let t = UNIX_EPOCH + Duration::from_millis(1_759_838_439_786);
        assert_eq!(horodatage(t), "2025-10-07T12:00:39.786Z");
        assert_eq!(horodatage(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn coupe_en_utf16() {
        assert_eq!(couper("abc", 2), "ab");
        assert_eq!(couper("é😀x", 2), "é");
        assert_eq!(couper("court", 1000), "court");
    }

    #[test]
    fn job_relu_a_l_identique() {
        // Un job écrit par le serveur Node se relit et se réécrit sans changement.
        let texte = r#"{
  "id": 3,
  "targetUrl": "https://example.com/",
  "maxPages": 500,
  "status": "done",
  "sitemapUsed": false,
  "discoveredUrls": [
    "https://example.com/"
  ],
  "selectedUrls": [
    "https://example.com/"
  ],
  "totalPages": 1,
  "processedPages": 1,
  "currentUrl": null,
  "currentUrls": [],
  "cancelRequested": false,
  "error": null,
  "createdAt": "2026-10-07T12:00:39.786Z",
  "startedAt": "2026-10-07T12:00:39.786Z",
  "auditStartedAt": "2026-10-07T12:00:45.001Z",
  "finishedAt": "2026-10-07T12:01:10.000Z",
  "pages": [
    {
      "id": 1,
      "url": "https://example.com/",
      "status": "ok",
      "desktopScores": {
        "performance": 99,
        "accessibility": 96,
        "bestPractices": 100,
        "seo": 80
      },
      "mobileScores": null,
      "desktopRecommandations": [
        {
          "id": "meta-description",
          "categorie": "seo",
          "titre": "Le document ne contient pas d'attribut \"meta description\"",
          "description": "Texte <a href=\"https://x\">lien</a>",
          "valeur": null,
          "score": 0,
          "poids": 1,
          "elements": []
        }
      ],
      "mobileRecommandations": null,
      "ecoindex": {
        "score": 94.43,
        "grade": "A",
        "ghg": 1.11,
        "water": 1.67,
        "dom": 18,
        "requests": 9,
        "sizeKo": 224.1
      },
      "error": "mobile : échec",
      "durationMs": 24136,
      "auditedAt": "2026-10-07T12:01:09.000Z"
    }
  ],
  "mode": "econome",
  "simultanes": 1,
  "prioriteBasse": true,
  "ajoutManuel": [
    1
  ]
}"#;
        let job: Job = serde_json::from_str(texte).unwrap();
        assert_eq!(serde_json::to_string_pretty(&job).unwrap(), texte);
    }
}
