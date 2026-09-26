/** Section « À corriger » du rapport : ce que Lighthouse demande d'améliorer sur le site. */

import { cheminDePage } from "./job.js";

/** Titres des catégories, dans l'ordre des scores. */
const TITRES = {
	performance: "Performance",
	accessibility: "Accessibilité",
	bestPractices: "Bonnes pratiques",
	seo: "Référencement",
};

/** Petite fabrique d'élément : balise, classes, texte. */
function creer(balise, classes = "", texte = null) {
	const element = document.createElement(balise);
	if (classes) element.className = classes;
	if (texte !== null) element.textContent = texte;
	return element;
}

/** Explication de Lighthouse, écrite en Markdown réduit : liens `[texte](url)` et `code`. */
function texteLighthouse(markdown) {
	const conteneur = creer("p", "leading-relaxed");
	const motif = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`/g;
	let position = 0;
	for (const correspondance of markdown.matchAll(motif)) {
		conteneur.append(markdown.slice(position, correspondance.index));
		if (correspondance[2]) {
			const lien = creer("a", "text-cream underline decoration-cream-dark hover:decoration-cream", correspondance[1]);
			lien.href = correspondance[2];
			lien.target = "_blank";
			lien.rel = "noopener noreferrer";
			conteneur.append(lien);
		} else {
			conteneur.append(creer("code", "rounded bg-obsidian px-1 py-0.5 text-xs text-cream", correspondance[3]));
		}
		position = correspondance.index + correspondance[0].length;
	}
	conteneur.append(markdown.slice(position));
	return conteneur;
}

// Gravité, avec les formes du rapport Lighthouse (la couleur n'est jamais seule) : triangle en
// dessous de 0,5, carré de 0,5 à 0,89.
function marqueGravite(score) {
	const grave = score < 0.5;
	const bloc = creer("span", "flex shrink-0 items-center");
	const forme = creer(
		"span",
		grave
			? "inline-block size-2.5 bg-echec [clip-path:polygon(50%_0,100%_100%,0_100%)]"
			: "inline-block size-2.5 bg-alerte",
	);
	forme.setAttribute("aria-hidden", "true");
	bloc.append(forme, creer("span", "sr-only", grave ? "Échec : " : "À améliorer : "));
	return bloc;
}

/** Une page concernée : chemin, supports (bureau / mobile), valeur et éléments relevés. */
function lignePage(page) {
	const ligne = creer("li", "border-t border-obsidian-border py-3 first:border-t-0 first:pt-0");

	const entete = creer("div", "flex flex-wrap items-baseline gap-x-3 gap-y-1");
	const lien = creer("a", "font-medium text-cream underline decoration-cream-dark hover:decoration-cream", cheminDePage(page.url, 60));
	lien.href = page.url;
	lien.target = "_blank";
	lien.rel = "noopener nofollow";
	lien.title = page.url;
	entete.append(lien);

	for (const [cle, libelle] of [
		["bureau", "Bureau"],
		["mobile", "Mobile"],
	]) {
		if (!page[cle]) continue;
		entete.append(
			creer(
				"span",
				"text-xs text-cream-dark",
				page[cle].valeur ? `${libelle} : ${page[cle].valeur}` : libelle,
			),
		);
	}
	ligne.append(entete);

	// Mêmes éléments en bureau et en mobile le plus souvent : fusionnés, sans doublon.
	const elements = [...new Set([...(page.bureau?.elements ?? []), ...(page.mobile?.elements ?? [])])];
	if (elements.length > 0) {
		const liste = creer("ul", "mt-2 space-y-1");
		for (const element of elements.slice(0, 5)) {
			const item = creer("li");
			item.append(creer("code", "block overflow-x-auto rounded bg-obsidian px-2 py-1 text-xs whitespace-pre text-cream-muted", element));
			liste.append(item);
		}
		ligne.append(liste);
	}

	return ligne;
}

/** Un point à corriger, repliable : titre en tête, explication et pages concernées dedans. */
function carteCorrection(point) {
	const carte = creer("details", "collapse collapse-arrow rounded-box border border-obsidian-border bg-obsidian-card");
	carte.dataset.correction = `${point.categorie}:${point.id}`;

	const titre = creer("summary", "collapse-title flex items-center gap-3 pr-12 text-sm");
	titre.append(marqueGravite(point.score));
	titre.append(creer("span", "min-w-0 flex-1 font-medium text-cream", point.titre));
	const nombre = point.pages.length;
	titre.append(
		creer(
			"span",
			"badge badge-sm shrink-0 border-obsidian-border bg-obsidian-hover text-cream-muted tabular-nums",
			`${nombre} page${nombre > 1 ? "s" : ""}`,
		),
	);

	const contenu = creer("div", "collapse-content space-y-4 text-sm text-cream-muted");
	if (point.description) contenu.append(texteLighthouse(point.description));
	const pages = creer("ul", "rounded-box border border-obsidian-border bg-obsidian/40 p-4");
	for (const page of point.pages) pages.append(lignePage(page));
	contenu.append(pages);

	carte.append(titre, contenu);
	return carte;
}

/** Remplit la section. */
export function afficherCorrections(conteneur, message, aCorriger) {
	const signature = JSON.stringify(aCorriger);
	if (conteneur.dataset.signature === signature) return;
	conteneur.dataset.signature = signature;

	const ouverts = new Set(
		[...conteneur.querySelectorAll("details[open]")].map((carte) => carte.dataset.correction),
	);

	const categories = (aCorriger ?? []).filter((groupe) => groupe.points.length > 0);

	if (aCorriger === null) {
		message.textContent =
			"Ce rapport date d’avant l’ajout de cette section : relancez l’audit du site pour obtenir la liste des points à corriger.";
	} else if (categories.length === 0) {
		message.textContent = "Lighthouse ne signale aucun point à corriger sur les pages mesurées.";
	}
	message.hidden = categories.length > 0;

	conteneur.replaceChildren(
		...categories.map((groupe) => {
			const bloc = creer("section", "space-y-3");
			const entete = creer("h3", "flex items-center gap-2.5 font-titre text-base tracking-[0.02em]");
			entete.append(TITRES[groupe.categorie] ?? groupe.categorie);
			entete.append(
				creer(
					"span",
					"badge badge-sm border-obsidian-border bg-obsidian-hover font-corps text-cream-muted tabular-nums",
					String(groupe.points.length),
				),
			);
			bloc.append(entete);
			for (const point of groupe.points) {
				const carte = carteCorrection(point);
				if (ouverts.has(carte.dataset.correction)) carte.open = true;
				bloc.append(carte);
			}
			return bloc;
		}),
	);
}
