/** Accès au serveur d'audit local depuis le process Node de l'interface. */

import { routes } from "./api.js";

// Adresse du serveur d'audit, vue depuis le process de l'interface : la boucle locale, sur le port
// `PORT` (même variable que le serveur, lue dans le `.env` racine par astro.config.mjs).
export const apiUrl = () => 'http://127.0.0.1:4322';

/** Les routes de l'API, résolues sur son adresse interne. */
export const routesServeur = Object.fromEntries(
	Object.entries(routes).map(([nom, construire]) => [
		nom,
		(...arguments_) => `${apiUrl()}${construire(...arguments_)}`,
	]),
);

/** Charge l'état initial d'un job, avant le rendu du HTML. */
export async function chargerEtatInitial(url, delaiMs = 3000) {
	/* Délai maximal : ce fetch retient la réponse HTTP de l'utilisateur. */
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
