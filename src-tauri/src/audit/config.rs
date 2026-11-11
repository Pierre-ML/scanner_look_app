//! Constantes de l'API d'audit locale.

/// Nombre maximal de pages PROPOSÉES par la découverte (sitemap ou crawl).
pub const LIMITE_DECOUVERTE: u64 = 500;

/// Adresse d'écoute : la boucle locale, et rien d'autre.
pub const ADRESSE: &str = "127.0.0.1:4322";

/// Durée moyenne d'une page (deux passages Lighthouse), en millisecondes.
pub const DUREE_PAGE_ESTIMEE_MS: u64 = 25_000;

/// Délai maximal d'un run Lighthouse dans le processus de mesure (ms).
pub const RUN_TIMEOUT_MS: u64 = 180_000;

/// Affiché PARTOUT où un éco-index apparaît.
pub const ECOINDEX_DISCLAIMER: &str = "Estimation calculée localement à partir des mesures Lighthouse \
(éléments du DOM, requêtes, poids transféré), selon la méthodologie \
EcoIndex de GreenIT / CNUMR. Ce n’est PAS un résultat officiel du \
service ecoindex.fr : les conditions de mesure diffèrent, les valeurs \
peuvent donc s’écarter de celles du site officiel.";
