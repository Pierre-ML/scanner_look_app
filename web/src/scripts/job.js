/** Utilitaires partagés par les deux pages de job (`/decouverte`, `/rapport`). */

/** Données préparées par le serveur pour la page courante. */
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

/** Numéro du job pour la page courante. */
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

/** Appelle l'API et renvoie son JSON. */
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

/** Minuteur de polling qui se met en pause quand l'onglet passe en arrière-plan. */
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

	// Premier appel immédiat par défaut : sans état initial, la page ne doit pas rester vide deux
	// secondes.
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

/** Chemin d'une page, requête comprise (« /blog?page=2 »), abrégé pour tenir sur une ligne. */
export function cheminDePage(url, longueur = 42) {
	try {
		const { pathname, search } = new URL(url);
		const chemin = decodeURI(pathname + search);
		return chemin.length > longueur ? `${chemin.slice(0, longueur - 1)}…` : chemin;
	} catch {
		return abregerUrl(url, longueur);
	}
}
