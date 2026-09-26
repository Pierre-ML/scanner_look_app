/** Détection du navigateur utilisé pour les audits. */

import fs from 'node:fs';
import path from 'node:path';

/** Message affiché quand aucun navigateur n'est trouvé : au démarrage ET dans l'interface. */
export const MESSAGE_NAVIGATEUR_INTROUVABLE =
  'Aucun navigateur trouvé : installez Google Chrome (https://www.google.com/chrome/) ' +
  'ou indiquez le chemin de chrome.exe dans la variable CHROME_PATH, puis relancez « npm run dev ».';

/** Emplacements candidats, dans l'ordre de préférence. */
function candidats() {
  const env = process.env;
  const liste = [];

  const ajouter = (base, ...morceaux) => {
    if (base) liste.push(path.join(base, ...morceaux));
  };

  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
    ajouter(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
  }
  for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles]) {
    ajouter(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  }

  return liste;
}

/** Nom lisible d'un exécutable, pour les messages. */
function nommer(chemin) {
  return /msedge\.exe$/i.test(chemin) ? 'Microsoft Edge' : 'Google Chrome';
}

/** Cherche le navigateur. */
export function trouverNavigateur() {
  const force = process.env.CHROME_PATH?.trim().replace(/^"(.*)"$/, '$1');

  if (force) {
    if (fs.existsSync(force)) {
      return { trouve: true, nom: nommer(force), chemin: force, source: 'CHROME_PATH' };
    }
    return {
      trouve: false,
      erreur:
        `CHROME_PATH pointe vers un fichier introuvable (${force}). ` +
        'Corrigez le chemin ou retirez la variable pour laisser la détection automatique.',
    };
  }

  for (const chemin of candidats()) {
    if (fs.existsSync(chemin)) {
      return { trouve: true, nom: nommer(chemin), chemin, source: 'auto' };
    }
  }

  return { trouve: false, erreur: MESSAGE_NAVIGATEUR_INTROUVABLE };
}
