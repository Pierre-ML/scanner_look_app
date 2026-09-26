/** Validation des entrées du formulaire / de l'API. */

import { LIMITE_DECOUVERTE } from './config.js';

/** Valide et normalise une URL de site. */
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

/** Valide le nombre de pages à découvrir. */
export function validateMaxPages(raw) {
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) return LIMITE_DECOUVERTE;

  return Math.min(parsed, LIMITE_DECOUVERTE);
}
