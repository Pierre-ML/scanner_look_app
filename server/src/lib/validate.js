/**
 * Validation des entrées du formulaire / de l'API.
 */

import { DEFAULT_MAX_PAGES, HARD_CAP } from './config.js';

/**
 * Valide et normalise une URL de site.
 *
 * Règles :
 *   - protocole http/https uniquement (pas de file:, javascript:, ftp:…) ;
 *   - le schéma est ajouté automatiquement si l'utilisateur l'a omis
 *     (« exemple.fr » devient « https://exemple.fr ») ;
 *   - un hôte est obligatoire.
 *
 * @param {unknown} raw
 * @returns {{ok: true, url: string} | {ok: false, error: string}}
 */
export function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'URL manquante.' };
  }

  let candidate = raw.trim();

  // Tolérance : on préfixe en https:// si aucun schéma n'est fourni.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'URL invalide.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Seules les URL http:// et https:// sont acceptées.' };
  }

  if (!url.hostname) {
    return { ok: false, error: 'Nom de domaine manquant.' };
  }

  // Le fragment n'a aucun sens pour un audit de site.
  url.hash = '';

  return { ok: true, url: url.toString() };
}

/**
 * Valide le nombre de pages demandé et applique le plafond serveur.
 * Une valeur absente ou aberrante retombe sur la valeur par défaut.
 *
 * @param {unknown} raw
 * @returns {number} entier dans [1, HARD_CAP]
 */
export function validateMaxPages(raw) {
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_PAGES;

  // Plafond non négociable, même si le client envoie 10 000.
  return Math.min(parsed, HARD_CAP);
}
