/** Stockage des audits : en mémoire, recopié sur disque à chaque changement. */

import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from './config.js';

/** États depuis lesquels un job ne bougera plus tout seul. */
export const ETATS_TERMINES = ['done', 'stopped', 'error'];

/** id → job. */
const jobs = new Map();

/** Prochain identifiant : entier croissant, comme l'ancien AUTOINCREMENT. */
let prochainId = 1;

const maintenant = () => new Date().toISOString();

const cheminJob = (jobId) => path.join(DATA_DIR, `${jobId}.json`);

/* Persistance */

/** Écrit le job sur disque. */
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

/** Charge les audits enregistrés. */
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
        currentUrls: [],
        finishedAt: job.finishedAt || maintenant(),
      });
      enregistrer(job);
      interrompus++;
    }
  }

  return interrompus;
}

/* Lectures */

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/** Tous les audits, du plus récent au plus ancien. */
export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.id - a.id);
}

/** Nombre de pages terminées en erreur. */
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

/* Écritures */

/** Crée un job. */
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
    currentUrls: [],
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

/** Fige la sélection de l'utilisateur et passe le job en `running`. */
export function confirmJobSelection(jobId, urls, reglages = {}) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'reviewing') return false;
  modifier(jobId, {
    selectedUrls: urls,
    totalPages: urls.length,
    status: 'running',
    auditStartedAt: maintenant(),
    // Mode d'audit (voir modes.js) : combien de pages en même temps, à quelle priorité.
    mode: reglages.mode ?? 'personnalise',
    simultanes: reglages.simultanes ?? 1,
    prioriteBasse: Boolean(reglages.prioriteBasse),
  });
  return true;
}

/** Demande l'arrêt d'un job. */
export function requestCancel(jobId) {
  const job = jobs.get(jobId);
  if (!job || ETATS_TERMINES.includes(job.status)) return false;

  job.cancelRequested = true;

  if (job.status === 'reviewing') {
    Object.assign(job, { status: 'stopped', currentUrl: null, currentUrls: [], finishedAt: maintenant() });
  }

  enregistrer(job);
  return true;
}

/** Pages en cours de mesure (plusieurs en mode parallèle), affichées en direct dans le rapport. */
export function setJobPagesEnCours(jobId, urls) {
  // `currentUrl` (la première) reste servie pour les clients qui n'en lisent qu'une.
  modifier(jobId, { currentUrls: urls, currentUrl: urls[0] ?? null });
}

// Ajoute le résultat d'une page et incrémente le compteur du job dans la même écriture, pour que
// l'UI ne voie jamais un état incohérent.
export function savePageResult(jobId, page) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.pages.push({
    id: job.pages.length + 1,
    url: page.url,
    status: page.status,
    desktopScores: page.desktopScores || null,
    mobileScores: page.mobileScores || null,
    // Points en échec relevés par Lighthouse, texte d'origine (voir extractRecommandations).
    desktopRecommandations: page.desktopRecommandations || null,
    mobileRecommandations: page.mobileRecommandations || null,
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
  modifier(jobId, { status: 'done', currentUrl: null, currentUrls: [], finishedAt: maintenant() });
}

/** Arrêt demandé par l'utilisateur : les pages déjà auditées sont conservées. */
export function stopJob(jobId) {
  modifier(jobId, { status: 'stopped', currentUrl: null, currentUrls: [], finishedAt: maintenant() });
}

export function failJob(jobId, message) {
  modifier(jobId, {
    status: 'error',
    error: String(message).slice(0, 1000),
    currentUrl: null,
    currentUrls: [],
    finishedAt: maintenant(),
  });
}

/** Supprime un audit à la demande de l'utilisateur. */
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
