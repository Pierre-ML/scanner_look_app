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
	/** Pages en même temps du mode conseillé, calculées par le moteur d'après la machine. */
	let conseille = 1;

	const mode = () => bloc.querySelector('input[name="mode-audit"]:checked')?.value ?? "conseille";

	function simultanes() {
		const pages = Math.max(1, nombrePages());
		if (mode() === "econome") return 1;
		if (mode() === "conseille") return Math.min(conseille, pages);
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
			conseille = Math.max(1, c.conseille ?? 1);
			curseur.max = String(c.plafond ?? 6);
			const pages = (n) => `${n} page${n > 1 ? "s" : ""}`;
			const charge = typeof c.chargeProcesseur === "number" ? ` (occupés à ${c.chargeProcesseur} %)` : "";
			capacite.textContent =
				`Votre machine : ${c.coeurs} cœurs${charge}, ${String(c.memoireLibreGo).replace(".", ",")} Go de mémoire libre → ` +
				`conseillé : ${pages(conseille)} en même temps ; maximum : ${pages(recommande)}.`;
			rafraichir();
		})
		.catch(() => {});

	rafraichir();
	return { mode, simultanes };
}
