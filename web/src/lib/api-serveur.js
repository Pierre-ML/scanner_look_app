/**
 * Accès au serveur d'audit local depuis le process Node de l'interface. SERVEUR UNIQUEMENT.
 *
 * Ce module est séparé de `api.js` parce qu'il lit `process.env`, qui n'existe pas côté
 * navigateur : l'importer depuis un fichier chargé par le client casserait le bundle.
 *
 * À n'importer que depuis le frontmatter d'une page `prerender = false`.
 */

import { routes } from "./api.js";

/**
 * Adresse du serveur d'audit, vue depuis le process de l'interface : la boucle locale, sur le
 * port `PORT` (même variable que le serveur, lue dans le `.env` racine par astro.config.mjs).
 *
 * Fonction et non constante : la valeur est lue à l'exécution, pas figée à l'import.
 */
export const apiUrl = () => `http://127.0.0.1:${Number(process.env.PORT || 4322)}`;

/**
 * Les routes de l'API, résolues sur son adresse interne.
 * Mêmes noms que dans `api.js` : seul le préfixe change.
 */
export const routesServeur = Object.fromEntries(
	Object.entries(routes).map(([nom, construire]) => [
		nom,
		(...arguments_) => `${apiUrl()}${construire(...arguments_)}`,
	]),
);

/**
 * Charge l'état initial d'un job, avant le rendu du HTML.
 *
 * Renvoie l'un de trois cas, et ne lève jamais : le rendu d'une page ne doit pas échouer parce
 * que l'API est momentanément indisponible.
 *
 *   { cas: "ok", donnees }           -> données à injecter dans le HTML
 *   { cas: "introuvable" }           -> 404 : job inexistant ou supprimé
 *   { cas: "indisponible", message } -> API injoignable ou en erreur : la page se rabat sur
 *                                       le polling client, qui réessaiera
 *
 * @param {string} url route construite avec `routesServeur`
 * @param {number} delaiMs budget de temps accordé au fetch
 */
export async function chargerEtatInitial(url, delaiMs = 3000) {
	/*
	 * Délai maximal : ce fetch retient la réponse HTTP de l'utilisateur. Si l'API ne répond pas
	 * en quelques secondes, mieux vaut servir la page avec un état vide — le polling client
	 * prendra le relais — que de laisser le navigateur attendre.
	 */
	const interrupteur = AbortSignal.timeout(delaiMs);

	let reponse;
	try {
		reponse = await fetch(url, {
			headers: { Accept: "application/json" },
			cache: "no-store",
			signal: interrupteur,
		});
	} catch (cause) {
		return {
			cas: "indisponible",
			message:
				cause?.name === "TimeoutError"
					? "Le service n’a pas répondu assez vite."
					: "Le serveur d’audit local est injoignable. Vérifiez que « npm run dev » tourne toujours.",
		};
	}

	if (reponse.status === 404) return { cas: "introuvable" };

	let corps = null;
	try {
		corps = await reponse.json();
	} catch {
		corps = null;
	}

	if (!reponse.ok) {
		return {
			cas: "indisponible",
			message: corps?.error || `Le service a répondu par une erreur ${reponse.status}.`,
		};
	}

	return { cas: "ok", donnees: corps };
}
