/** Compte à rebours en temps réel, calé sur l'estimation de l'API. */

/** Écart en deçà duquel une nouvelle estimation est ignorée. */
const TOLERANCE_MS = 4000;

/** « 03:07 » ; « 1:03:07 » au-delà d'une heure. */
export function formaterChrono(ms) {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const heures = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secondes = total % 60;
	const mm = String(minutes).padStart(2, "0");
	const ss = String(secondes).padStart(2, "0");
	return heures > 0 ? `${heures}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** « environ 3 minutes », pour les lecteurs d'écran (annoncé bien moins souvent). */
function formaterPhrase(ms) {
	const minutes = Math.round(ms / 60_000);
	if (ms < 60_000) return "moins d’une minute";
	return `environ ${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export function creerChrono({ chiffres, anneau, lecture, legende }) {
	/** Heure absolue (ms) à laquelle l'audit devrait se terminer. */
	let echeance = null;
	/** Durée totale estimée au premier calage : sert de référence à l'anneau. */
	let reference = null;
	let minuteur = null;
	let derniereMinuteAnnoncee = null;
	/** Phase de la dernière estimation : un changement de phase recale sans lissage. */
	let phase = null;
	let enAttente = false;

	const circonference = anneau ? 2 * Math.PI * Number(anneau.getAttribute("r")) : 0;
	if (anneau) {
		anneau.style.strokeDasharray = String(circonference);
		anneau.style.strokeDashoffset = "0";
	}

	function dessiner() {
		if (echeance === null) return;
		const restant = echeance - Date.now();

		if (restant <= 0) {
			chiffres.textContent = "00:00";
			if (legende) {
				legende.textContent = enAttente
					? "Démarrage de l’audit : Chrome se lance…"
					: "Finalisation de la dernière page…";
			}
			if (anneau) anneau.style.strokeDashoffset = String(circonference);
			return;
		}

		chiffres.textContent = formaterChrono(restant);

		if (anneau && reference) {
			const fraction = Math.min(1, Math.max(0, 1 - restant / reference));
			anneau.style.strokeDashoffset = String(circonference * fraction);
		}

		// Annonce vocale une fois par minute seulement : chaque seconde serait inaudible.
		const minute = Math.ceil(restant / 60_000);
		if (lecture && minute !== derniereMinuteAnnoncee) {
			derniereMinuteAnnoncee = minute;
			lecture.textContent = `Temps restant estimé : ${formaterPhrase(restant)}.`;
		}
	}

	function lancer() {
		if (minuteur !== null) return;
		// 250 ms plutôt que 1 s : la seconde affichée bascule au plus près du vrai changement.
		minuteur = window.setInterval(dessiner, 250);
	}

	return {
		/** Reçoit une nouvelle estimation de l'API. */
		caler(restantMs, { mesuree = false, attente = false } = {}) {
			if (typeof restantMs !== "number" || !Number.isFinite(restantMs) || restantMs < 0) return;
			const nouvelle = Date.now() + restantMs;

			// Passage de la file à l'exécution : l'estimation change de nature (elle ne compte plus
			// l'attente), on repart d'elle sans lissage.
			const nouvellePhase = attente ? "attente" : "audit";
			if (phase !== null && phase !== nouvellePhase) {
				echeance = null;
				reference = null;
			}
			phase = nouvellePhase;
			enAttente = attente;

			if (echeance === null) {
				echeance = nouvelle;
				reference = Math.max(restantMs, 1000);
			} else {
				const ecart = nouvelle - echeance;
				// En file d'attente, l'API renvoie la même durée d'audit à chaque tour, puisque rien n'a
				// commencé : la suivre ferait remonter le chrono sans cesse.
				if (attente && ecart > 0) {
					// Rien : l'échéance courante est conservée.
				} else if (Math.abs(ecart) > TOLERANCE_MS) {
					// Recul (l'audit prendra plus longtemps que prévu) : on n'absorbe que la moitié de l'écart
					// par estimation.
					echeance = ecart > 0 ? echeance + ecart / 2 : nouvelle;
				}
				// L'anneau ne doit jamais se remplir à rebours : la référence ne fait que grandir.
				reference = Math.max(reference, echeance - Date.now());
			}

			if (legende) {
				legende.textContent = mesuree
					? "Estimation d’après les pages déjà mesurées."
					: "Estimation initiale, affinée dès la première page mesurée.";
			}

			dessiner();
			lancer();
		},

		/** Fige l'affichage (audit terminé, arrêté ou en erreur). */
		arreter() {
			if (minuteur !== null) window.clearInterval(minuteur);
			minuteur = null;
			echeance = null;
			reference = null;
			phase = null;
		},
	};
}
