/** Ouvre la fenêtre de confirmation du site (`Confirmation.astro`) et attend la réponse. */
export function demanderConfirmation({ titre, message, action = "Supprimer", annuler = true, danger = annuler }) {
	const fenetre = document.querySelector("#fenetre-confirmation");

	// Filet de sécurité : sans la fenêtre dans la page, on garde le comportement du navigateur.
	if (!fenetre) {
		if (!annuler) {
			window.alert(`${titre}\n\n${message}`);
			return Promise.resolve(true);
		}
		return Promise.resolve(window.confirm(`${titre}\n\n${message}`));
	}

	fenetre.querySelector("#confirmation-titre").textContent = titre;
	fenetre.querySelector("#confirmation-message").textContent = message;
	fenetre.querySelector("#confirmation-action").textContent = action;
	fenetre.querySelector("#confirmation-annuler").hidden = !annuler;

	// En mode information, le seul bouton ne supprime rien : il perd son style d'alerte.
	const valider = fenetre.querySelector("#confirmation-valider");
	valider.classList.toggle("btn-error", danger);
	valider.classList.toggle("btn-primary", !danger);
	valider.querySelector("svg")?.classList.toggle("hidden", !danger);
	fenetre.querySelector('[data-icone="suppression"]').hidden = !danger;
	fenetre.querySelector('[data-icone="information"]').hidden = danger;

	fenetre.returnValue = "";
	fenetre.showModal();
	// Focus sur « Annuler » quand il existe : Entrée par réflexe ne doit rien supprimer.
	(annuler ? fenetre.querySelector("#confirmation-annuler") : valider).focus();

	return new Promise((resoudre) => {
		fenetre.addEventListener("close", () => resoudre(fenetre.returnValue === "confirmer"), { once: true });
	});
}
