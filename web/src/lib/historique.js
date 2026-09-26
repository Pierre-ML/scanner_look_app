/** Historique des audits, conservé dans un cookie du navigateur — `eco_audits`. */

export const NOM_COOKIE = "eco_audits";

/** Six mois : durée raisonnable pour un historique, sous le plafond de 13 mois de la CNIL. */
export const DUREE_COOKIE_JOURS = 180;

/** Nombre d'audits gardés. */
export const MAX_ENTREES = 12;

/** Forme d'une entrée. */

/** Valide et nettoie un tableau lu depuis le cookie. */
export function nettoyerHistorique(brut) {
	if (!Array.isArray(brut)) return [];
	return brut
		.filter(
			(entree) =>
				entree &&
				typeof entree === "object" &&
				Number.isInteger(entree.i) &&
				entree.i > 0 &&
				typeof entree.u === "string" &&
				typeof entree.t === "number",
		)
		.slice(0, MAX_ENTREES);
}

/** Lit l'historique depuis la valeur BRUTE (déjà décodée) du cookie. */
export function analyserHistorique(valeur) {
	if (!valeur) return [];
	try {
		return nettoyerHistorique(JSON.parse(valeur));
	} catch {
		return [];
	}
}

/** Retrouve l'entrée d'un job, ou `null`. */
export function trouverEntree(historique, jobId) {
	const numero = Number(jobId);
	return historique.find((entree) => entree.i === numero) ?? null;
}

/* côté navigateur */

/** Historique du navigateur courant. */
export function lireHistorique() {
	if (typeof document === "undefined") return [];
	const ligne = document.cookie.split("; ").find((morceau) => morceau.startsWith(`${NOM_COOKIE}=`));
	if (!ligne) return [];
	try {
		return analyserHistorique(decodeURIComponent(ligne.slice(NOM_COOKIE.length + 1)));
	} catch {
		return [];
	}
}

function ecrire(historique) {
	const valeur = encodeURIComponent(JSON.stringify(historique.slice(0, MAX_ENTREES)));
	// `SameSite=Lax` : le cookie accompagne un lien suivi depuis un autre site (un rapport partagé
	// par courriel), mais jamais une requête intersite en arrière-plan.
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie =
		`${NOM_COOKIE}=${valeur}; Max-Age=${DUREE_COOKIE_JOURS * 86_400}; Path=/; SameSite=Lax${secure}`;
}

/** Ajoute ou complète l'entrée d'un audit, puis la remonte en tête de liste. */
export function enregistrerAudit(modification) {
	if (typeof document === "undefined") return;
	const numero = Number(modification.i);
	if (!Number.isInteger(numero) || numero <= 0) return;

	const historique = lireHistorique();
	const existante = trouverEntree(historique, numero);
	const autres = historique.filter((entree) => entree.i !== numero);

	const fusion = { t: Date.now(), u: "", ...existante, ...modification, i: numero };
	ecrire([fusion, ...autres]);
}

/** Retire un audit de l'historique. */
export function oublierAudit(jobId) {
	ecrire(lireHistorique().filter((entree) => entree.i !== Number(jobId)));
}

/** Efface tout l'historique : le cookie est expiré immédiatement. */
export function effacerHistorique() {
	if (typeof document === "undefined") return;
	document.cookie = `${NOM_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Résumé compact d'un rapport de l'API, prêt à être stocké. */
export function resumerRapport(rapport) {
	const arrondir = (valeur) =>
		typeof valeur === "number" && Number.isFinite(valeur) ? Math.round(valeur) : null;
	const quatre = (groupe) =>
		["performance", "accessibility", "bestPractices", "seo"].map((cle) => arrondir(groupe?.[cle]));

	const moyennes = rapport?.averages ?? {};
	const pages = Array.isArray(rapport?.pages) ? rapport.pages : [];

	return {
		s: rapport?.status,
		n: pages.length,
		x: pages.filter((page) => page.status === "error").length,
		d: quatre(moyennes.desktop),
		m: quatre(moyennes.mobile),
		e: [arrondir(moyennes.ecoindex?.score), moyennes.ecoindex?.grade ?? null],
	};
}

/** Adresse affichable d'une cible : hôte + chemin, sans le protocole. */
export function abregerCible(url) {
	try {
		const analysee = new URL(url);
		return (analysee.host + analysee.pathname).replace(/\/$/, "");
	} catch {
		return String(url || "").slice(0, 120);
	}
}
