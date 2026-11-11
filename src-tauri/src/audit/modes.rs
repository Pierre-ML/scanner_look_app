//! Modes d'audit : combien de pages sont mesurées en même temps, et à quelle priorité.

use serde::Serialize;
use serde_json::Value;

use super::nombre::{Nombre, arrondi, nombre_js};

/// Plafond absolu de pages simultanées, quelle que soit la machine.
pub const PLAFOND_SIMULTANES: u64 = 6;

// Mémoire à prévoir par page mesurée en même temps : un Chrome headless et son processus
// Lighthouse.
pub const MEMOIRE_PAR_PAGE_GO: f64 = 0.7;

/// Capacité de la machine, servie par `/api/etat`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacite {
    pub max: u64,
    pub plafond: u64,
    pub coeurs: u64,
    pub memoire_libre_go: Nombre,
    pub limite_par: &'static str,
}

/// Réglages effectifs d'un audit.
#[derive(Clone, Debug, PartialEq)]
pub struct ReglagesMode {
    pub mode: String,
    pub simultanes: u64,
    pub priorite_basse: bool,
}

/// Mémoire physique disponible, en octets (`os.freemem()`).
#[cfg(windows)]
fn memoire_libre() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY : structure initialisée à zéro, taille renseignée comme l'exige l'API.
    unsafe {
        let mut etat: MEMORYSTATUSEX = std::mem::zeroed();
        etat.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut etat) != 0 { etat.ullAvailPhys } else { 0 }
    }
}

#[cfg(not(windows))]
fn memoire_libre() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|texte| {
            let ligne = texte.lines().find(|l| l.starts_with("MemAvailable:"))?;
            let ko: u64 = ligne.split_whitespace().nth(1)?.parse().ok()?;
            Some(ko * 1024)
        })
        .unwrap_or(0)
}

/// Calcul pur de la capacité, à partir des cœurs logiques et de la mémoire libre (Go).
pub fn capacite(coeurs: u64, memoire_libre_go: f64) -> Capacite {
    let par_coeurs = (coeurs / 2).max(1);
    let par_memoire = ((memoire_libre_go / MEMOIRE_PAR_PAGE_GO).floor() as u64).max(1);
    let max = PLAFOND_SIMULTANES.min(par_coeurs).min(par_memoire);

    let limite_par = if max == par_memoire && par_memoire < PLAFOND_SIMULTANES.min(par_coeurs) {
        "memoire"
    } else if max == par_coeurs && par_coeurs < PLAFOND_SIMULTANES {
        "coeurs"
    } else {
        "plafond"
    };

    Capacite {
        max,
        plafond: PLAFOND_SIMULTANES,
        coeurs,
        memoire_libre_go: Nombre(arrondi(memoire_libre_go * 10.0) / 10.0),
        limite_par,
    }
}

// Nombre de pages que la machine peut mesurer en même temps, calculé À CHAQUE LANCEMENT (la
// mémoire libre change d'un moment à l'autre).
pub fn capacite_machine() -> Capacite {
    let coeurs = std::thread::available_parallelism().map_or(1, |n| n.get() as u64);
    capacite(coeurs, memoire_libre() as f64 / 1024f64.powi(3))
}

/// Traduit le choix de l'utilisateur en réglages effectifs.
pub fn resoudre_mode(mode: Option<&Value>, demande: Option<&Value>, nombre_pages: usize) -> ReglagesMode {
    let pages = (nombre_pages as f64).max(1.0);
    let borne = |n: f64| n.min(PLAFOND_SIMULTANES as f64).min(pages).max(1.0) as u64;
    let n = nombre_js(demande).floor();
    let mode = mode.and_then(Value::as_str);

    match mode {
        Some("econome") => ReglagesMode { mode: "econome".into(), simultanes: 1, priorite_basse: true },
        // Rapide : le nombre recommandé affiché par l'interface (la mémoire libre bouge d'un instant à l'autre).
        Some("rapide") => ReglagesMode {
            mode: "rapide".into(),
            simultanes: borne(if n.is_finite() { n } else { capacite_machine().max as f64 }),
            priorite_basse: false,
        },
        _ => ReglagesMode {
            mode: "personnalise".into(),
            simultanes: borne(if n.is_finite() { n } else { 1.0 }),
            priorite_basse: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capacite_limitee() {
        let c = capacite(16, 32.0);
        assert_eq!((c.max, c.limite_par), (6, "plafond"));
        let c = capacite(4, 32.0);
        assert_eq!((c.max, c.limite_par), (2, "coeurs"));
        let c = capacite(16, 1.5);
        assert_eq!((c.max, c.limite_par), (2, "memoire"));
        let c = capacite(1, 0.1);
        assert_eq!(c.max, 1);
        assert_eq!(serde_json::to_string(&capacite(8, 12.345)).unwrap(),
            r#"{"max":4,"plafond":6,"coeurs":8,"memoireLibreGo":12.3,"limitePar":"coeurs"}"#);
    }

    #[test]
    fn modes() {
        let econome = resoudre_mode(Some(&json!("econome")), Some(&json!(4)), 10);
        assert_eq!(econome, ReglagesMode { mode: "econome".into(), simultanes: 1, priorite_basse: true });

        let rapide = resoudre_mode(Some(&json!("rapide")), Some(&json!(4)), 10);
        assert_eq!((rapide.mode.as_str(), rapide.simultanes), ("rapide", 4));
        // Pas plus de processus que de pages.
        assert_eq!(resoudre_mode(Some(&json!("rapide")), Some(&json!(5)), 2).simultanes, 2);

        let perso = resoudre_mode(Some(&json!("autre")), None, 10);
        assert_eq!((perso.mode.as_str(), perso.simultanes), ("personnalise", 1));
        assert_eq!(resoudre_mode(None, Some(&json!("9")), 20).simultanes, PLAFOND_SIMULTANES);
        assert_eq!(resoudre_mode(None, Some(&json!(null)), 20).simultanes, 1);
        assert_eq!(resoudre_mode(None, Some(&json!(3)), 0).simultanes, 1);
    }
}
