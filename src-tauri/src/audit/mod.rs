//! API d'audit locale (127.0.0.1:4322) : audits enregistrés, découverte des pages, mesures
//! Lighthouse confiées à des processus Node (`mesure/processus.mjs`).

mod api;
mod chrome;
mod config;
mod ecoindex;
mod journal;
mod modes;
mod nombre;
mod processus;
mod rapport;
mod store;
mod taches;
#[cfg(test)]
mod tests_reels;
mod validate;

use std::path::PathBuf;
use std::sync::OnceLock;

use chrome::{Navigateur, trouver_navigateur};
use store::Store;

/// Réglages fournis par l'application.
pub struct Reglages {
    /// Dossier des audits : un fichier JSON par audit.
    pub dossier_donnees: PathBuf,
    /// Exécutable Node utilisé pour les mesures.
    pub node: PathBuf,
    /// Dossier contenant `processus.mjs` et son `node_modules`.
    pub dossier_mesure: PathBuf,
}

/// État partagé par les routes et les tâches.
struct Contexte {
    store: Store,
    node: PathBuf,
    dossier_mesure: PathBuf,
}

static CONTEXTE: OnceLock<Contexte> = OnceLock::new();

/// Contexte de l'API ; n'est appelé qu'une fois `demarrer` passé.
fn contexte() -> &'static Contexte {
    CONTEXTE.get().expect("API d'audit non démarrée")
}

/// Charge les audits, écoute sur 127.0.0.1:4322 et sert l'API jusqu'à l'arrêt. À lancer dans une tâche tokio.
pub async fn demarrer(reglages: Reglages) -> Result<(), String> {
    let store = Store::new(reglages.dossier_donnees);
    let interrompus = store
        .charger()
        .map_err(|e| format!("Dossier des audits inaccessible ({}) : {e}", store.dossier().display()))?;
    if interrompus > 0 {
        journal::avert(&format!(
            "{interrompus} audit(s) interrompu(s) par un arrêt brutal, marqué(s) comme terminé(s)"
        ));
    }

    let dossier = store.dossier().display().to_string();
    let contexte = Contexte { store, node: reglages.node, dossier_mesure: reglages.dossier_mesure };
    if !contexte.dossier_mesure.join("processus.mjs").is_file() {
        journal::erreur(&format!(
            "processus de mesure introuvable : {}",
            contexte.dossier_mesure.join("processus.mjs").display()
        ));
    }
    CONTEXTE.set(contexte).map_err(|_| "API d'audit déjà démarrée.".to_string())?;

    let ecoute = tokio::net::TcpListener::bind(config::ADRESSE).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            "Le port 4322 est déjà utilisé par un autre programme. \
             Fermez le programme qui l’occupe, puis relancez."
                .to_string()
        } else {
            format!("Écoute impossible sur {} : {e}", config::ADRESSE)
        }
    })?;

    // Le navigateur est vérifié dès le démarrage : mieux vaut le savoir avant une découverte.
    match trouver_navigateur() {
        Navigateur::Trouve { nom, chemin, impose } => journal::info(&format!(
            "Navigateur d'audit : {nom} ({}){}",
            chemin.display(),
            if impose { " — imposé par CHROME_PATH" } else { "" }
        )),
        Navigateur::Absent { erreur } => journal::erreur(&erreur),
    }
    journal::info(&format!("Audits enregistrés dans {dossier}"));
    journal::info(&format!("API d'audit : http://{}", config::ADRESSE));

    axum::serve(ecoute, api::routeur()).await.map_err(|e| e.to_string())
}

/// Arrêt de l'application : interrompt l'audit en cours, tue les processus de mesure et leurs Chrome (synchrone, borné à quelques secondes).
pub fn arreter() {
    taches::arreter_taches();
}
