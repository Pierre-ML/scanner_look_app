/** Utilitaires réseau pour la phase de découverte (robots.txt, sitemap, crawl). */

/** Timeout par défaut d'une requête de découverte (ms). */
export const FETCH_TIMEOUT_MS = 15_000;

/** User-Agent annoncé : identifiable, pour que les admins sachent qui crawle. */
export const USER_AGENT = 'eco-audit/1.0 (+https://github.com/Pierre-ML/scanner_look_app; audit eco-conception)';

/** `fetch` avec timeout dur via AbortController. */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = FETCH_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      redirect: 'follow',
      ...rest,
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, ...(rest.headers || {}) },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout (${timeout} ms) sur ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Récupère un corps de réponse texte. */
export async function fetchText(url, options = {}) {
  const { maxBytes = 10 * 1024 * 1024, ...rest } = options;

  try {
    const res = await fetchWithTimeout(url, rest);
    if (!res.ok) return null;

    // Garde-fou : un sitemap de plusieurs centaines de Mo ferait exploser la RAM.
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) return null;

    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  }
}

// Normalise une URL pour la déduplication du crawl : - supprime le fragment (#ancre) qui ne change
// pas la page, - supprime le slash final (sauf racine), - trie les paramètres de query pour que
// ?a=1&b=2 == ?b=2&a=1.
export function normalizeUrl(rawUrl, base) {
  try {
    const u = new URL(rawUrl, base);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    u.hash = '';
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** Deux URLs appartiennent-elles à la même origine (protocole + host + port) ? */
export function isSameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

/** Filtre les URLs qui ne sont manifestement pas des pages HTML, d'après leur extension. */
const NON_HTML_EXT =
  /\.(?:jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|rar|7z|gz|tgz|bz2|mp3|mp4|avi|mov|wmv|flv|webm|ogg|wav|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|csv|json|xml|rss|atom|txt|css|js|mjs|map|woff2?|ttf|otf|eot|exe|dmg|apk|iso)$/i;

export function looksLikeHtmlUrl(url) {
  try {
    const { pathname } = new URL(url);
    return !NON_HTML_EXT.test(pathname);
  } catch {
    return false;
  }
}
