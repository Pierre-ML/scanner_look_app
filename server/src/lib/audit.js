/**
 * Exécution des audits Lighthouse.
 *
 * Deux runs par page, SÉQUENTIELS, sur une instance Chrome partagée :
 *   - desktop : formFactor 'desktop', throttling désactivé (par défaut)
 *   - mobile  : configuration par défaut de Lighthouse (mobile + 4G lente)
 *
 * L'éco-index est calculé à partir des audits du run DESKTOP uniquement,
 * pour que la mesure ne soit pas biaisée par le throttling mobile.
 *
 * Chrome n'est pas téléchargé : c'est celui de l'utilisateur (voir chrome.js),
 * piloté par puppeteer-core.
 */

import { spawnSync } from 'node:child_process';

import lighthouse from 'lighthouse';
import desktopPreset from 'lighthouse/core/config/desktop-config.js';
import puppeteer from 'puppeteer-core';

import { trouverNavigateur } from './chrome.js';
import { buildEcoIndex } from './ecoindex.js';

/** Catégories Lighthouse retenues (les 4 demandées). */
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/** Délai maximal accordé à un run Lighthouse (ms). */
const RUN_TIMEOUT_MS = Number(process.env.ECO_AUDIT_RUN_TIMEOUT || 180000);

/**
 * Configuration desktop : preset bureau officiel de Lighthouse (écran
 * 1350×940, user-agent bureau), avec deux modes de throttling au choix
 * (variable ECO_AUDIT_DESKTOP_THROTTLING) :
 *
 *   - `provided` (défaut) : Lighthouse ne simule aucune latence réseau ni
 *     ralentissement CPU et utilise les conditions réelles de la machine.
 *     C'est l'intérêt de l'outil en local : le score reflète VOTRE machine et
 *     VOTRE réseau. Les valeurs de `throttling` sont mises à zéro par cohérence.
 *   - `simulate` : preset tel quel (throttling simulé « desktopDense4G »),
 *     celui de PageSpeed Insights en bureau. Scores plus proches de PSI.
 */
export const MODE_THROTTLING_BUREAU =
  process.env.ECO_AUDIT_DESKTOP_THROTTLING === 'simulate' ? 'simulate' : 'provided';

const DESKTOP_CONFIG =
  MODE_THROTTLING_BUREAU === 'simulate'
    ? desktopPreset
    : {
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

/**
 * Configuration mobile : on laisse Lighthouse appliquer sa config par défaut
 * (formFactor 'mobile', throttling mobileSlow4G). `undefined` = défaut.
 */
const MOBILE_CONFIG = undefined;

/** Flags communs aux deux runs. */
const BASE_FLAGS = {
  output: 'json',
  logLevel: 'error',
  onlyCategories: CATEGORIES,
  // On ignore les erreurs de certificat : beaucoup de sites de préprod en ont.
  disableStorageReset: false,
};

/** Délai maximal accordé au démarrage de Chrome (ms). */
const LAUNCH_TIMEOUT_MS = Number(process.env.ECO_AUDIT_LAUNCH_TIMEOUT || 30000);

/** Délai accordé aux opérations de fermeture avant de tuer Chrome de force (ms). */
const CLOSE_TIMEOUT_MS = 10000;

/**
 * Flags Chrome.
 *
 * Retirés depuis le passage en local : `--no-sandbox` / `--disable-setuid-sandbox`
 * (utiles seulement sous Linux en root ; sous Windows, ils affaibliraient la
 * protection alors qu'on charge des sites arbitraires) et `--disable-dev-shm-usage`
 * (propre à /dev/shm sous Linux).
 *
 * Les flags anti-GPU ne sont plus appliqués par défaut. Sur un serveur SANS carte
 * graphique, ils évitaient que le rendu logiciel (SwiftShader/ANGLE) parte en
 * boucle à 500 % CPU dans le gpu-process ; sur un poste avec GPU, ils forceraient
 * au contraire une rastérisation logicielle qui ralentit le rendu et éloigne les
 * métriques (LCP, TBT) de ce que mesure DevTools. Ils restent disponibles avec
 * ECO_AUDIT_DISABLE_GPU=1, si Chrome se bloque sur une machine particulière.
 */
const CHROME_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  ...(process.env.ECO_AUDIT_DISABLE_GPU === '1'
    ? [
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-gpu-compositing',
        '--use-gl=disabled',
      ]
    : []),
];

