// Canal vers l'application : stdout est réservé aux lignes JSON du protocole. Importé en premier,
// ce module détourne tout autre écrit sur stdout (journaux de Lighthouse, console.log) vers stderr.

const ecrireStdout = process.stdout.write.bind(process.stdout);

process.stdout.write = process.stderr.write.bind(process.stderr);
for (const niveau of ['log', 'info', 'debug']) console[niveau] = console.error;

/** Envoie un message à l'application : une ligne JSON. */
export function envoyer(message) {
  ecrireStdout(`${JSON.stringify(message)}\n`);
}

/** Écrit une ligne brute sur stdout (réponse de l'autotest). */
export function ecrireLigne(texte) {
  ecrireStdout(`${texte}\n`);
}
