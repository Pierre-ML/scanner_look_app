/** Exécution des audits Lighthouse. */

import { spawnSync } from 'node:child_process';

import lighthouse from 'lighthouse';
import desktopPreset from 'lighthouse/core/config/desktop-config.js';
import puppeteer from 'puppeteer-core';

import { trouverNavigateur } from './chrome.js';
import { buildEcoIndex } from './ecoindex.js';

/** Catégories Lighthouse retenues (les 4 demandées). */
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/** Délai maximal accordé à un run Lighthouse (ms). */
export const RUN_TIMEOUT_MS = 180_000;

// Configuration desktop : preset bureau officiel de Lighthouse (écran 1350×940, user-agent
// bureau), avec deux modes de throttling au choix (variable ECO_AUDIT_DESKTOP_THROTTLING) :
const DESKTOP_CONFIG = {
  ...desktopPreset,
  settings: {
    ...desktopPreset.settings,
    throttlingMethod: 'provided',
    throttling: {
      rttMs: 0,
      throughputKbps: 0,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    },
  },
};

// Configuration mobile : on laisse Lighthouse appliquer sa config par défaut (formFactor 'mobile',
// throttling mobileSlow4G).
const MOBILE_CONFIG = undefined;

/** Flags communs aux deux runs. */
const BASE_FLAGS = {
  output: 'json',
  logLevel: 'error',
  onlyCategories: CATEGORIES,
  // Textes des audits (titres, explications) en français : ce sont eux que le rapport affiche dans
  // « À corriger ».
  locale: 'fr',
  // On ignore les erreurs de certificat : beaucoup de sites de préprod en ont.
  disableStorageReset: false,
};

/** Délai maximal accordé au démarrage de Chrome (ms). */
const LAUNCH_TIMEOUT_MS = 30_000;

/** Délai accordé aux opérations de fermeture avant de tuer Chrome de force (ms). */
const CLOSE_TIMEOUT_MS = 10000;

/** Flags Chrome. */
const CHROME_ARGS = ['--no-first-run', '--no-default-browser-check'];

/** Tue Chrome de force, avec ses processus fils (gpu-process, renderers). */
export function killBrowser(browser) {
  tuerArbre(browser?.process?.());
}

/** Tue un processus fils et tous ses descendants (voir `killBrowser`). */
export function tuerArbre(proc) {
  if (!proc || !proc.pid) return;
  // Déjà terminé : rien à tuer, et son PID a pu être réattribué à un autre process.
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10000,
      });
    } catch {
      // taskkill indisponible : on retombe sur le kill simple ci-dessous
    }
  } else {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // groupe inexistant : on retombe sur le kill simple ci-dessous
    }
  }
  try {
    proc.kill('SIGKILL');
  } catch {
    // déjà mort
  }
}

/** Ferme Chrome proprement, puis de force si la fermeture traîne. */
export async function closeBrowser(browser) {
  if (!browser) return;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
  });
  await Promise.race([browser.close().catch(() => {}), timedOut]);
  clearTimeout(timer);
  // Filet de sécurité : no-op si Chrome est déjà terminé.
  killBrowser(browser);
}

