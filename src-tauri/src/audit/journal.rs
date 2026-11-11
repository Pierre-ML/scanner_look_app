//! Journal de l'API d'audit, sur la sortie d'erreur (visible en développement).

use std::time::SystemTime;

fn ecrire(niveau: &str, message: &str) {
    // Heure UTC (hh:mm:ss) prise dans l'horodatage ISO.
    let iso = super::store::horodatage(SystemTime::now());
    eprintln!("{} {niveau} [audit] {message}", &iso[11..19]);
}

pub fn info(message: &str) {
    ecrire("INFO ", message);
}

pub fn avert(message: &str) {
    ecrire("AVERT", message);
}

pub fn erreur(message: &str) {
    ecrire("ERREUR", message);
}
