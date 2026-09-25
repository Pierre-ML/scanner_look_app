/**
 * Serveur Fastify local — API JSON + tâches d'audit.
 *
 * Ce process ne rend AUCUN HTML : l'interface (Astro, dossier web/) tourne
 * à côté avec `astro dev` et relaie `/api` jusqu'ici. Il n'écoute que sur
 * 127.0.0.1 : l'outil n'est pas joignable depuis le réseau.
 *
 * Les découvertes et les audits Lighthouse tournent DANS ce process, en tâches
 * asynchrones (voir src/lib/taches.js) : un seul audit à la fois, avec le
 * Chrome installé sur la machine.
 *
 * Lancement :  npm run dev  (à la racine du dépôt, lance aussi l'interface)
 */

// En premier : les modules suivants lisent `process.env` dès leur chargement.
import './src/env.js';

import Fastify, { LogController } from 'fastify';
import fastifyFormbody from '@fastify/formbody';

import { chargerAudits } from './src/lib/store.js';
import { trouverNavigateur } from './src/lib/chrome.js';
import { MODE_THROTTLING_BUREAU } from './src/lib/audit.js';
import {
  arreterTaches,
  brancherJournal,
  tuerChromeRestant,
} from './src/lib/taches.js';
import { DATA_DIR, HOST, PORT } from './src/lib/config.js';
import { fluxJournal } from './src/lib/journal.js';
import apiRoutes from './src/routes/api.js';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    stream: fluxJournal,
  },
  // Le suivi en direct interroge le serveur toutes les deux secondes : journaliser chaque
  // requête noierait les messages utiles (découverte, pages auditées, erreurs).
  logController: new LogController({ disableRequestLogging: true }),
});

brancherJournal(fastify.log);

async function start() {
  const interrompus = chargerAudits();
  if (interrompus > 0) {
    fastify.log.warn(
      { interrompus },
      'audit(s) interrompu(s) par un arrêt brutal du serveur, marqué(s) comme terminé(s)'
    );
  }

  /*
   * Corps `application/x-www-form-urlencoded` : conservé uniquement pour le
   * fallback sans JavaScript de POST /api/discover (voir src/routes/api.js).
   */
  await fastify.register(fastifyFormbody);
  await fastify.register(apiRoutes);

  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      fastify.log.error(
        `Le port ${PORT} est déjà utilisé par un autre programme. ` +
          'Fermez-le, ou choisissez un autre port avec PORT=… dans le fichier .env ' +
          'à la racine du dépôt, puis relancez « npm run dev ».'
      );
    } else {
      fastify.log.error(err);
    }
    process.exit(1);
  }

  // Le navigateur est vérifié dès le démarrage : mieux vaut le savoir avant
  // d'avoir lancé une découverte et choisi ses pages.
  const navigateur = trouverNavigateur();
  if (navigateur.trouve) {
    fastify.log.info(
      `Navigateur d'audit : ${navigateur.nom} (${navigateur.chemin})` +
        (navigateur.source === 'CHROME_PATH' ? ' — imposé par CHROME_PATH' : '')
    );
  } else {
    fastify.log.error(navigateur.erreur);
  }

  fastify.log.info(`Throttling bureau : ${MODE_THROTTLING_BUREAU}`);
  fastify.log.info(`Audits enregistrés dans ${DATA_DIR}`);
  fastify.log.info(`Interface : http://localhost:${Number(process.env.WEB_PORT || 4321)}`);
}

/* ------------------------------ arrêt propre ------------------------------ */

/*
 * Ctrl+C (ou fermeture par concurrently) : l'audit en cours est arrêté en
 * gardant ses pages, Chrome est tué avec tous ses processus fils, l'état est
 * écrit sur disque, puis le serveur se ferme. Un second Ctrl+C force la sortie.
 */
let arretEnCours = false;

async function arreter(signal) {
  if (arretEnCours) process.exit(1);
  arretEnCours = true;
  fastify.log.info(`${signal} reçu, arrêt du serveur…`);

  await arreterTaches();
  await fastify.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => arreter(signal));
}

// Dernier filet : quelle que soit la raison de la sortie, pas de Chrome orphelin.
process.on('exit', tuerChromeRestant);

/*
 * Quand Chrome est tué en plein run (arrêt demandé, timeout), Lighthouse laisse
 * derrière lui des promesses internes rejetées que personne n'attend
 * (« Session closed », « Target closed »). Par défaut, Node arrêterait tout le
 * process — et avec lui l'interface. L'audit, lui, a déjà traité l'échec de son
 * côté : on journalise et on continue.
 */
process.on('unhandledRejection', (raison) => {
  const message = String(raison?.message ?? raison);
  if (/Protocol error|Session closed|Target closed|Connection closed/i.test(message)) {
    fastify.log.debug({ err: message }, 'erreur Lighthouse après fermeture de Chrome, ignorée');
    return;
  }
  fastify.log.error({ err: raison }, 'promesse rejetée non gérée');
});

start();
