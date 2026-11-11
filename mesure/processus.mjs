// Processus de mesure : lancé par l'application (un par page mesurée en même temps), il mesure
// les pages qu'on lui confie, une par une, avec SON propre Chrome. Protocole : une ligne JSON par
// message, reçus sur stdin, envoyés sur stdout ; les journaux vont sur stderr.

import { createInterface } from 'node:readline';

import { ecrireLigne, envoyer } from './canal.mjs';
import { auditPage, closeBrowser, killBrowser, launchBrowser } from './audit.mjs';

// Autotest du build : lighthouse et puppeteer-core sont importés ci-dessus, cela suffit.
if (process.argv.includes('--autotest')) {
  ecrireLigne('ok');
  process.exit(0);
}

/** Le Chrome de ce processus, lancé à la première page et gardé pour les suivantes. */
let browser = null;

/** Passe à `true` dès qu'une sortie est engagée : plus aucune page n'est commencée. */
let sortie = false;

async function quitter(immediat) {
  if (sortie) return;
  sortie = true;
  // Arrêt : Chrome est tué sans attendre la fin du run en cours.
  if (immediat) killBrowser(browser);
  await closeBrowser(browser);
  process.exit(0);
}

async function traiter(message) {
  if (message?.type === 'terminer') return quitter(false);
  if (message?.type === 'arreter') return quitter(true);
  if (message?.type !== 'auditer' || sortie) return;

  try {
    // Chrome a pu être tué (timeout Lighthouse) : on en relance un frais.
    if (!browser || !browser.connected) {
      if (browser) await closeBrowser(browser);
      browser = await launchBrowser();
    }
  } catch (err) {
    envoyer({ type: 'echec', message: err.message });
    return;
  }

  const debut = Date.now();
  // auditPage ne throw pas : une page en échec revient en statut 'error'.
  const resultat = await auditPage(browser, message.url);
  resultat.durationMs = Date.now() - debut;
  if (!sortie) envoyer({ type: 'resultat', url: message.url, resultat });
}

const lignes = createInterface({ input: process.stdin, crlfDelay: Infinity });

lignes.on('line', (ligne) => {
  if (ligne.trim() === '') return;
  let message;
  try {
    message = JSON.parse(ligne);
  } catch {
    console.error('[processus de mesure] ligne illisible ignorée :', ligne.slice(0, 200));
    return;
  }
  traiter(message);
});

// stdin fermé : l'application a disparu, on ne laisse pas Chrome tourner seul.
lignes.on('close', () => quitter(true));

// Dernier filet, quelle que soit la raison de la sortie.
process.on('exit', () => killBrowser(browser));

// Quand Chrome est tué en plein run, Lighthouse laisse des promesses internes rejetées que
// personne n'attend (« Session closed », « Target closed »).
process.on('unhandledRejection', (raison) => {
  const message = String(raison?.message ?? raison);
  if (/Protocol error|Session closed|Target closed|Connection closed/i.test(message)) return;
  console.error('[processus de mesure] promesse rejetée non gérée :', message);
});

envoyer({ type: 'pret' });
