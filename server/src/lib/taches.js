/**
 * Tâches de fond : découverte des pages, puis audits Lighthouse.
 *
 * Elles tournent dans le process du serveur Fastify, en tâches asynchrones :
 * sur le poste de l'utilisateur, il n'y a ni file d'attente ni worker séparé.
 *
 * Garanties d'exécution :
 *   - UN SEUL audit à la fois (une seule instance Chrome) : un second
 *     lancement est refusé tant que le premier tourne ;
 *   - les pages d'un audit sont auditées une par une, jamais en parallèle ;
 *   - une page en échec ou en timeout n'arrête pas l'audit du site ;
 *   - l'arrêt demandé par l'utilisateur est IMMÉDIAT : Chrome est tué, la
 *     page en cours est abandonnée, les pages déjà auditées sont conservées.
 *
 * Les découvertes, elles, ne lancent aucun navigateur (simples requêtes HTTP) :
 * elles peuvent tourner pendant un audit.
 */

import {
  failJob,
  finishJob,
  getJob,
  isCancelRequested,
  savePageResult,
  setJobCurrentUrl,
  setJobDiscovered,
  stopJob,
} from './store.js';
import { auditPage, closeBrowser, killBrowser, launchBrowser } from './audit.js';
import { discoverPages } from './discover.js';
import { LIMITE_DECOUVERTE } from './config.js';

/** Journal des tâches : le logger Fastify, branché par server.js. */
let journal = console;

export function brancherJournal(logger) {
  journal = logger;
}

/** Audit en cours : `{ jobId, browser, promesse }`, ou `null`. */
let auditEnCours = null;

/** Découvertes en cours, pour pouvoir les attendre à l'arrêt du serveur. */
const decouvertes = new Set();

/** Passe à `true` à l'arrêt du serveur : plus aucune page n'est lancée. */
let arretServeur = false;

/** Identifiant de l'audit en cours, ou `null`. */
export function auditActif() {
  return auditEnCours ? auditEnCours.jobId : null;
}

/* ==========================================================================
 * Phase 1 — découverte des pages
 * ======================================================================== */

/**
 * Lance la découverte en arrière-plan. Ne rejette jamais.
 * @param {number} jobId
 */
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

/**
 * Cherche les pages du site et rend la main à l'utilisateur.
 * Aucun navigateur n'est lancé ici : ce sont de simples requêtes HTTP.
 */
async function runDiscovery(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  journal.info({ jobId, url: job.targetUrl }, 'découverte des pages');

  // Le garde-fou de découverte s'applique même si le fichier contenait une
  // valeur plus élevée (modification manuelle…).
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

/* ==========================================================================
 * Phase 2 — audits Lighthouse
 * ======================================================================== */

/**
 * Lance l'audit en arrière-plan. L'appelant a déjà vérifié qu'aucun autre
 * audit ne tourne (`auditActif()`) et passé le job en `running`.
 *
 * @param {number} jobId
 */
export function lancerAudit(jobId) {
  // Réservation synchrone, AVANT tout `await` : deux lancements rapprochés ne
  // peuvent pas passer tous les deux.
  const reservation = { jobId, browser: null, promesse: null };
  auditEnCours = reservation;

  reservation.promesse = runAudit(jobId)
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

/**
 * Arrêt immédiat de l'audit en cours : Chrome est tué, ce qui fait échouer
 * sans attendre le run Lighthouse en cours. `runAudit` voit ensuite le drapeau
 * d'annulation, abandonne la page interrompue et ferme le job en `stopped`.
 */
export function interrompreAudit(jobId) {
  if (auditEnCours?.jobId === jobId && auditEnCours.browser) {
    killBrowser(auditEnCours.browser);
  }
}

/** Doit-on s'arrêter avant la page suivante ? */
function doitArreter(jobId) {
  return arretServeur || isCancelRequested(jobId);
}

/** Audite les pages retenues par l'utilisateur, une par une. */
async function runAudit(jobId) {
  const job = getJob(jobId);
  const urls = job?.selectedUrls || [];

  if (urls.length === 0) {
    failJob(jobId, 'Aucune page sélectionnée pour l’audit.');
    return;
  }

  journal.info({ jobId, pages: urls.length }, 'audit démarré');

  let browser;

  try {
    browser = await launchBrowser();
    auditEnCours.browser = browser;
    journal.info({ jobId }, 'instance Chrome démarrée');

    for (let i = 0; i < urls.length; i++) {
      // Arrêt demandé par l'utilisateur, ou serveur en cours d'extinction :
      // on s'arrête proprement EN CONSERVANT les pages déjà auditées.
      if (doitArreter(jobId)) {
        stopJob(jobId);
        journal.info({ jobId, conservees: i }, `audit arrêté à la page ${i + 1}/${urls.length}`);
        return;
      }

      // Chrome a pu être tué (timeout Lighthouse) : on en relance un frais.
      if (!browser.connected) {
        await closeBrowser(browser);
        browser = await launchBrowser();
        auditEnCours.browser = browser;
        journal.info({ jobId }, 'Chrome relancé après blocage');
      }

      const url = urls[i];
      setJobCurrentUrl(jobId, url);
      journal.info({ jobId }, `page ${i + 1}/${urls.length} - ${url}`);

      // auditPage ne throw pas : une page en échec est enregistrée en
      // statut 'error' et l'audit du site continue.
      const debut = Date.now();
      const pageResult = await auditPage(browser, url);
      pageResult.durationMs = Date.now() - debut;

      // Arrêt pendant la page : Chrome a été tué en plein run, le résultat
      // est incomplet. On l'abandonne plutôt que d'afficher une fausse erreur.
      if (doitArreter(jobId)) {
        stopJob(jobId);
        journal.info({ jobId, conservees: i }, `audit arrêté pendant la page ${i + 1}/${urls.length}`);
        return;
      }

      savePageResult(jobId, pageResult);

      if (pageResult.status === 'error') {
        journal.warn({ jobId, url, err: pageResult.error }, 'page en erreur');
      }
    }

    finishJob(jobId);
    journal.info({ jobId }, 'audit terminé');
  } catch (err) {
    // Erreur globale : Chrome introuvable ou impossible à démarrer, etc.
    if (doitArreter(jobId)) {
      stopJob(jobId);
    } else {
      failJob(jobId, err.message);
      journal.error({ jobId, err: err.message }, 'échec de l’audit');
    }
  } finally {
    // Chrome est TOUJOURS fermé en fin de job.
    if (browser) {
      await closeBrowser(browser);
      journal.info({ jobId }, 'instance Chrome fermée');
    }
  }
}

/* ==========================================================================
 * Arrêt du serveur
 * ======================================================================== */

/**
 * Arrêt propre : Chrome est tué tout de suite (sans attendre la fin de la
 * page), l'audit passe en `stopped` avec ses pages déjà auditées, puis on
 * laisse aux tâches le temps d'écrire leur état final.
 *
 * @param {number} delaiMs attente maximale des tâches
 */
export async function arreterTaches(delaiMs = 5000) {
  arretServeur = true;

  const enCours = auditEnCours;
  if (enCours?.browser) killBrowser(enCours.browser);

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

/**
 * Filet de sécurité SYNCHRONE, pour `process.on('exit')` : si le process se
 * termine sans être passé par `arreterTaches`, Chrome ne doit pas survivre.
 */
export function tuerChromeRestant() {
  if (auditEnCours?.browser) killBrowser(auditEnCours.browser);
}
