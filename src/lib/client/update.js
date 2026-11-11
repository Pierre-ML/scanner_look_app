// Bouton « mise à jour » de la barre latérale (application de bureau uniquement) : vérifie les
// nouvelles versions et lance l'installation après confirmation.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { demanderConfirmation } from "../../scripts/confirmation.js";

/** @typedef {{ current: string, latest: string, available: boolean, url: string }} InfoMiseAJour */

const NOTE_MS = 4000;
const PREMIERE_VERIFICATION_MS = 3000;
const VERIFICATION_TOUTES_LES_MS = 6 * 60 * 60 * 1000;
const TITRE = "Rechercher une mise à jour";

/** Hors Tauri (navigateur en développement), le bouton reste masqué. */
export function initialiserMiseAJour() {
	if (!isTauri()) return;
	const enveloppe = document.getElementById("update-wrap");
	const bouton = /** @type {HTMLButtonElement|null} */ (document.getElementById("update-btn"));
	const libelle = document.getElementById("update-label");
	const note = document.getElementById("update-note");
	const progression = document.getElementById("update-progress");
	const texteProgression = progression?.querySelector("[data-update-progress-text]");
	const barre = /** @type {HTMLProgressElement|null} */ (progression?.querySelector("[data-update-progress-bar]"));
	if (!enveloppe || !bouton || !libelle || !note || !progression || !texteProgression || !barre) return;
	enveloppe.hidden = false;
	enveloppe.classList.remove("hidden");

	/** @type {InfoMiseAJour|null} */
	let connue = null;
	let occupe = false;
	let installation = false;
	/** @type {ReturnType<typeof setTimeout>|undefined} */
	let minuteurNote;

	const masquerNote = () => {
		clearTimeout(minuteurNote);
		note.hidden = true;
		note.textContent = "";
	};
	/** @param {string} texte */
	const afficherNote = (texte) => {
		clearTimeout(minuteurNote);
		note.textContent = texte;
		note.hidden = false;
		minuteurNote = setTimeout(masquerNote, NOTE_MS);
	};

	/** @param {number} octets */
	const formaterMo = (octets) =>
		new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(octets / (1024 * 1024));

	/** Carte de progression du téléchargement (valeur nulle : barre indéterminée). */
	const afficherProgression = (/** @type {string} */ texte, /** @type {number|null} */ valeur) => {
		texteProgression.textContent = texte;
		if (valeur === null) barre.removeAttribute("value");
		else barre.value = valeur;
		progression.hidden = false;
	};

	/** @param {InfoMiseAJour|null} info */
	const dessiner = (info) => {
		connue = info && info.available ? info : null;
		bouton.dataset.available = String(Boolean(connue));
		const texte = connue ? `Mise à jour disponible : v${connue.latest}` : TITRE;
		libelle.textContent = texte;
		bouton.title = texte;
	};

	/** @returns {Promise<InfoMiseAJour>} */
	const verifier = () => /** @type {Promise<InfoMiseAJour>} */ (invoke("app_check_update"));

	const verificationSilencieuse = async () => {
		if (occupe) return;
		try {
			dessiner(await verifier());
		} catch {
			/* vérification silencieuse : erreurs ignorées */
		}
	};

	/** @param {InfoMiseAJour} info */
	const confirmerEtInstaller = async (info) => {
		const ok = await demanderConfirmation({
			titre: "Mettre à jour Eco Audit ?",
			message: `La version ${info.latest} est disponible (installée : ${info.current}). Eco Audit va se fermer pour installer la mise à jour.`,
			action: "Mettre à jour",
			annuler: true,
			danger: false,
		});
		if (!ok || installation) return;
		installation = true;
		bouton.disabled = true;
		masquerNote();
		afficherProgression("Téléchargement de la mise à jour…", null);
		/** @type {(() => void)|undefined} */
		let arreterEcoute;
		try {
			arreterEcoute = await listen("app-update-progress", (evenement) => {
				const { downloaded, total } = /** @type {{ downloaded: number, total: number|null }} */ (evenement.payload);
				const fait = formaterMo(downloaded);
				if (total) {
					const ratio = Math.min(1, downloaded / total);
					const pourcent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(ratio);
					afficherProgression(`Téléchargement de la mise à jour… ${pourcent} (${fait} / ${formaterMo(total)} Mo)`, ratio);
				} else {
					afficherProgression(`Téléchargement de la mise à jour… (${fait} Mo)`, null);
				}
			});
			await invoke("app_install_update");
			arreterEcoute();
			afficherProgression("Fermeture d’Eco Audit et lancement de la mise à jour…", 1);
			// Succès : l'app se ferme d'elle-même ; le bouton reste désactivé (aucun second lancement).
		} catch (erreur) {
			arreterEcoute?.();
			installation = false;
			progression.hidden = true;
			bouton.disabled = false;
			afficherNote(erreur instanceof Error ? erreur.message : String(erreur));
		}
	};

	bouton.addEventListener("click", async () => {
		if (occupe) return;
		occupe = true;
		masquerNote();
		try {
			if (connue) {
				await confirmerEtInstaller(connue);
				return;
			}
			bouton.dataset.checking = "true";
			bouton.disabled = true;
			/** @type {InfoMiseAJour} */
			let info;
			try {
				info = await verifier();
			} catch (erreur) {
				afficherNote(`Vérification impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
				return;
			} finally {
				bouton.dataset.checking = "false";
				bouton.disabled = false;
			}
			dessiner(info);
			if (connue) await confirmerEtInstaller(connue);
			else afficherNote(`Eco Audit est à jour (v${info.current}).`);
		} finally {
			occupe = false;
		}
	});
	document.addEventListener("keydown", (evenement) => {
		if (evenement.key === "Escape") masquerNote();
	});

	setTimeout(verificationSilencieuse, PREMIERE_VERIFICATION_MS);
	setInterval(verificationSilencieuse, VERIFICATION_TOUTES_LES_MS);
}
