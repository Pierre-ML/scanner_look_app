/** Découverte des pages à auditer. */

import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import robotsParser from 'robots-parser';

import {
  fetchText,
  fetchWithTimeout,
  isSameOrigin,
  looksLikeHtmlUrl,
  normalizeUrl,
  USER_AGENT,
} from './http.js';

/** Profondeur max de sitemap index imbriqués, pour éviter les boucles. */
const MAX_SITEMAP_DEPTH = 3;

/** Nombre max de fichiers sitemap téléchargés pour un même job. */
const MAX_SITEMAP_FILES = 50;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

/** Charge et parse le robots.txt du site. */
export async function loadRobots(origin) {
  const robotsUrl = `${origin}/robots.txt`;
  const body = await fetchText(robotsUrl);

  // Pas de robots.txt (404, timeout, erreur réseau) : ce n'est pas bloquant.
  if (!body) return { robots: null, sitemaps: [] };

  try {
    const robots = robotsParser(robotsUrl, body);
    const sitemaps = (robots.getSitemaps() || [])
      .map((s) => normalizeUrl(s, origin))
      .filter(Boolean);
    return { robots, sitemaps };
  } catch {
    return { robots: null, sitemaps: [] };
  }
}

/** Une URL est-elle autorisée pour notre user-agent ? */
function isAllowed(robots, url) {
  if (!robots) return true;
  try {
    // isAllowed() renvoie undefined si aucune règle ne s'applique -> autorisé.
    return robots.isAllowed(url, USER_AGENT) !== false;
  } catch {
    return true;
  }
}

// Parse un fichier sitemap (urlset ou sitemapindex) et, récursivement, les sitemaps qu'il
// référence.
async function parseSitemap(sitemapUrl, limit, state, depth = 0) {
  if (limit <= 0) return [];
  if (depth > MAX_SITEMAP_DEPTH) return [];
  if (state.files >= MAX_SITEMAP_FILES) return [];
  if (state.seenSitemaps.has(sitemapUrl)) return [];

  state.seenSitemaps.add(sitemapUrl);
  state.files += 1;

  const xml = await fetchText(sitemapUrl);
  if (!xml) return [];

  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    // Sitemap malformé : on l'ignore silencieusement.
    return [];
  }

  const urls = [];

  // Cas 1 : sitemap index -> il pointe vers d'autres sitemaps.
  const index = parsed?.sitemapindex?.sitemap;
  if (index) {
    for (const entry of toArray(index)) {
      if (urls.length >= limit) break;
      const loc = normalizeUrl(textOf(entry?.loc), sitemapUrl);
      if (!loc) continue;

      const nested = await parseSitemap(
        loc,
        limit - urls.length,
        state,
        depth + 1
      );
      urls.push(...nested);
    }
    return urls;
  }

  // Cas 2 : urlset -> liste de pages.
  const urlset = parsed?.urlset?.url;
  if (urlset) {
    for (const entry of toArray(urlset)) {
      if (urls.length >= limit) break;
      const loc = normalizeUrl(textOf(entry?.loc), sitemapUrl);
      if (loc && looksLikeHtmlUrl(loc)) urls.push(loc);
    }
  }

  return urls;
}

/** Cherche un sitemap exploitable et renvoie ses URLs. */
export async function discoverFromSitemap(origin, declaredSitemaps, limit) {
  const candidates = [
    ...declaredSitemaps,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  const state = { seenSitemaps: new Set(), files: 0 };
  const collected = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (collected.length >= limit) break;

    const found = await parseSitemap(candidate, limit - collected.length, state);
    for (const url of found) {
      if (collected.length >= limit) break;
      if (seen.has(url)) continue;
      seen.add(url);
      collected.push(url);
    }

    // Dès qu'un sitemap a donné des résultats, inutile d'essayer les suivants : on lui fait
    // confiance intégralement (cf. en-tête du fichier).
    if (collected.length > 0) break;
  }

  return collected;
}

