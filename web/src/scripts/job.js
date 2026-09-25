/**
 * Utilitaires partagés par les deux pages de job (`/decouverte`, `/rapport`).
 */

/**
 * Données préparées par le serveur pour la page courante.
 *
 * Les pages `/rapport/[jobId]` et `/decouverte/[jobId]` sont rendues à la demande : leur
 * frontmatter interroge l'API et sérialise le résultat dans un
 * `<script type="application/json" id="donnees-initiales">`. Ce bloc n'est pas exécutable —
 * c'est du texte inerte pour le navigateur — donc rien de ce qu'il contient ne peut être
 * interprété comme du code, même si l'API renvoyait un jour une URL malveillante.
 *
 * Pourquoi ce canal plutôt que `define:vars` : `define:vars` interdit les imports dans le
 * script concerné, ce qui obligerait à recopier ici tout ce module.
 *
 * @returns {{jobId: string|null, etat: unknown, rapport: unknown, indisponible: string|null}}
 *   objet toujours défini ; ses champs valent `null` quand le serveur n'a rien pu fournir
 *   (API injoignable au moment du rendu), et le polling reprend alors la main normalement.
 */
export function lireDonneesInitiales() {
	const vide = { jobId: null, etat: null, rapport: null, indisponible: null };
	const bloc = document.getElementById("donnees-initiales");
	if (!bloc || !bloc.textContent) return vide;

	try {
		return { ...vide, ...JSON.parse(bloc.textContent) };
	} catch {
		// Un JSON illisible ne doit pas empêcher la page de fonctionner en mode polling seul.
		return vide;
	}
}

/**
 * Numéro du job pour la page courante.
 *
 * Lu en priorité dans les données rendues par le serveur : sur une route à la demande, c'est
 * `Astro.params.jobId`, déjà validé côté serveur. Les deux replis servent aux cas où ces
 * données sont absentes :
 *
 *   1. le dernier segment du chemin — `/rapport/42`, la forme canonique, celle vers laquelle
 *      l'API redirige en 303 dans le flux sans JavaScript ;
 *   2. le paramètre `?job=42`, utile pour déboguer une page servie sans son état initial.
 *
 * @returns {string|null} le numéro sous forme de chaîne, ou `null` s'il est absent ou
 *   invalide. `null` déclenche l'affichage de l'état « job introuvable ».
 */
export function lireJobId() {
	const { jobId } = lireDonneesInitiales();
	if (estNumero(jobId)) return jobId;

	const segments = window.location.pathname.split("/").filter(Boolean);
	const dernier = segments[segments.length - 1];
	if (estNumero(dernier)) return dernier;

	const parametre = new URLSearchParams(window.location.search).get("job");
	if (estNumero(parametre)) return parametre;

	return null;
}

/** Un identifiant de job est un entier strictement positif, comme côté API. */
function estNumero(valeur) {
	return typeof valeur === "string" && /^[1-9][0-9]*$/.test(valeur);
}

/**
 * Appelle l'API et renvoie son JSON.
 *
 * Distingue trois échecs, parce que l'interface les traite différemment :
 *   - `introuvable` : 404, le job n'existe pas ou a été supprimé -> message explicatif ;
 *   - `refus` : autre réponse 4xx/5xx avec un corps JSON -> on affiche son message ;
 *   - `reseau` : la requête n'a pas abouti, ou c'est le relais de `astro dev` qui a répondu
 *     à la place du serveur d'audit (arrêté : 5xx sans corps JSON) -> on invite à
 *     réessayer, sans prétendre que le job est perdu.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 */
