/** Le code du serveur a-t-il changé depuis son démarrage ? */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du serveur : server/ (ce fichier est dans server/src/lib/). */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Instant du démarrage, pris au chargement de ce module (au lancement du serveur). */
const DEMARRAGE = Date.now();

/** Date de modification la plus récente parmi les fichiers .js du serveur. */
function derniereModification(dossier = RACINE) {
  let plusRecente = 0;
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      plusRecente = Math.max(plusRecente, derniereModification(chemin));
    } else if (entree.name.endsWith('.js')) {
      plusRecente = Math.max(plusRecente, fs.statSync(chemin).mtimeMs);
    }
  }
  return plusRecente;
}

// `true` si un fichier du serveur a été modifié après son démarrage : il faut relancer `npm run
// dev` pour que les changements s'appliquent.
export function redemarrageNecessaire() {
  try {
    return derniereModification() > DEMARRAGE;
  } catch {
    return false;
  }
}
