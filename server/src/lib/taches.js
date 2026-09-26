/** Tâches de fond : découverte des pages, puis audits Lighthouse. */

import { fork } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  failJob,
  finishJob,
  getJob,
  isCancelRequested,
  savePageResult,
  setJobPagesEnCours,
  setJobDiscovered,
  stopJob,
} from './store.js';
import { RUN_TIMEOUT_MS, tuerArbre } from './audit.js';
import { discoverPages } from './discover.js';
import { LIMITE_DECOUVERTE } from './config.js';

/** Journal des tâches : le logger Fastify, branché par server.js. */
let journal = console;

export function brancherJournal(logger) {
  journal = logger;
}

/** Audit en cours : `{ jobId, equipe, promesse }` (equipe : ses processus d'audit), ou `null`. */
let auditEnCours = null;

/** Découvertes en cours, pour pouvoir les attendre à l'arrêt du serveur. */
const decouvertes = new Set();

/** Passe à `true` à l'arrêt du serveur : plus aucune page n'est lancée. */
let arretServeur = false;

/** Identifiant de l'audit en cours, ou `null`. */
export function auditActif() {
  return auditEnCours ? auditEnCours.jobId : null;
}

/* Phase 1 — découverte des pages */

/** Lance la découverte en arrière-plan. */
export function lancerDecouverte(jobId) {
  const tache = runDiscovery(jobId)
    .catch((err) => {
      // Filet de sécurité : le serveur ne doit jamais tomber sur un job cassé.
      journal.error({ jobId, err }, 'erreur inattendue pendant la découverte');
      try {
        failJob(jobId, err.message);
      } catch {
        /* écriture impossible (disque plein…) : on continue quand même */
      }
    })
    .finally(() => decouvertes.delete(tache));
  decouvertes.add(tache);
}

/** Cherche les pages du site et rend la main à l'utilisateur. */
async function runDiscovery(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  journal.info({ jobId, url: job.targetUrl }, 'découverte des pages');

  // Le garde-fou de découverte s'applique même si le fichier contenait une valeur plus élevée
  // (modification manuelle…).
  const limit = Math.min(job.maxPages, LIMITE_DECOUVERTE);

  let urls;
  let sitemapUsed;

  try {
    const discovery = await discoverPages(job.targetUrl, limit, (msg) =>
      journal.info({ jobId }, msg)
    );
    urls = discovery.urls;
    sitemapUsed = discovery.sitemapUsed;
  } catch (err) {
    failJob(jobId, `Découverte impossible : ${err.message}`);
    journal.warn({ jobId, err: err.message }, 'échec de la découverte');
    return;
  }

  // L'utilisateur a pu demander l'arrêt pendant la découverte.
  if (isCancelRequested(jobId)) {
    stopJob(jobId);
    journal.info({ jobId }, 'arrêt demandé pendant la découverte');
    return;
  }

  if (urls.length === 0) {
    failJob(
      jobId,
      'Aucune page trouvée (site injoignable ou entièrement interdit par robots.txt).'
    );
    journal.info({ jobId }, 'aucune page trouvée');
    return;
  }

  setJobDiscovered(jobId, { sitemapUsed, urls });
  journal.info(
    { jobId, pages: urls.length, source: sitemapUsed ? 'sitemap' : 'crawl' },
    'pages proposées, en attente de validation'
  );
}
/* Phase 2 — audits Lighthouse, par une équipe de processus */

/** Point d'entrée des processus d'audit (un par page mesurée en même temps). */
const PROCESSUS_AUDIT = fileURLToPath(new URL('./processus-audit.js', import.meta.url));

// Délai de garde d'une page : ses deux runs (bureau + mobile) ont chacun leur propre timeout dans
// le processus d'audit ; au-delà de ce délai, c'est le processus lui-même qui ne répond plus.
const GARDE_PAGE_MS = 2 * RUN_TIMEOUT_MS + 60_000;

