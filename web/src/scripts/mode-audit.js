// Choix du mode d'audit (ChoixMode.astro).
import { routes } from "../lib/api.js";

export function initialiserChoixMode({ nombrePages, auChangement }) {
	const bloc = document.querySelector("#choix-mode");
	const curseur = document.querySelector("#simultanes");
	const valeur = document.querySelector("#valeur-simultanes");
	const reglage = document.querySelector("#reglage-simultanes");
	const capacite = document.querySelector("#capacite-machine");
	const avertissement = document.querySelector("#avertissement-parallele");
	const surcharge = document.querySelector("#avertissement-surcharge");

	let recommande = 1;

	const mode = () => bloc.querySelector('input[name="mode-audit"]:checked')?.value ?? "personnalise";

	function simultanes() {
		const pages = Math.max(1, nombrePages());
		if (mode() === "econome") return 1;
		if (mode() === "rapide") return Math.min(recommande, pages);
		return Math.min(Number(curseur.value) || 1, pages);
	}

	function rafraichir() {
		reglage.hidden = mode() !== "personnalise";
		valeur.textContent = curseur.value;
		avertissement.hidden = simultanes() <= 1;
		surcharge.hidden = mode() !== "personnalise" || Number(curseur.value) <= recommande;
		auChangement();
	}

	bloc.addEventListener("change", rafraichir);
	curseur.addEventListener("input", rafraichir);

	fetch(routes.etat(), { headers: { Accept: "application/json" }, cache: "no-store" })
		.then((reponse) => (reponse.ok ? reponse.json() : null))
		.then((etat) => {
			const c = etat?.capacite;
			if (!c) return;
			recommande = Math.max(1, c.max);
			curseur.max = String(c.plafond ?? 6);
			const raison = c.limitePar === "memoire" ? " (limité par la mémoire libre)" : "";
			capacite.textContent =
				`Votre machine : ${c.coeurs} cœurs, ${String(c.memoireLibreGo).replace(".", ",")} Go de mémoire libre → ` +
				`${recommande} page${recommande > 1 ? "s" : ""} en même temps recommandée${recommande > 1 ? "s" : ""}${raison}.`;
			rafraichir();
		})
		.catch(() => {});

	rafraichir();
	return { mode, simultanes };
}