/** Crawler BFS : suit les liens internes à partir de l'URL de départ. */
export async function crawl(startUrl, limit, robots, onVisit) {
  const start = normalizeUrl(startUrl);
  if (!start) return [];

  const queue = [start];
  const enqueued = new Set([start]);
  const visited = new Set(); // URLs finales déjà retenues (après redirections)
  const results = [];

  // Origine de référence du crawl.
  let crawlOrigin = new URL(start).origin;

  while (queue.length > 0 && results.length < limit) {
    const url = queue.shift();

    // robots.txt : on saute les URLs interdites, sans arrêter le crawl.
    if (!isAllowed(robots, url)) continue;

    let html;
    let finalUrl;

    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: 'text/html,application/xhtml+xml' },
      });

      if (!res.ok) continue;

      // On ne parse que du HTML.
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('html')) continue;

      html = await res.text();

      // On retient l'URL FINALE (après redirections) : auditer l'URL d'avant redirection ferait
      // tester une page qui n'est pas la page réelle (cas classiques : apex -> www, http -> https,
      // ajout de slash).
      finalUrl = normalizeUrl(res.url) || url;
    } catch {
      // Page injoignable : on l'ignore et on continue le reste du crawl.
      continue;
    }

    if (results.length === 0) {
      // Première page atteinte : elle définit l'origine réelle du site.
      crawlOrigin = new URL(finalUrl).origin;
    } else if (!isSameOrigin(finalUrl, crawlOrigin)) {
      // Redirection sortante (lien vers un autre domaine) : hors périmètre.
      continue;
    }

    if (visited.has(finalUrl)) continue;
    visited.add(finalUrl);

    results.push(finalUrl);
    if (onVisit) onVisit(finalUrl);

    // Inutile d'extraire les liens si le quota est déjà atteint.
    if (results.length >= limit) break;

    for (const link of extractLinks(html, finalUrl)) {
      if (enqueued.size >= limit * 5) break; // garde-fou mémoire
      if (enqueued.has(link)) continue;
      enqueued.add(link);
      queue.push(link);
    }
  }

  return results;
}

/** Extrait les liens internes exploitables d'une page HTML. */
export function extractLinks(html, baseUrl) {
  let $;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }

  // Une balise <base href> change la résolution des liens relatifs.
  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? normalizeUrl(baseHref, baseUrl) || baseUrl : baseUrl;

  const links = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;

    const abs = normalizeUrl(href, base);
    if (!abs) return;
    if (!isSameOrigin(abs, baseUrl)) return; // même origine uniquement
    if (!looksLikeHtmlUrl(abs)) return;

    links.add(abs);
  });

  return [...links];
}

/** Point d'entrée de la découverte. */
export async function discoverPages(targetUrl, limit, log = () => {}) {
  // L'URL saisie peut rediriger (apex -> www, http -> https).
  const resolved = await resolveTargetUrl(targetUrl);
  if (resolved !== targetUrl) {
    log(`Redirection suivie : ${resolved}`);
  }

  const origin = new URL(resolved).origin;

  log('Lecture du robots.txt...');
  const { robots, sitemaps } = await loadRobots(origin);

  log('Recherche d’un sitemap...');
  const fromSitemap = await discoverFromSitemap(origin, sitemaps, limit);

  if (fromSitemap.length > 0) {
    log(`Sitemap trouvé : ${fromSitemap.length} page(s) retenue(s).`);
    return { urls: fromSitemap, sitemapUsed: true };
  }

  log('Aucun sitemap exploitable, passage au crawl des liens internes...');
  const crawled = await crawl(resolved, limit, robots, (url) =>
    log(`Crawl : ${url}`)
  );

  // Cas extrême : la page d'accueil elle-même est injoignable côté fetch.
  const urls = crawled.length > 0 ? crawled : [normalizeUrl(resolved)];

  return { urls: urls.filter(Boolean), sitemapUsed: false };
}

/** Suit les redirections de l'URL saisie et renvoie l'URL finale. */
async function resolveTargetUrl(targetUrl) {
  const fallback = normalizeUrl(targetUrl) || targetUrl;

  try {
    const res = await fetchWithTimeout(targetUrl, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    return normalizeUrl(res.url) || fallback;
  } catch {
    return fallback;
  }
}

/* petits helpers */

/** fast-xml-parser renvoie un objet si un seul enfant, un tableau sinon. */
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Un <loc> peut être une string, un nombre, ou un objet { '#text': ... }. */
function textOf(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return String(value['#text']);
  }
  return '';
}
