/**
 * Stockage des audits : en mémoire, recopié sur disque à chaque changement.
 *
 * Un fichier JSON par audit, dans `data/audits/<id>.json` (dossier ignoré par
 * git). Rien ne quitte la machine, et rien n'est supprimé automatiquement :
 * l'utilisateur garde son historique jusqu'à ce qu'il l'efface lui-même.
 *
 * Pourquoi pas SQLite : un seul process, un seul audit à la fois et quelques
 * dizaines d'audits au plus — un fichier par audit suffit, et évite une
 * dépendance native (better-sqlite3) à compiler sous Windows.
 *
 * ------------------------------------------------------------------------
 * Cycle de vie d'un job
 * ------------------------------------------------------------------------
 *   discovering   recherche des pages (sitemap ou crawl)
 *   reviewing     pages trouvées, en attente du choix de l'utilisateur
 *   running       audits Lighthouse en cours
 *   done          terminé
 *   stopped       interrompu par l'utilisateur (les pages déjà auditées restent)
 *   error         échec global
 */

import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from './config.js';

/** États depuis lesquels un job ne bougera plus tout seul. */
export const ETATS_TERMINES = ['done', 'stopped', 'error'];

/** id → job. Source de vérité pendant que le serveur tourne. */
const jobs = new Map();

/** Prochain identifiant : entier croissant, comme l'ancien AUTOINCREMENT. */
let prochainId = 1;

const maintenant = () => new Date().toISOString();

const cheminJob = (jobId) => path.join(DATA_DIR, `${jobId}.json`);

/* ==========================================================================
 * Persistance
 * ======================================================================== */

/**
 * Écrit le job sur disque. Écriture dans un fichier temporaire puis renommage :
 * un arrêt brutal pendant l'écriture ne laisse jamais un JSON à moitié écrit.
 *
 * Sous Windows, le renommage peut échouer brièvement (EPERM / EBUSY) si un
 * antivirus ou l'indexeur tient le fichier : on réessaie quelques fois.
 */
function enregistrer(job) {
  const cible = cheminJob(job.id);
  const temporaire = `${cible}.tmp`;
  fs.writeFileSync(temporaire, JSON.stringify(job, null, 2));

  for (let essai = 0; ; essai++) {
    try {
      fs.renameSync(temporaire, cible);
      return;
    } catch (err) {
      if (essai >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      // Attente active très courte : le cas est rare et l'écriture reste synchrone.
      const fin = Date.now() + 50 * (essai + 1);
      while (Date.now() < fin);
    }
  }
}

/** Applique une modification à un job existant, puis l'enregistre. */
function modifier(jobId, changements) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, changements);
  enregistrer(job);
  return job;
}

/**
 * Charge les audits enregistrés. Appelé une fois, au démarrage du serveur.
 *
 * Un job resté dans un état actif vient d'un serveur arrêté brutalement
 * pendant le traitement (fenêtre fermée, processus tué) : il est clos, en
 * gardant les pages déjà auditées, plutôt que relancé.
 *
 * @returns {number} nombre de jobs interrompus remis en ordre
 */
export function chargerAudits() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let interrompus = 0;

  for (const fichier of fs.readdirSync(DATA_DIR)) {
    if (!/^\d+\.json$/.test(fichier)) continue;

    let job;
    try {
      job = JSON.parse(fs.readFileSync(path.join(DATA_DIR, fichier), 'utf8'));
    } catch {
      // Fichier illisible (modifié à la main…) : ignoré, jamais supprimé.
      continue;
    }
    if (!Number.isInteger(job?.id) || job.id <= 0) continue;

    jobs.set(job.id, job);
    prochainId = Math.max(prochainId, job.id + 1);

    if (!ETATS_TERMINES.includes(job.status)) {
      Object.assign(job, {
        status: job.processedPages > 0 ? 'stopped' : 'error',
        error:
          job.processedPages > 0
            ? null
            : 'Audit interrompu : le serveur a été arrêté pendant le traitement.',
        currentUrl: null,
        finishedAt: job.finishedAt || maintenant(),
      });
      enregistrer(job);
      interrompus++;
    }
  }

  return interrompus;
}

/* ==========================================================================
 * Lectures
 * ======================================================================== */

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/** Tous les audits, du plus récent au plus ancien. */
export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.id - a.id);
}

/**
 * Nombre de pages terminées en erreur.
 *
 * `processedPages` compte TOUTES les pages traitées, erreurs comprises :
 * sans ce compteur séparé, le front ne pourrait pas distinguer « 10 pages
 * auditées » de « 10 pages tentées dont 7 en échec ».
 */
export function countErrorPages(jobId) {
  const job = jobs.get(jobId);
  return job ? job.pages.filter((p) => p.status === 'error').length : 0;
}

/** Lecture du seul drapeau d'annulation : appelée entre chaque étape. */
export function isCancelRequested(jobId) {
  const job = jobs.get(jobId);
  // Job disparu (supprimé pendant l'audit) : on traite comme une annulation.
  return !job || job.cancelRequested;
}

