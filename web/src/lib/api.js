/**
 * Adresses du serveur d'audit local.
 *
 * Deux jeux d'adresses, répartis sur deux modules :
 *
 *   ICI — `routes`, des chemins RELATIFS (`/api/status/42`), servis par l'interface elle-même.
 *   C'est ce que le navigateur appelle, et ce que vise le formulaire sans JavaScript. `astro dev`
 *   relaie `/api` vers le serveur d'audit (voir `vite.server.proxy` dans astro.config.mjs) :
 *   le navigateur ne parle qu'à sa propre origine, donc aucun CORS.
 *
 *   DANS `api-serveur.js` — les adresses ABSOLUES du serveur d'audit, pour le frontmatter des
 *   pages rendues à la demande, qui l'interrogent directement sans passer par le relais.
 */

/**
 * Préfixe des routes servies par l'interface. Relatif, donc résolu sur l'origine courante par
 * le navigateur.
 */
const PREFIXE = "/api";

/**
 * Routes telles que le navigateur les appelle. Les noms de chemin sont identiques à ceux du
 * serveur : le relais ne renomme rien, il fait suivre.
 */
export const routes = {
	/** GET — { navigateur: { trouve, nom, chemin | erreur }, auditEnCours }. */
	etat: () => `${PREFIXE}/etat`,
	/** POST — crée le job. JSON -> 201 { jobId } ; urlencoded -> 303 vers /rapport/:jobId. */
	decouvrir: () => `${PREFIXE}/discover`,
	/** GET — état de la découverte : { ready, discoveredUrls, status, … }. */
	decouverte: (jobId) => `${PREFIXE}/discover/${jobId}`,
	/** POST — { selectedUrls } : valide la sélection et lance l'audit. */
	auditer: (jobId) => `${PREFIXE}/audit/${jobId}`,
	/** GET — avancement en direct : { processedPages, errorPages, currentUrl, … }. */
	statut: (jobId) => `${PREFIXE}/status/${jobId}`,
	/** GET — rapport complet : { pages, averages, ecoindexDisclaimer, … }. */
	rapport: (jobId) => `${PREFIXE}/report/${jobId}`,
	/** GET — le même rapport, en fichier JSON à télécharger. */
	exporter: (jobId) => `${PREFIXE}/report/${jobId}/export`,
	/** GET — { jobs: [...] } : tous les audits enregistrés sur cette machine. */
	historique: () => `${PREFIXE}/jobs`,
	/** POST — arrêt immédiat : la page en cours est abandonnée, les autres restent. */
	arreter: (jobId) => `${PREFIXE}/jobs/${jobId}/cancel`,
	/** DELETE — suppression de l'audit enregistré. */
	supprimer: (jobId) => `${PREFIXE}/jobs/${jobId}`,
};

/**
 * Codes de statut d'un job, tels que le serveur les écrit.
 * `discovering` -> `reviewing` -> `running` -> `done` | `stopped` | `error`
 */
export const STATUTS_TERMINES = ["done", "stopped", "error"];

/** Libellés français des statuts, pour l'affichage. */
export const LIBELLE_STATUT = {
	discovering: "Découverte des pages",
	reviewing: "En attente de votre sélection",
	queued: "Lancement de l’audit",
	running: "Audit en cours",
	done: "Audit terminé",
	stopped: "Audit arrêté",
	error: "Audit en échec",
};