/** Lance une instance Chrome unique, réutilisée pour toutes les pages du job. */
export async function launchBrowser() {
  const navigateur = trouverNavigateur();
  if (!navigateur.trouve) throw new Error(navigateur.erreur);

  return puppeteer.launch({
    executablePath: navigateur.chemin,
    headless: true,
    // Chrome doit exposer son port de debug dans ce délai, sinon échec net.
    timeout: LAUNCH_TIMEOUT_MS,
    args: CHROME_ARGS,
    // Les signaux sont gérés par server.js, qui ferme Chrome lui-même (taskkill /T).
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

/** Rejette la promesse si elle dépasse `ms`. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout Lighthouse (${ms} ms) - ${label}`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Rejette la promesse dès que Chrome se ferme (tué par un arrêt demandé par l'utilisateur, ou
// planté).
function tantQueConnecte(promise, browser, label) {
  let surFermeture;
  const fermeture = new Promise((_, reject) => {
    surFermeture = () => reject(new Error(`Chrome fermé pendant le run - ${label}`));
    if (!browser.connected) surFermeture();
    else browser.once('disconnected', surFermeture);
  });
  return Promise.race([promise, fermeture]).finally(() =>
    browser.off('disconnected', surFermeture)
  );
}

/** Exécute un run Lighthouse dans un onglet dédié, systématiquement refermé. */
async function runLighthouse(browser, url, config, label) {
  const page = await withTimeout(
    browser.newPage(),
    CLOSE_TIMEOUT_MS,
    `ouverture d'onglet ${label} ${url}`
  ).catch((err) => {
    killBrowser(browser);
    throw err;
  });

  try {
    let result;
    try {
      result = await withTimeout(
        tantQueConnecte(lighthouse(url, BASE_FLAGS, config, page), browser, `${label} ${url}`),
        RUN_TIMEOUT_MS,
        `${label} ${url}`
      );
    } catch (err) {
      // Le timeout n'abandonne que l'attente côté JS : Chrome, lui, continue de tourner (et de
      // consommer du CPU).
      if (/^Timeout Lighthouse/.test(err.message)) killBrowser(browser);
      throw err;
    }

    if (!result || !result.lhr) {
      throw new Error(`Lighthouse n'a retourné aucun résultat (${label})`);
    }

    // runtimeError = la page n'a pas pu être chargée du tout (DNS, 500, …).
    const runtimeError = result.lhr.runtimeError;
    if (runtimeError && runtimeError.code !== 'NO_ERROR') {
      throw new Error(`${runtimeError.code} : ${runtimeError.message}`);
    }

    return result.lhr;
  } finally {
    // L'onglet est fermé même en cas d'erreur, sinon Chrome accumule les onglets zombies et la
    // mémoire grimpe au fil des pages.
    if (browser.connected) {
      let timer;
      await Promise.race([
        page.close().catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
  }
}

/** Extrait les 4 scores d'un LHR, convertis de [0,1] vers [0,100]. */
export function extractScores(lhr) {
  const toPercent = (category) => {
    const score = lhr.categories?.[category]?.score;
    return typeof score === 'number' ? Math.round(score * 100) : null;
  };

  return {
    performance: toPercent('performance'),
    accessibility: toPercent('accessibility'),
    bestPractices: toPercent('best-practices'),
    seo: toPercent('seo'),
  };
}

/** Extrait les 3 métriques brutes nécessaires à l'éco-index. */
export function extractEcoMetrics(lhr) {
  const audits = lhr.audits || {};

  /* --- Nombre d'éléments du DOM --- */
  const domAudit = audits['dom-size-insight'] || audits['dom-size'];
  let dom = numberOrNull(domAudit?.numericValue);
  if (dom === null) {
    // Repli : l'insight range aussi le total dans debugData.
    dom = numberOrNull(domAudit?.details?.debugData?.totalElements);
  }

  /* --- Nombre de requêtes réseau --- */
  const requestItems = audits['network-requests']?.details?.items;
  let requests = Array.isArray(requestItems) ? requestItems.length : null;
  if (requests === null) {
    // Repli : resource-summary agrège le total par type de ressource.
    const summary = audits['resource-summary']?.details?.items;
    const total = Array.isArray(summary)
      ? summary.find((i) => i.resourceType === 'total')
      : null;
    requests = numberOrNull(total?.requestCount);
  }

  /* --- Poids total transféré --- */
  let sizeBytes = numberOrNull(audits['total-byte-weight']?.numericValue);
  if (sizeBytes === null) {
    const summary = audits['resource-summary']?.details?.items;
    const total = Array.isArray(summary)
      ? summary.find((i) => i.resourceType === 'total')
      : null;
    sizeBytes = numberOrNull(total?.transferSize);
  }

  // Sans les trois métriques, l'éco-index n'a pas de sens : on ne l'invente pas.
  if (dom === null || requests === null || sizeBytes === null) return null;

  return {
    dom: Math.round(dom),
    requests: Math.round(requests),
    sizeKo: sizeBytes / 1024,
  };
}

/** Audite une page : run desktop, run mobile, puis calcul de l'éco-index. */
export async function auditPage(browser, url) {
  const result = {
    url,
    status: 'error',
    desktopScores: null,
    mobileScores: null,
    desktopRecommandations: null,
    mobileRecommandations: null,
    ecoindex: null,
    error: null,
  };

  const errors = [];

  /* --- Run 1 : desktop (sert aussi de base à l'éco-index) --- */
  try {
    const lhr = await runLighthouse(browser, url, DESKTOP_CONFIG, 'desktop');
    result.desktopScores = extractScores(lhr);
    result.desktopRecommandations = extractRecommandations(lhr);

    const metrics = extractEcoMetrics(lhr);
    if (metrics) {
      result.ecoindex = buildEcoIndex(metrics);
    } else {
      errors.push('éco-index non calculable (métriques Lighthouse absentes)');
    }
  } catch (err) {
    errors.push(`desktop : ${err.message}`);
  }

  /* --- Run 2 : mobile --- */
  try {
    const lhr = await runLighthouse(browser, url, MOBILE_CONFIG, 'mobile');
    result.mobileScores = extractScores(lhr);
    result.mobileRecommandations = extractRecommandations(lhr);
  } catch (err) {
    errors.push(`mobile : ${err.message}`);
  }

  // La page compte comme auditée dès qu'au moins un run a abouti.
  result.status = result.desktopScores || result.mobileScores ? 'ok' : 'error';
  result.error = errors.length > 0 ? errors.join(' | ') : null;

  return result;
}

/** Clés des catégories Lighthouse, telles que les scores les nomment côté API. */
const CLES_CATEGORIES = {
  performance: 'performance',
  accessibility: 'accessibility',
  'best-practices': 'bestPractices',
  seo: 'seo',
};

// Groupes d'audits qui ne sont PAS des corrections : `metrics` rassemble les mesures (LCP, TBT…),
// déjà résumées par le score de performance ; `hidden` contient ce que Lighthouse lui-même
// n'affiche pas dans son rapport.
const GROUPES_EXCLUS = new Set(['metrics', 'hidden']);

/** Modes d'audit sans verdict réussi / échoué : à vérifier à la main, sans objet, ou informatif. */
const MODES_EXCLUS = new Set(['notApplicable', 'manual', 'informative', 'error']);

/** Au plus 5 éléments concernés par audit : de quoi situer le problème, sans alourdir le rapport. */
const MAX_ELEMENTS = 5;

// Ce que Lighthouse demande de corriger sur la page : les audits en échec, avec le texte que
// Lighthouse fournit lui-même (titre, explication avec liens, valeur), et les premiers éléments
// concernés.
export function extractRecommandations(lhr) {
  const resultat = [];

  for (const [cleLighthouse, categorie] of Object.entries(lhr.categories || {})) {
    const cle = CLES_CATEGORIES[cleLighthouse];
    if (!cle) continue;

    for (const ref of categorie.auditRefs || []) {
      if (GROUPES_EXCLUS.has(ref.group)) continue;
      const audit = lhr.audits?.[ref.id];
      if (!audit || MODES_EXCLUS.has(audit.scoreDisplayMode)) continue;
      if (typeof audit.score !== 'number' || audit.score >= 0.9) continue;

      resultat.push({
        id: ref.id,
        categorie: cle,
        titre: audit.title,
        description: audit.description || '',
        valeur: audit.displayValue || null,
        score: audit.score,
        poids: ref.weight || 0,
        elements: extraireElements(audit),
      });
    }
  }

  return resultat;
}

// Libellés des premiers éléments concernés par un audit, tels que Lighthouse les décrit : extrait
// HTML de l'élément, adresse de la ressource, ou lien.
function extraireElements(audit) {
  const items = Array.isArray(audit.details?.items) ? audit.details.items : [];
  const libelles = [];

  for (const item of items) {
    const libelle =
      item.node?.snippet ||
      (typeof item.url === 'string' && item.url) ||
      item.source?.url ||
      (typeof item.href === 'string' && item.href) ||
      item.node?.nodeLabel ||
      null;
    if (typeof libelle !== 'string' || libelle.trim() === '') continue;
    const propre = libelle.trim().replace(/\s+/g, ' ');
    if (libelles.includes(propre)) continue;
    libelles.push(propre.length > 200 ? `${propre.slice(0, 199)}…` : propre);
    if (libelles.length >= MAX_ELEMENTS) break;
  }

  return libelles;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