/* ==========================================================================
 * Écritures
 * ======================================================================== */

/**
 * Crée un job. Il part en `discovering` : la recherche des pages démarre
 * aussitôt, l'utilisateur choisira ensuite lesquelles auditer.
 *
 * @param {string} targetUrl
 * @param {number} maxPages nombre max de pages à découvrir, déjà validé
 * @returns {number} identifiant du job
 */
export function createJob(targetUrl, maxPages) {
  const job = {
    id: prochainId++,
    targetUrl,
    maxPages,
    status: 'discovering',
    // true = pages issues d'un sitemap, false = crawl, null = pas encore découvert
    sitemapUsed: null,
    // Pages trouvées par la découverte, avant tri par l'utilisateur
    discoveredUrls: [],
    // Pages réellement retenues pour l'audit, figées à la validation
    selectedUrls: [],
    totalPages: 0,
    processedPages: 0,
    currentUrl: null,
    cancelRequested: false,
    error: null,
    createdAt: maintenant(),
    startedAt: maintenant(),
    // Début des audits (après validation) : sert au calcul du temps restant
    auditStartedAt: null,
    finishedAt: null,
    pages: [],
  };
  jobs.set(job.id, job);
  enregistrer(job);
  return job.id;
}

/** Enregistre le résultat de la découverte et passe la main à l'utilisateur. */
export function setJobDiscovered(jobId, { sitemapUsed, urls }) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'discovering') return;
  modifier(jobId, {
    sitemapUsed: Boolean(sitemapUsed),
    discoveredUrls: urls,
    totalPages: urls.length,
    status: 'reviewing',
  });
}

/**
 * Fige la sélection de l'utilisateur et passe le job en `running`.
 * `false` si le job n'est plus en attente de validation (double clic…).
 */
export function confirmJobSelection(jobId, urls) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'reviewing') return false;
  modifier(jobId, {
    selectedUrls: urls,
    totalPages: urls.length,
    status: 'running',
    auditStartedAt: maintenant(),
  });
  return true;
}

/**
 * Demande l'arrêt d'un job. Un job en attente de sélection est arrêté tout de
 * suite : aucune tâche ne tourne pour lui, personne d'autre ne le fermera.
 *
 * @returns {boolean} `false` si le job est déjà terminé
 */
export function requestCancel(jobId) {
  const job = jobs.get(jobId);
  if (!job || ETATS_TERMINES.includes(job.status)) return false;

  job.cancelRequested = true;

  if (job.status === 'reviewing') {
    Object.assign(job, { status: 'stopped', currentUrl: null, finishedAt: maintenant() });
  }

  enregistrer(job);
  return true;
}

/** URL en cours d'audit, affichée en direct dans la console. */
export function setJobCurrentUrl(jobId, url) {
  modifier(jobId, { currentUrl: url });
}

/**
 * Ajoute le résultat d'une page et incrémente le compteur du job dans la même
 * écriture, pour que l'UI ne voie jamais un état incohérent.
 */
export function savePageResult(jobId, page) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.pages.push({
    id: job.pages.length + 1,
    url: page.url,
    status: page.status,
    desktopScores: page.desktopScores || null,
    mobileScores: page.mobileScores || null,
    ecoindex: page.ecoindex || null,
    error: page.error || null,
    // Durée du traitement de la page : alimente l'estimation du temps restant
    durationMs: page.durationMs || null,
    auditedAt: maintenant(),
  });
  job.processedPages = job.pages.length;
  enregistrer(job);
}

export function finishJob(jobId) {
  modifier(jobId, { status: 'done', currentUrl: null, finishedAt: maintenant() });
}

/** Arrêt demandé par l'utilisateur : les pages déjà auditées sont conservées. */
export function stopJob(jobId) {
  modifier(jobId, { status: 'stopped', currentUrl: null, finishedAt: maintenant() });
}

export function failJob(jobId, message) {
  modifier(jobId, {
    status: 'error',
    error: String(message).slice(0, 1000),
    currentUrl: null,
    finishedAt: maintenant(),
  });
}

/**
 * Supprime un audit à la demande de l'utilisateur.
 *
 * Un audit en cours de production de données (`discovering`, `running`) n'est
 * JAMAIS supprimé : la tâche écrirait juste après dans un job disparu.
 * L'appelant doit d'abord demander l'arrêt, puis supprimer.
 *
 * @returns {{ok: true} | {ok: false, raison: 'introuvable'|'en_cours', status?: string}}
 */
export function deleteJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, raison: 'introuvable' };

  if (job.status === 'running' || job.status === 'discovering') {
    return { ok: false, raison: 'en_cours', status: job.status };
  }

  jobs.delete(jobId);
  fs.rmSync(cheminJob(jobId), { force: true });
  return { ok: true };
}
