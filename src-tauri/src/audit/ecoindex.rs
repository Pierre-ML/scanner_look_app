//! Calcul de l'EcoIndex — implémentation locale de la méthodologie officielle.

use serde::{Deserialize, Serialize};

use super::nombre::{Nombre, arrondi2};

// Quantiles de référence (21 valeurs = les centiles 0, 5, 10 … 100 observés sur le corpus
// GreenIT).
const QUANTILES_DOM: [f64; 21] = [
    0.0, 47.0, 75.0, 159.0, 233.0, 298.0, 358.0, 417.0, 476.0, 537.0, 603.0, 674.0, 753.0, 843.0,
    949.0, 1076.0, 1237.0, 1459.0, 1801.0, 2479.0, 594601.0,
];

const QUANTILES_REQ: [f64; 21] = [
    0.0, 2.0, 15.0, 25.0, 34.0, 42.0, 49.0, 56.0, 63.0, 70.0, 78.0, 86.0, 95.0, 105.0, 117.0,
    130.0, 147.0, 170.0, 205.0, 281.0, 3920.0,
];

/// En Ko (kilo-octets) de données transférées.
const QUANTILES_SIZE: [f64; 21] = [
    0.0, 1.37, 144.7, 319.53, 479.46, 631.97, 783.38, 937.91, 1098.62, 1265.47, 1448.32, 1648.27,
    1876.08, 2142.06, 2465.37, 2866.31, 3401.59, 4155.73, 5400.08, 8037.54, 223212.26,
];

/// Seuils de note, du meilleur au moins bon (valeur = borne basse exclue).
const GRADES: [(f64, &str); 7] = [
    (80.0, "A"),
    (70.0, "B"),
    (55.0, "C"),
    (40.0, "D"),
    (25.0, "E"),
    (10.0, "F"),
    (0.0, "G"),
];

/// Mesures brutes renvoyées par le processus de mesure (run bureau).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesures {
    pub dom: f64,
    pub requests: f64,
    pub size_ko: f64,
}

/// Objet éco-index enregistré avec chaque page.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EcoIndex {
    pub score: Option<Nombre>,
    pub grade: Option<String>,
    pub ghg: Option<Nombre>,
    pub water: Option<Nombre>,
    pub dom: Option<Nombre>,
    pub requests: Option<Nombre>,
    pub size_ko: Option<Nombre>,
}

// Position d'une valeur dans l'échelle des quantiles, avec interpolation linéaire à l'intérieur de
// l'intervalle.
pub fn quantile(quantiles: &[f64], valeur: f64) -> f64 {
    for i in 1..quantiles.len() {
        if valeur < quantiles[i] {
            return (i - 1) as f64 + (valeur - quantiles[i - 1]) / (quantiles[i] - quantiles[i - 1]);
        }
    }
    // Au-delà du dernier quantile : on plafonne.
    (quantiles.len() - 1) as f64
}

/// Score EcoIndex brut (0-100).
pub fn calculer_score(dom: f64, requetes: f64, taille_ko: f64) -> f64 {
    let q_dom = quantile(&QUANTILES_DOM, dom);
    let q_req = quantile(&QUANTILES_REQ, requetes);
    let q_taille = quantile(&QUANTILES_SIZE, taille_ko);

    let score = 100.0 - (5.0 * (3.0 * q_dom + 2.0 * q_req + q_taille)) / 6.0;
    score.clamp(0.0, 100.0)
}

/// Note A-G correspondant à un score.
pub fn note(score: f64) -> &'static str {
    GRADES.iter().find(|(seuil, _)| score > *seuil).map_or("G", |(_, g)| g)
}

/// Émission de gaz à effet de serre estimée, en gCO2e (entre 1 et 3).
fn gaz_effet_de_serre(score: f64) -> f64 {
    arrondi2(2.0 + (2.0 * (50.0 - score)) / 100.0)
}

/// Consommation d'eau estimée, en cL (entre 1,5 et 4,5).
fn consommation_eau(score: f64) -> f64 {
    arrondi2(3.0 + (3.0 * (50.0 - score)) / 100.0)
}

/// Construit l'objet éco-index complet, à partir des mesures brutes.
pub fn construire(m: &Mesures) -> EcoIndex {
    let brut = calculer_score(m.dom, m.requests, m.size_ko);
    EcoIndex {
        score: Some(Nombre(arrondi2(brut))),
        grade: Some(note(brut).to_string()),
        ghg: Some(Nombre(gaz_effet_de_serre(brut))),
        water: Some(Nombre(consommation_eau(brut))),
        dom: Some(Nombre(m.dom)),
        requests: Some(Nombre(m.requests)),
        size_ko: Some(Nombre(arrondi2(m.size_ko))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantiles_et_plafond() {
        assert_eq!(quantile(&QUANTILES_DOM, 0.0), 0.0);
        assert_eq!(quantile(&QUANTILES_REQ, 2.0), 1.0);
        assert!((quantile(&QUANTILES_REQ, 8.5) - 1.5).abs() < 1e-12);
        assert_eq!(quantile(&QUANTILES_DOM, 1e9), 20.0);
    }

    #[test]
    fn notes_bornes_exclues() {
        assert_eq!(note(80.5), "A");
        assert_eq!(note(80.0), "B");
        assert_eq!(note(10.0), "G");
        assert_eq!(note(0.0), "G");
    }

    #[test]
    fn page_legere() {
        // example.com mesuré par le processus de mesure : 18 éléments, 9 requêtes, 224 Ko.
        let e = construire(&Mesures { dom: 18.0, requests: 9.0, size_ko: 224.095703125 });
        // Sortie de buildEcoIndex (ecoindex.js) pour les mêmes mesures.
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"score":94.43,"grade":"A","ghg":1.11,"water":1.67,"dom":18,"requests":9,"sizeKo":224.1}"#
        );
    }

    #[test]
    fn valeur_de_reference() {
        let e = construire(&Mesures { dom: 600.0, requests: 80.0, size_ko: 1500.0 });
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"score":49.48,"grade":"D","ghg":2.01,"water":3.02,"dom":600,"requests":80,"sizeKo":1500}"#
        );
    }
}