export async function appeler(url, options = {}) {
	let reponse;

	try {
		reponse = await fetch(url, {
			...options,
			headers: { Accept: "application/json", ...(options.headers || {}) },
			// L'état d'un audit change en continu : jamais de réponse issue du cache.
			cache: "no-store",
		});
	} catch (cause) {
		throw Object.assign(new Error("Le service est injoignable."), { genre: "reseau", cause });
	}

	// Un 404 peut arriver avec ou sans corps JSON selon la couche qui l'a produit.
	let corps = null;
	try {
		corps = await reponse.json();
	} catch {
		corps = null;
	}

	// Serveur d'audit arrêté : le relais de Vite répond lui-même, en 5xx et sans JSON.
	if (reponse.status >= 500 && corps === null) {
		throw Object.assign(new Error("Le serveur d’audit local est injoignable."), { genre: "reseau" });
	}

	if (reponse.status === 404) {
		throw Object.assign(new Error(corps?.error || "Audit introuvable."), { genre: "introuvable" });
	}

	if (!reponse.ok) {
		throw Object.assign(new Error(corps?.error || `Erreur ${reponse.status}.`), {
			genre: "refus",
			statut: reponse.status,
			corps,
		});
	}

	return corps;
}

/**
 * Minuteur de polling qui se met en pause quand l'onglet passe en arrière-plan.
 *
 * Pourquoi : un audit dure plusieurs minutes et l'utilisateur va voir ailleurs. Continuer à
 * interroger le serveur depuis un onglet caché consomme des ressources pour un affichage que
 * personne ne regarde — sur la machine même qui mesure les performances. Les navigateurs
 * brident d'ailleurs déjà les minuteurs des onglets cachés, donc la cadence de 2 s n'y serait
 * de toute façon pas tenue.
 *
 * Au retour au premier plan, un appel est déclenché IMMÉDIATEMENT avant de reprendre la
 * cadence : sans lui, l'utilisateur regarderait jusqu'à deux secondes un avancement périmé.
 *
 * @param {() => Promise<boolean>} tache appel de polling ; renvoie `false` pour arrêter
 *   définitivement (audit terminé, job introuvable).
 * @param {number} intervalleMs
 * @param {{immediat?: boolean}} [options] `immediat: false` saute le premier appel : la page
 *   a déjà été rendue avec un état frais côté serveur, le refaire tout de suite ne
 *   changerait rien à l'affichage et gaspillerait un aller-retour.
 */
export function creerPolling(tache, intervalleMs = 2000, options = {}) {
	let minuteur = null;
	let arrete = false;
	/** Empêche deux appels simultanés si l'API met plus longtemps que l'intervalle à répondre. */
	let enVol = false;

	async function tour() {
		if (arrete || enVol) return;
		enVol = true;
		try {
			const continuer = await tache();
			if (continuer === false) stop();
		} finally {
			enVol = false;
		}
	}

	function planifier() {
		if (arrete || minuteur !== null) return;
		minuteur = window.setInterval(tour, intervalleMs);
	}

	function suspendre() {
		if (minuteur === null) return;
		window.clearInterval(minuteur);
		minuteur = null;
	}

	function stop() {
		arrete = true;
		suspendre();
		document.removeEventListener("visibilitychange", surVisibilite);
	}

	function surVisibilite() {
		if (document.hidden) {
			suspendre();
		} else {
			planifier();
			// Rattrapage immédiat, sans attendre le prochain tour du minuteur.
			tour();
		}
	}

	document.addEventListener("visibilitychange", surVisibilite);

	/*
	 * Premier appel immédiat par défaut : sans état initial, la page ne doit pas rester vide
	 * deux secondes. Quand le serveur a déjà rendu l'état (`immediat: false`), on attend le
	 * premier tour du minuteur — l'affichage est déjà juste.
	 */
	if (options.immediat !== false) tour();
	if (!document.hidden) planifier();

	return { stop, enPause: () => minuteur === null && !arrete };
}

/** Durée en millisecondes, rendue lisible : « 24,3 s », « 3 min 05 s ». */
export function formaterDuree(ms) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

	const minutes = Math.floor(ms / 60_000);
	const secondes = Math.round((ms % 60_000) / 1000);
	return `${minutes} min ${String(secondes).padStart(2, "0")} s`;
}

/** Raccourcit une URL pour l'affichage, en gardant le début du chemin (le plus parlant). */
export function abregerUrl(url, longueur = 60) {
	let texte = String(url || "");
	try {
		const analysee = new URL(texte);
		texte = analysee.host + analysee.pathname + analysee.search;
	} catch {
		// Pas une URL absolue : on affiche la chaîne telle quelle.
	}
	if (texte.length <= longueur) return texte;
	return `${texte.slice(0, longueur - 1)}…`;
}
