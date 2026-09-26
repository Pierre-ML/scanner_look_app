// Identité de l'outil : source unique lue par le layout et les pages, pour que l'information ne
// puisse pas diverger d'une page à l'autre si elle change un jour.

/** L'auteur, cité en pied de page : le site en reprend l'identité visuelle du portfolio. */
export const EDITEUR = {
	nom: "Pierre Mouilleseaux Lhuillier",
	ville: "Belfort, France",
	site: "https://portfolio.pierre-mouilleseaux-lhuillier.fr",
};

/** Le code source, publié sous licence MIT. */
export const DEPOT = {
	url: "https://github.com/Pierre-ML/scanner_look_app",
	licence: "MIT",
};

/** L'outil tel qu'il se présente. */
export const SITE = {
	nom: "eco-audit",
	titre: "eco-audit — Audit de performance, d'accessibilité et d'éco-conception",
	description:
		"Auditez les pages d'un site web depuis votre machine : scores Lighthouse bureau et mobile, estimation éco-index, rapport détaillé page par page.",
	langue: "fr-FR",
};

/** Pas de plafond de pages par audit : en local, l'utilisateur audite autant de pages qu'il veut. */

/** Pages cochées d'office après la découverte (les premières du plan de site). */
export const SELECTION_PAR_DEFAUT = 8;

/** Au-delà de ce nombre de pages cochées, l'interface prévient que l'audit sera long. */
export const SEUIL_AUDIT_LONG = 15;

/** Durée moyenne d'une page (bureau + mobile), pour l'estimation affichée avant l'audit. */
export const DUREE_PAGE_ESTIMEE_MS = 25_000;

/** Avertissement éco-index. */
export const AVERTISSEMENT_ECOINDEX =
	"Estimation calculée localement à partir des mesures Lighthouse " +
	"(éléments du DOM, requêtes, poids transféré), selon la méthodologie " +
	"EcoIndex de GreenIT / CNUMR. Ce n’est PAS un résultat officiel du " +
	"service ecoindex.fr : les conditions de mesure diffèrent, les valeurs " +
	"peuvent donc s’écarter de celles du site officiel.";
