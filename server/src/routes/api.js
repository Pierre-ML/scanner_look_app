/** Routes API — JSON uniquement. */

import {
  ETATS_TERMINES,
  confirmJobSelection,
  countErrorPages,
  createJob,
  deleteJob,
  getJob,
  listJobs,
  requestCancel,
} from '../lib/store.js';
import {
  auditActif,
  interrompreAudit,
  lancerAudit,
  lancerDecouverte,
} from '../lib/taches.js';
import { trouverNavigateur } from '../lib/chrome.js';
import { capaciteMachine, resoudreMode } from '../lib/modes.js';
import { redemarrageNecessaire } from '../lib/fraicheur.js';
import { getEcoIndexGrade } from '../lib/ecoindex.js';
import { DUREE_PAGE_ESTIMEE_MS, ECOINDEX_DISCLAIMER, LIMITE_DECOUVERTE } from '../lib/config.js';
import { validateMaxPages, validateUrl } from '../lib/validate.js';
import { normalizeUrl } from '../lib/http.js';

export default async function apiRoutes(fastify) {
  /* Tout ce que renvoie cette API est un état vivant : jamais servi depuis un cache navigateur. */
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  /* GET /api/etat — le navigateur d'audit est-il disponible ? */
  fastify.get('/api/etat', async (request, reply) => {
    // Recherche refaite à chaque appel : l'utilisateur a pu installer Chrome entre-temps, ou
    // corriger CHROME_PATH (ce dernier demande un redémarrage).
    const navigateur = trouverNavigateur();

    return reply.send({
      navigateur: navigateur.trouve
        ? { trouve: true, nom: navigateur.nom, chemin: navigateur.chemin }
        : { trouve: false, erreur: navigateur.erreur },
      auditEnCours: auditActif(),
      // Pages mesurables en même temps (mode rapide), et ce qui la limite : voir modes.js.
      capacite: capaciteMachine(),
      // Code du serveur modifié depuis son démarrage : relancer `npm run dev` (voir fraicheur.js).
      redemarrageNecessaire: redemarrageNecessaire(),
    });
  });

  /* POST /api/discover — création du job + découverte des pages */
  fastify.post('/api/discover', async (request, reply) => {
    const body = request.body || {};

    const urlCheck = validateUrl(body.url);
    if (!urlCheck.ok) {
      return reply.code(400).send({ error: urlCheck.error, champ: 'url' });
    }

    const maxPages = validateMaxPages(body.maxPages);

    const jobId = createJob(urlCheck.url, maxPages);
    request.log.info({ jobId, url: urlCheck.url, maxPages }, 'job créé');
    lancerDecouverte(jobId);

    /* Fallback sans JavaScript : un <form> natif ne sait pas lire du JSON. */
    if (isFormSubmission(request)) {
      return reply.redirect(`/rapport/${jobId}`, 303);
    }

    return reply.code(201).send({
      jobId,
      url: urlCheck.url,
      maxPages,
      limiteDecouverte: LIMITE_DECOUVERTE,
      status: 'discovering',
    });
  });

  /* GET /api/discover/:jobId — résultat de la découverte */
  fastify.get('/api/discover/:jobId', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    return reply.send({
      jobId: job.id,
      targetUrl: job.targetUrl,
      status: job.status,
      // `true` dès que les pages sont proposées ou l'audit déjà lancé.
      ready: job.status !== 'discovering' && job.discoveredUrls.length > 0,
      sitemapUsed: job.sitemapUsed,
      discoveredUrls: job.discoveredUrls,
      maxPages: job.maxPages,
      limiteDecouverte: LIMITE_DECOUVERTE,
      error: job.error,
    });
  });

  /* POST /api/audit/:jobId — validation de la sélection + lancement */
  fastify.post('/api/audit/:jobId', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    const body = request.body || {};

    if (job.status !== 'reviewing') {
      return reply.code(409).send({
        error: 'Cet audit n’est plus en attente de validation.',
        status: job.status,
      });
    }

    // Un seul audit à la fois : une seule instance Chrome sur le poste.
    const actif = auditActif();
    if (actif !== null) {
      return reply.code(409).send({
        error: `Un audit est déjà en cours (n° ${actif}). Attendez sa fin ou arrêtez-le avant d’en lancer un autre.`,
        auditEnCours: actif,
      });
    }

    // Sans navigateur, inutile de lancer quoi que ce soit : message actionnable.
    const navigateur = trouverNavigateur();
    if (!navigateur.trouve) {
      return reply.code(503).send({ error: navigateur.erreur, champ: 'navigateur' });
    }

    const validation = validerSelection(body.selectedUrls, job);
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error });
    }

    // Mode d'audit choisi (économe, rapide, personnalisé) : voir modes.js.
    const reglages = resoudreMode(body.mode, body.simultanes, validation.urls.length);

    if (!confirmJobSelection(job.id, validation.urls, reglages)) {
      // L'état a changé entre la lecture et l'écriture (double clic…).
      return reply
        .code(409)
        .send({ error: 'Cet audit n’est plus en attente de validation.' });
    }

    lancerAudit(job.id);
    request.log.info(
      { jobId: job.id, retenues: validation.urls.length, navigateur: navigateur.nom, ...reglages },
      'sélection validée, audit lancé'
    );

    return reply.send({
      jobId: job.id,
      status: 'running',
      pages: validation.urls.length,
      selectedUrls: validation.urls,
      mode: reglages.mode,
      simultanes: reglages.simultanes,
      // Estimation affichée avant le premier résultat mesuré.
      dureeEstimeeMs: Math.ceil(validation.urls.length / reglages.simultanes) * DUREE_PAGE_ESTIMEE_MS,
    });
  });

  /* GET /api/status/:jobId — avancement en direct */
  fastify.get('/api/status/:jobId', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    const durees = job.pages
      .map((p) => p.durationMs)
      .filter((d) => typeof d === 'number' && d > 0);

    return reply.send({
      jobId: job.id,
      targetUrl: job.targetUrl,
      status: job.status,
      currentUrl: job.currentUrl,
      // Toutes les pages en cours de mesure (plusieurs en mode rapide ou personnalisé).
      currentUrls: job.currentUrls ?? (job.currentUrl ? [job.currentUrl] : []),
      mode: job.mode ?? 'personnalise',
      simultanes: job.simultanes ?? 1,
      sitemapUsed: job.sitemapUsed,
      // `processedPages` inclut les pages en erreur ; `errorPages` les isole.
      processedPages: job.processedPages,
      errorPages: countErrorPages(job.id),
      totalPages: job.totalPages,
      cancelRequested: job.cancelRequested,
      finished: ETATS_TERMINES.includes(job.status),
      error: job.error,
      progression: computeProgress(job, durees),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      auditStartedAt: job.auditStartedAt,
      finishedAt: job.finishedAt,
    });
  });

  /* GET /api/report/:jobId — rapport complet */
  fastify.get('/api/report/:jobId', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    return reply.send(construireRapport(job));
  });

  /* GET /api/report/:jobId/export — rapport à télécharger */
  fastify.get('/api/report/:jobId/export', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    let hote = 'site';
    try {
      hote = new URL(job.targetUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
    } catch {
      /* nom de fichier générique */
    }
    const jour = (job.createdAt || '').slice(0, 10);

    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="eco-audit-${job.id}-${hote}${jour ? `-${jour}` : ''}.json"`
      )
      .send(JSON.stringify(construireRapport(job), null, 2));
  });

  /* GET /api/jobs — historique : tous les audits enregistrés */
  fastify.get('/api/jobs', async (request, reply) => {
    return reply.send({
      jobs: listJobs().map((job) => ({
        jobId: job.id,
        targetUrl: job.targetUrl,
        status: job.status,
        createdAt: job.createdAt,
        processedPages: job.processedPages,
        errorPages: countErrorPages(job.id),
        averages: computeAverages(job.pages),
      })),
    });
  });

  /* POST /api/jobs/:jobId/cancel — arrêt immédiat */
  fastify.post('/api/jobs/:jobId/cancel', async (request, reply) => {
    const job = chargerJob(request, reply);
    if (!job) return reply;

    if (!requestCancel(job.id)) {
      return reply
        .code(409)
        .send({ error: 'Cet audit est déjà terminé.', status: job.status });
    }

    // Chrome est tué tout de suite : la page en cours est abandonnée, les pages déjà auditées
    // restent.
    interrompreAudit(job.id);
    request.log.info({ jobId: job.id }, 'arrêt demandé par l’utilisateur');

    return reply.send({ jobId: job.id, cancelRequested: true });
  });

  /* DELETE /api/jobs/:jobId — suppression */
  fastify.delete('/api/jobs/:jobId', async (request, reply) => {
    const jobId = parseJobId(request.params.jobId);
    if (jobId === null) {
      return reply.code(400).send({ error: 'Identifiant de job invalide.' });
    }

    const resultat = deleteJob(jobId);

    if (!resultat.ok && resultat.raison === 'introuvable') {
      return reply.code(404).send({ error: 'Audit introuvable ou déjà supprimé.' });
    }

    if (!resultat.ok) {
      // Un audit en cours produit encore des écritures : le supprimer ferait travailler la tâche
      // sur un job disparu.
      return reply.code(409).send({
        error: 'Cet audit est en cours : arrêtez-le d’abord, puis réessayez.',
        status: resultat.status,
      });
    }

    request.log.info({ jobId }, 'audit supprimé à la demande');

    return reply.send({ jobId, deleted: true });
  });
}

/* Helpers de requête */

/** `null` si l'identifiant n'est pas un entier positif. */
function parseJobId(raw) {
  const jobId = Number.parseInt(raw, 10);
  return Number.isInteger(jobId) && jobId > 0 ? jobId : null;
}

/** Charge le job de l'URL, ou remplit `reply` avec la bonne erreur et renvoie `null`. */
function chargerJob(request, reply) {
  const jobId = parseJobId(request.params.jobId);

  if (jobId === null) {
    reply.code(400).send({ error: 'Identifiant de job invalide.' });
    return null;
  }

  const job = getJob(jobId);
  if (!job) {
    reply.code(404).send({ error: 'Audit introuvable ou supprimé.' });
    return null;
  }

  return job;
}

/** Distingue une soumission de formulaire HTML d'un appel d'API. */
function isFormSubmission(request) {
  const contentType = request.headers['content-type'] || '';
  return contentType.includes('application/x-www-form-urlencoded');
}

/* Validation de la sélection */

/** Valide la liste de pages choisie par l'utilisateur. */
function validerSelection(urls, job) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return { ok: false, error: 'Sélectionnez au moins une page à auditer.' };
  }

  let origineCible;
  try {
    origineCible = new URL(job.targetUrl).origin;
  } catch {
    return { ok: false, error: 'URL cible invalide.' };
  }

  const retenues = [];
  const vues = new Set();

  for (const brute of urls) {
    if (typeof brute !== 'string') continue;

    const url = normalizeUrl(brute.trim());
    if (!url) continue;

    // Même origine que la cible, uniquement.
    let origine;
    try {
      origine = new URL(url).origin;
    } catch {
      continue;
    }
    if (origine !== origineCible) {
      return {
        ok: false,
        error: `La page ${brute} n’appartient pas au site audité (${origineCible}).`,
      };
    }

    if (vues.has(url)) continue;
    vues.add(url);
    retenues.push(url);
  }

  if (retenues.length === 0) {
    return { ok: false, error: 'Aucune page valide dans la sélection.' };
  }

  // Pas de plafond : en local, l'utilisateur audite autant de pages qu'il veut (l'interface le
  // prévient au-delà de 15 pages que ce sera long).
  return { ok: true, urls: retenues };
}

/* Rapport */

/** Rapport complet d'un job : servi en JSON et proposé à l'export. */
function construireRapport(job) {
  // Dans l'ordre de la sélection, et non dans l'ordre d'arrivée : en parallèle, les pages se
  // terminent dans le désordre.
  const rang = new Map(job.selectedUrls.map((url, i) => [url, i]));
  const pages = [...job.pages].sort((a, b) => (rang.get(a.url) ?? 1e9) - (rang.get(b.url) ?? 1e9));

  return {
    jobId: job.id,
    targetUrl: job.targetUrl,
    status: job.status,
    // Un rapport partiel reste lisible (audit arrêté ou encore en cours) : le front sait, grâce à
    // ce drapeau, s'il doit continuer à interroger.
    complete: ETATS_TERMINES.includes(job.status),
    sitemapUsed: job.sitemapUsed,
    selectedUrls: job.selectedUrls,
    totalPages: job.totalPages,
    processedPages: job.processedPages,
    errorPages: pages.filter((p) => p.status === 'error').length,
    pages,
    averages: computeAverages(pages),
    // `null` : aucune page mesurée ne porte de recommandations (audit antérieur à leur ajout).
    aCorriger: pages.some((p) => p.desktopRecommandations || p.mobileRecommandations)
      ? regrouperRecommandations(pages)
      : null,
    ecoindexDisclaimer: ECOINDEX_DISCLAIMER,
    // Mode d'audit : au-delà d'une page à la fois, les scores de performance sont moins fiables.
    mode: job.mode ?? 'personnalise',
    simultanes: job.simultanes ?? 1,
    error: job.error,
    createdAt: job.createdAt,
    auditStartedAt: job.auditStartedAt,
    finishedAt: job.finishedAt,
  };
}

/* À corriger */

/** Ordre d'affichage des catégories, celui des scores. */
const ORDRE_CATEGORIES = ['performance', 'accessibility', 'bestPractices', 'seo'];

// Regroupe les points à corriger de toutes les pages : un même audit en échec sur plusieurs pages
// n'apparaît qu'une fois, avec la liste des pages concernées (bureau, mobile ou les deux) et, pour
// chacune, la valeur et les éléments relevés par Lighthouse.
function regrouperRecommandations(pages) {
  const points = new Map();

  for (const page of pages) {
    for (const [support, liste] of [
      ['bureau', page.desktopRecommandations],
      ['mobile', page.mobileRecommandations],
    ]) {
      for (const reco of liste || []) {
        const cle = `${reco.categorie}:${reco.id}`;
        if (!points.has(cle)) {
          points.set(cle, {
            id: reco.id,
            categorie: reco.categorie,
            titre: reco.titre,
            description: reco.description,
            poids: reco.poids,
            // Pire score relevé (0 à 0,89) : fixe la gravité affichée, comme dans Lighthouse.
            score: reco.score,
            pages: new Map(),
          });
        }
        const point = points.get(cle);
        point.poids = Math.max(point.poids, reco.poids);
        point.score = Math.min(point.score, reco.score);
        if (!point.pages.has(page.url)) point.pages.set(page.url, { url: page.url });
        point.pages.get(page.url)[support] = { valeur: reco.valeur, elements: reco.elements };
      }
    }
  }

  const liste = [...points.values()].map((point) => ({ ...point, pages: [...point.pages.values()] }));

  return ORDRE_CATEGORIES.map((categorie) => ({
    categorie,
    points: liste
      .filter((point) => point.categorie === categorie)
      .sort((a, b) => b.pages.length - a.pages.length || b.poids - a.poids),
  }));
}

/* Progression et temps restant */

/** Avancement et estimation du temps restant. */
function computeProgress(job, durees) {
  const total = job.totalPages || 0;
  const faites = job.processedPages || 0;
  const restantes = Math.max(0, total - faites);

  const pourcent = total > 0 ? Math.round((faites / total) * 100) : 0;

  const moyenneMs =
    durees.length > 0
      ? durees.reduce((a, b) => a + b, 0) / durees.length
      : DUREE_PAGE_ESTIMEE_MS;

  const enCours = job.status === 'running';

  return {
    pourcent,
    faites,
    total,
    restantes,
    moyennePageMs: Math.round(moyenneMs),
    // `null` dès que l'audit ne tourne plus : afficher un temps restant sur un audit terminé
    // n'aurait aucun sens.
    restantMs: enCours ? Math.round(Math.ceil(restantes / (job.simultanes || 1)) * moyenneMs) : null,
    estimationMesuree: durees.length > 0,
  };
}

/* Moyennes */

/** Moyennes de synthèse. */
function computeAverages(pages) {
  const okPages = pages.filter((p) => p.status === 'ok');

  const avg = (values) => {
    const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
    if (nums.length === 0) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  };

  const desktop = {
    performance: avg(okPages.map((p) => p.desktopScores?.performance)),
    accessibility: avg(okPages.map((p) => p.desktopScores?.accessibility)),
    bestPractices: avg(okPages.map((p) => p.desktopScores?.bestPractices)),
    seo: avg(okPages.map((p) => p.desktopScores?.seo)),
  };

  const mobile = {
    performance: avg(okPages.map((p) => p.mobileScores?.performance)),
    accessibility: avg(okPages.map((p) => p.mobileScores?.accessibility)),
    bestPractices: avg(okPages.map((p) => p.mobileScores?.bestPractices)),
    seo: avg(okPages.map((p) => p.mobileScores?.seo)),
  };

  const ecoScore = avg(okPages.map((p) => p.ecoindex?.score));

  const ecoindex = {
    score: ecoScore,
    // La note moyenne est recalculée depuis le score moyen (et non une « moyenne de lettres », qui
    // n'aurait pas de sens).
    grade: ecoScore === null ? null : getEcoIndexGrade(ecoScore),
    ghg: avg(okPages.map((p) => p.ecoindex?.ghg)),
    water: avg(okPages.map((p) => p.ecoindex?.water)),
    dom: avg(okPages.map((p) => p.ecoindex?.dom)),
    requests: avg(okPages.map((p) => p.ecoindex?.requests)),
    sizeKo: avg(okPages.map((p) => p.ecoindex?.sizeKo)),
    count: okPages.filter((p) => p.ecoindex).length,
  };

  return {
    desktop,
    mobile,
    ecoindex,
    okCount: okPages.length,
    errorCount: pages.length - okPages.length,
  };
}
