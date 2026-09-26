/** Adresses du serveur d'audit local. */

/** Préfixe des routes servies par l'interface. */
const PREFIXE = "/api";

/** Routes telles que le navigateur les appelle. */
export const routes = {
	/** GET — { navigateur: { trouve, nom, chemin | erreur }, auditEnCours }. */
	etat: () => `${PREFIXE}/etat`,
	/** POST — crée le job. */
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

/** Codes de statut d'un job, tels que le serveur les écrit. */
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