/**
 * Tue Chrome de force, avec ses processus fils (gpu-process, renderers).
 *
 * Sous Windows, il n'y a pas de groupe de processus POSIX : `taskkill /T` tue
 * l'arbre complet à partir du PID du processus principal. Il passe AVANT le
 * kill simple : une fois le parent mort, l'arbre n'est plus retrouvable et
 * les fils resteraient orphelins. Appel SYNCHRONE, pour que la fonction reste
 * utilisable dans un handler `process.on('exit')`.
 *
 * Ailleurs, Chrome est lancé dans son propre groupe de processus : on envoie
 * SIGKILL au groupe entier pour ne laisser aucun fantôme.
 *
 * @param {import('puppeteer-core').Browser} browser
 */
export function killBrowser(browser) {
  const proc = browser?.process?.();
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

/**
 * Ferme Chrome proprement, puis de force si la fermeture traîne.
 * Ne throw jamais.
 *
 * @param {import('puppeteer-core').Browser} browser
 */
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

/**
 * Lance une instance Chrome unique, réutilisée pour toutes les pages du job.
 * Puppeteer lui donne un profil temporaire vierge : ni extensions, ni cache,
 * ni cookies de l'utilisateur ne viennent perturber les mesures.
 *
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
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

/**
 * Rejette la promesse si elle dépasse `ms`. Un run Lighthouse qui part en
 * vrille ne doit pas bloquer le reste de l'audit.
 */
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

/**
 * Rejette la promesse dès que Chrome se ferme (tué par un arrêt demandé par
 * l'utilisateur, ou planté). Sans cela, Lighthouse ne s'en aperçoit pas et
 * attend le timeout complet du run avant de rendre la main.
 */
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

/**
 * Exécute un run Lighthouse dans un onglet dédié, systématiquement refermé.
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} url
 * @param {object|undefined} config
 * @param {string} label 'desktop' ou 'mobile', pour les messages d'erreur
 * @returns {Promise<object>} le LHR (Lighthouse Result)
 */
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
      // Le timeout n'abandonne que l'attente côté JS : Chrome, lui, continue
      // de tourner (et de consommer du CPU). On le tue pour de bon ; la tâche
      // d'audit en relance un frais pour la page suivante.
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
    // L'onglet est fermé même en cas d'erreur, sinon Chrome accumule les
    // onglets zombies et la mémoire grimpe au fil des pages.
    // Sur un Chrome tué, close() peut ne jamais répondre : on plafonne l'attente,
    // et on ne l'attend pas du tout si Chrome est déjà fermé.
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

/**
 * Extrait les 4 scores d'un LHR, convertis de [0,1] vers [0,100].
 * Un score absent (catégorie non applicable) vaut `null`.
 *
 * @param {object} lhr
 * @returns {{performance: number|null, accessibility: number|null,
 *            bestPractices: number|null, seo: number|null}}
 */
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

/**
 * Extrait les 3 métriques brutes nécessaires à l'éco-index.
 *
 * Notes sur les identifiants d'audit (Lighthouse 13) :
 *   - le DOM vient de `dom-size-insight` (ex-`dom-size`), dont
 *     `numericValue` est le nombre total d'éléments ;
 *   - les requêtes viennent du nombre d'entrées de `network-requests` ;
 *   - le poids vient de `total-byte-weight` (`numericValue` en octets).
 *
 * Chaque métrique a un repli, car un audit peut être `notApplicable`.
 *
 * @param {object} lhr LHR du run desktop
 * @returns {{dom: number, requests: number, sizeKo: number}|null}
 */
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

/**
 * Audite une page : run desktop, run mobile, puis calcul de l'éco-index.
 *
 * Cette fonction ne throw JAMAIS : elle renvoie toujours un objet exploitable.
 * Une page cassée produit `{status: 'error'}` et l'audit du site continue.
 *
 * @param {import('puppeteer-core').Browser} browser instance Chrome partagée
 * @param {string} url
 * @returns {Promise<{url: string, status: 'ok'|'error',
 *                    desktopScores: object|null, mobileScores: object|null,
 *                    ecoindex: object|null, error: string|null}>}
 */
export async function auditPage(browser, url) {
  const result = {
    url,
    status: 'error',
    desktopScores: null,
    mobileScores: null,
    ecoindex: null,
    error: null,
  };

  const errors = [];

  /* --- Run 1 : desktop (sert aussi de base à l'éco-index) --- */
  try {
    const lhr = await runLighthouse(browser, url, DESKTOP_CONFIG, 'desktop');
    result.desktopScores = extractScores(lhr);

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
  } catch (err) {
    errors.push(`mobile : ${err.message}`);
  }

  // La page compte comme auditée dès qu'au moins un run a abouti.
  result.status = result.desktopScores || result.mobileScores ? 'ok' : 'error';
  result.error = errors.length > 0 ? errors.join(' | ') : null;

  return result;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
