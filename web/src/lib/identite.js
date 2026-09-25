/**
 * Identité de l'outil : source unique lue par le layout et les pages, pour que l'information
 * ne puisse pas diverger d'une page à l'autre si elle change un jour.
 *
 * eco-audit tourne en LOCAL, sur la machine de l'utilisateur : pas d'éditeur de service en
 * ligne, pas d'hébergeur, pas de données collectées — donc pas de pages légales.
 */

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

/**
 * Plafond de pages par audit, tel que le serveur le fait respecter (`HARD_CAP`).
 */
export const PLAFOND_PAGES = 8;

/**
 * Avertissement éco-index. Recopié mot pour mot depuis `ECOINDEX_DISCLAIMER` du serveur, qui
 * le renvoie aussi dans chaque rapport (`ecoindexDisclaimer`) : cette constante ne sert
 * qu'aux pages où aucun rapport n'a encore été chargé (accueil).
 */
export const AVERTISSEMENT_ECOINDEX =
	"Estimation calculée localement à partir des mesures Lighthouse " +
	"(éléments du DOM, requêtes, poids transféré), selon la méthodologie " +
	"EcoIndex de GreenIT / CNUMR. Ce n’est PAS un résultat officiel du " +
	"service ecoindex.fr : les conditions de mesure diffèrent, les valeurs " +
	"peuvent donc s’écarter de celles du site officiel.";
