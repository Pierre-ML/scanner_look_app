/**
 * Historique des audits, conservé dans un cookie du navigateur — `eco_audits`.
 *
 * La liste complète des audits vient du serveur local (`GET /api/jobs`, page « Mes audits ») :
 * c'est lui qui les enregistre, dans `data/`. Ce cookie ne garde que les derniers audits lancés
 * depuis CE navigateur, avec un résumé de leurs moyennes : il alimente les « audits récents »
 * de l'accueil, et le résumé affiché si le rapport détaillé a été effacé de `data/`.
 *
 * Pourquoi un cookie et non `localStorage` : les pages de rapport sont rendues à la demande.
 * Un cookie voyage avec la requête, donc le SERVEUR peut afficher le résumé d'un audit effacé
 * dès le premier octet, sans JavaScript — `localStorage` ne serait lisible qu'après coup.
 *
 * Rien de ce cookie ne quitte la machine : l'interface et le serveur d'audit tournent tous les
 * deux en local. Il n'identifie personne — il n'y a ni compte ni identifiant, seulement des
 * numéros d'audit et des scores.
 *
 * Module sans dépendance serveur : importé à la fois par les scripts client (écriture via
 * `document.cookie`) et par le frontmatter des pages à la demande (lecture via
 * `Astro.cookies`). Même encodage des deux côtés : `encodeURIComponent(JSON)`, qui est aussi
 * le décodage par défaut d'`Astro.cookies.get()`.
 */

export const NOM_COOKIE = "eco_audits";

/** Six mois : durée raisonnable pour un historique, sous le plafond de 13 mois de la CNIL. */
export const DUREE_COOKIE_JOURS = 180;

/**
 * Nombre d'audits gardés. Un cookie est plafonné à ~4 Ko par les navigateurs ; une entrée
 * complète en pèse ~200 octets une fois encodée, ce qui laisse une large marge.
 */
export const MAX_ENTREES = 12;

/**
 * Forme d'une entrée. Clés d'une lettre : chaque octet compte dans un cookie.
 *
 * @typedef {object} EntreeHistorique
 * @property {number} i   numéro du job
 * @property {string} u   site audité (hôte + chemin)
 * @property {number} t   date de lancement (ms)
 * @property {number} [v] dernière consultation du rapport (ms)
 * @property {string} [s] dernier statut connu (`discovering`, `queued`, `done`…)
 * @property {number} [n] pages mesurées
 * @property {number} [x] pages en erreur
 * @property {number[]} [d] moyennes bureau  : perf, accessibilité, bonnes pratiques, SEO
 * @property {number[]} [m] moyennes mobile  : même ordre
 * @property {[number, string]} [e] éco-index : score, note A–G
 */

/**
 * Valide et nettoie un tableau lu depuis le cookie. Le contenu d'un cookie est une saisie
 * utilisateur comme une autre : il peut avoir été modifié à la main.
 *
 * @param {unknown} brut
 * @returns {EntreeHistorique[]}
 */
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

/**
 * Lit l'historique depuis la valeur BRUTE (déjà décodée) du cookie.
 * @param {string|undefined|null} valeur
 */
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

/* ------------------------------------------------------------------ côté navigateur */

/** Historique du navigateur courant. Côté client uniquement. */
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
	/*
	 * `SameSite=Lax` : le cookie accompagne un lien suivi depuis un autre site (un rapport
	 * partagé par courriel), mais jamais une requête intersite en arrière-plan.
	 * `Secure` seulement en HTTPS, sinon le développement local en HTTP ne l'écrirait pas.
	 * Pas d'`HttpOnly` possible : c'est ce script qui l'écrit.
	 */
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie =
		`${NOM_COOKIE}=${valeur}; Max-Age=${DUREE_COOKIE_JOURS * 86_400}; Path=/; SameSite=Lax${secure}`;
}

/**
 * Ajoute ou complète l'entrée d'un audit, puis la remonte en tête de liste.
 * @param {Partial<EntreeHistorique> & {i: number}} modification
 */
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

/**
 * Résumé compact d'un rapport de l'API, prêt à être stocké.
 * Scores arrondis : une décimale ne vaut pas les octets qu'elle coûte ici.
 */
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