/** Attente maximale d'une fermeture propre avant de tuer un processus d'audit. */
const DELAI_FERMETURE_MS = 15_000;

/** Lance l'audit en arrière-plan. */
export function lancerAudit(jobId) {
  // Réservation synchrone, AVANT tout `await` : deux lancements rapprochés ne peuvent pas passer
  // tous les deux.
  const reservation = { jobId, equipe: new Set(), promesse: null };
  auditEnCours = reservation;

  reservation.promesse = runAudit(jobId, reservation)
    .catch((err) => {
      journal.error({ jobId, err }, 'erreur inattendue pendant l’audit');
      try {
        failJob(jobId, err.message);
      } catch {
        /* écriture impossible : on continue quand même */
      }
    })
    .finally(() => {
      if (auditEnCours === reservation) auditEnCours = null;
    });
}

// Arrêt immédiat de l'audit en cours : chaque processus d'audit tue son Chrome, ce qui fait
// échouer sans attendre les runs Lighthouse en cours.
export function interrompreAudit(jobId) {
  if (auditEnCours?.jobId !== jobId) return;
  for (const membre of auditEnCours.equipe) arreterMembre(membre);
}

/** Doit-on s'arrêter avant la page suivante ? */
function doitArreter(jobId) {
  return arretServeur || isCancelRequested(jobId);
}

// Demande à un processus d'audit de s'arrêter tout de suite (il tue son Chrome et nettoie son
// profil temporaire), puis le tue s'il n'est pas sorti à temps.
function arreterMembre(membre) {
  if (membre.exitCode !== null || membre.signalCode !== null) return;
  try {
    membre.send({ type: 'arreter' });
  } catch {
    /* canal déjà fermé */
  }
  setTimeout(() => tuerArbre(membre), 5_000).unref();
}

/** Attend le prochain message d'un processus d'audit. */
function attendreMessage(membre, delaiMs) {
  if (membre.exitCode !== null || membre.signalCode !== null) return Promise.resolve({ type: 'sorti' });
  return new Promise((resoudre) => {
    let minuteur = null;
    const fin = (valeur) => {
      clearTimeout(minuteur);
      membre.off('message', surMessage);
      membre.off('exit', surSortie);
      resoudre(valeur);
    };
    const surMessage = (message) => fin(message);
    const surSortie = () => fin({ type: 'sorti' });
    membre.on('message', surMessage);
    membre.once('exit', surSortie);
    if (delaiMs) minuteur = setTimeout(() => fin({ type: 'delai' }), delaiMs);
  });
}

