//! Détection du navigateur utilisé pour les audits.

use std::path::{Path, PathBuf};

/// Message affiché quand aucun navigateur n'est trouvé : au démarrage ET dans l'interface.
pub const MESSAGE_NAVIGATEUR_INTROUVABLE: &str = "Aucun navigateur trouvé : installez Google Chrome (https://www.google.com/chrome/) \
ou indiquez le chemin de chrome.exe dans la variable CHROME_PATH, puis relancez Eco Audit.";

/// Résultat de la recherche du navigateur.
pub enum Navigateur {
    Trouve { nom: &'static str, chemin: PathBuf, impose: bool },
    Absent { erreur: String },
}

/// Emplacements candidats, dans l'ordre de préférence.
fn candidats() -> Vec<PathBuf> {
    let env = |nom: &str| std::env::var_os(nom).filter(|v| !v.is_empty()).map(PathBuf::from);
    let mut liste = Vec::new();

    for base in [env("ProgramFiles"), env("ProgramFiles(x86)"), env("LOCALAPPDATA")].into_iter().flatten() {
        liste.push(base.join("Google").join("Chrome").join("Application").join("chrome.exe"));
    }
    for base in [env("ProgramFiles(x86)"), env("ProgramFiles")].into_iter().flatten() {
        liste.push(base.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
    }

    #[cfg(target_os = "macos")]
    liste.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
    #[cfg(target_os = "linux")]
    liste.extend(["/usr/bin/google-chrome", "/usr/bin/chromium"].map(PathBuf::from));

    liste
}

/// Nom lisible d'un exécutable, pour les messages.
fn nommer(chemin: &Path) -> &'static str {
    let texte = chemin.to_string_lossy().to_ascii_lowercase();
    if texte.ends_with("msedge.exe") { "Microsoft Edge" } else { "Google Chrome" }
}

/// Cherche le navigateur (refait à chaque appel : Chrome a pu être installé entre-temps).
pub fn trouver_navigateur() -> Navigateur {
    let force = std::env::var("CHROME_PATH").unwrap_or_default();
    let force = force.trim();
    let force = force
        .strip_prefix('"')
        .and_then(|f| f.strip_suffix('"'))
        .unwrap_or(force);

    if !force.is_empty() {
        let chemin = PathBuf::from(force);
        if chemin.exists() {
            return Navigateur::Trouve { nom: nommer(&chemin), chemin, impose: true };
        }
        return Navigateur::Absent {
            erreur: format!(
                "CHROME_PATH pointe vers un fichier introuvable ({force}). \
                 Corrigez le chemin ou retirez la variable pour laisser la détection automatique."
            ),
        };
    }

    match candidats().into_iter().find(|c| c.exists()) {
        Some(chemin) => Navigateur::Trouve { nom: nommer(&chemin), chemin, impose: false },
        None => Navigateur::Absent { erreur: MESSAGE_NAVIGATEUR_INTROUVABLE.to_string() },
    }
}
