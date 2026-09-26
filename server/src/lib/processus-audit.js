// Processus d'audit : lancé par le serveur (`fork`, voir taches.js), il mesure les pages qu'on lui
// confie, une par une, avec SON propre Chrome.

import { auditPage, closeBrowser, killBrowser, launchBrowser } from './audit.js';

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

process.on('message', async (message) => {
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
    process.send?.({ type: 'echec', message: err.message });
    return;
  }

  const debut = Date.now();
  // auditPage ne throw pas : une page en échec revient en statut 'error'.
  const resultat = await auditPage(browser, message.url);
  resultat.durationMs = Date.now() - debut;
  if (!sortie) process.send?.({ type: 'resultat', url: message.url, resultat });
});

// Serveur disparu : on ne laisse pas Chrome tourner seul.
process.on('disconnect', () => quitter(true));

// Dernier filet, quelle que soit la raison de la sortie.
process.on('exit', () => killBrowser(browser));

// Quand Chrome est tué en plein run, Lighthouse laisse des promesses internes rejetées que
// personne n'attend (« Session closed », « Target closed »).
process.on('unhandledRejection', (raison) => {
  const message = String(raison?.message ?? raison);
  if (/Protocol error|Session closed|Target closed|Connection closed/i.test(message)) return;
  console.error('[processus d’audit] promesse rejetée non gérée :', message);
});

process.send?.({ type: 'pret' });