// Audite les pages retenues par l'utilisateur, avec `simultanes` processus en parallèle (1 en mode
// économe).
async function runAudit(jobId, reservation) {
  const job = getJob(jobId);
  const urls = job?.selectedUrls || [];

  if (urls.length === 0) {
    failJob(jobId, 'Aucune page sélectionnée pour l’audit.');
    return;
  }

  const simultanes = Math.max(1, Math.min(job.simultanes || 1, urls.length));
  journal.info(
    { jobId, pages: urls.length, mode: job.mode, simultanes, prioriteBasse: job.prioriteBasse },
    'audit démarré'
  );

  const aFaire = [...urls];
  const enCours = new Set();
  let echec = null;

  const majEnCours = () => setJobPagesEnCours(jobId, urls.filter((url) => enCours.has(url)));

  async function membreDEquipe(rang) {
    const membre = fork(PROCESSUS_AUDIT, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    reservation.equipe.add(membre);

    // Mode économe : priorité basse AVANT que le processus lance Chrome.
    if (job.prioriteBasse) {
      try {
        os.setPriority(membre.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch (err) {
        journal.warn({ jobId, err: err.message }, 'priorité basse impossible à appliquer');
      }
    }

    try {
      const accueil = await attendreMessage(membre, 30_000);
      if (accueil.type !== 'pret') {
        echec = echec || 'Un processus d’audit n’a pas pu démarrer.';
        return;
      }

      for (;;) {
        if (echec || doitArreter(jobId)) return;
        const url = aFaire.shift();
        if (!url) return;

        enCours.add(url);
        majEnCours();
        journal.info({ jobId, processus: rang + 1 }, `page ${urls.indexOf(url) + 1}/${urls.length} - ${url}`);

        membre.send({ type: 'auditer', url });
        const reponse = await attendreMessage(membre, GARDE_PAGE_MS);

        enCours.delete(url);
        majEnCours();

        // Arrêt pendant la page : Chrome a été tué en plein run, le résultat est incomplet.
        if (doitArreter(jobId)) return;

        if (reponse.type === 'echec') {
          echec = reponse.message;
          return;
        }

        if (reponse.type === 'resultat') {
          savePageResult(jobId, reponse.resultat);
          if (reponse.resultat.status === 'error') {
            journal.warn({ jobId, url, err: reponse.resultat.error }, 'page en erreur');
          }
          continue;
        }

        // Processus sorti ou muet au-delà du délai de garde : la page est comptée en erreur, et le
        // processus remplacé pour la suite.
        savePageResult(jobId, {
          url,
          status: 'error',
          error:
            reponse.type === 'delai'
              ? 'Le processus d’audit ne répondait plus : page abandonnée.'
              : 'Le processus d’audit s’est arrêté pendant la mesure.',
        });
        journal.warn({ jobId, url, cause: reponse.type }, 'processus d’audit remplacé');
        tuerArbre(membre);
        return membreDEquipe(rang);
      }
    } finally {
      // Fermeture propre (Chrome et son profil temporaire), sinon de force.
      if (membre.exitCode === null && membre.signalCode === null) {
        try {
          membre.send({ type: doitArreter(jobId) ? 'arreter' : 'terminer' });
        } catch {
          /* canal fermé */
        }
        const sortie = await attendreMessage(membre, DELAI_FERMETURE_MS);
        if (sortie.type !== 'sorti') tuerArbre(membre);
      }
      reservation.equipe.delete(membre);
    }
  }

  await Promise.all(Array.from({ length: simultanes }, (_, rang) => membreDEquipe(rang)));

  if (echec && !doitArreter(jobId)) {
    // Chrome introuvable ou impossible à démarrer : l'audit ne peut pas continuer.
    failJob(jobId, echec);
    journal.error({ jobId, err: echec }, 'échec de l’audit');
  } else if (doitArreter(jobId)) {
    stopJob(jobId);
    journal.info({ jobId, conservees: getJob(jobId)?.processedPages ?? 0 }, 'audit arrêté');
  } else {
    finishJob(jobId);
    journal.info({ jobId }, 'audit terminé');
  }
}

/* Arrêt du serveur */

// Arrêt propre : chaque processus d'audit tue son Chrome tout de suite (sans attendre la fin de la
// page), l'audit passe en `stopped` avec ses pages déjà auditées, puis on laisse aux tâches le
// temps d'écrire leur état final.
export async function arreterTaches(delaiMs = 8000) {
  arretServeur = true;

  const enCours = auditEnCours;
  if (enCours) for (const membre of enCours.equipe) arreterMembre(membre);

  const attentes = [...decouvertes];
  if (enCours) attentes.push(enCours.promesse);
  if (attentes.length === 0) return;

  let timer;
  await Promise.race([
    Promise.allSettled(attentes),
    new Promise((resolve) => {
      timer = setTimeout(resolve, delaiMs);
    }),
  ]);
  clearTimeout(timer);
}

// Filet de sécurité SYNCHRONE, pour `process.on('exit')` : si le process se termine sans être
// passé par `arreterTaches`, aucun processus d'audit ni aucun Chrome ne doit survivre.
export function tuerChromeRestant() {
  if (auditEnCours) for (const membre of auditEnCours.equipe) tuerArbre(membre);
}
