/** Relais `/api/*` → moteur d'audit (backend Rust, 127.0.0.1:4322). */
export const prerender = false;

const MOTEUR = "http://127.0.0.1:4322";
const EN_TETES_REQUETE = ["content-type", "accept"];
const EN_TETES_REPONSE = ["content-type", "content-disposition", "cache-control", "location"];

/** @param {{ request: Request }} contexte */
export async function ALL({ request }) {
	const { pathname, search } = new URL(request.url);
	const enTetes = new Headers();
	for (const nom of EN_TETES_REQUETE) {
		const valeur = request.headers.get(nom);
		if (valeur) enTetes.set(nom, valeur);
	}
	const avecCorps = !["GET", "HEAD"].includes(request.method);

	try {
		const reponse = await fetch(`${MOTEUR}${pathname}${search}`, {
			method: request.method,
			headers: enTetes,
			body: avecCorps ? await request.arrayBuffer() : undefined,
			redirect: "manual",
		});
		const retour = new Headers();
		for (const nom of EN_TETES_REPONSE) {
			const valeur = reponse.headers.get(nom);
			if (valeur) retour.set(nom, valeur);
		}
		const sansCorps = [101, 204, 205, 304].includes(reponse.status);
		return new Response(sansCorps ? null : reponse.body, { status: reponse.status, headers: retour });
	} catch {
		return new Response(JSON.stringify({ error: "Le moteur d’audit ne répond pas." }), {
			status: 502,
			headers: { "content-type": "application/json; charset=utf-8" },
		});
	}
}
