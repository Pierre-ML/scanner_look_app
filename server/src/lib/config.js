/**
 * Constantes du serveur d'audit local.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nombre maximal de pages PROPOSÉES par la découverte (sitemap ou crawl).
 *
 * Ce n'est pas un plafond d'audit : en local, l'utilisateur audite autant de
 * pages qu'il veut, y compris des pages ajoutées à la main. C'est un garde-fou
 * pour la découverte elle-même — sans lui, le crawl d'un gros site (boutique,
 * forum) ne se terminerait jamais. Réglable avec ECO_AUDIT_MAX_DECOUVERTE.
 */
export const LIMITE_DECOUVERTE = (() => {
  const n = Math.floor(Number(process.env.ECO_AUDIT_MAX_DECOUVERTE));
  return Number.isFinite(n) && n >= 1 ? n : 500;
})();

/**
 * Port du serveur Fastify. L'interface (astro dev, port 4321) relaie `/api`
 * vers ce port : voir web/astro.config.mjs, qui lit la même variable.
 */
export const PORT = Number(process.env.PORT || 4322);

/**
 * Hôte d'écoute : la boucle locale, et rien d'autre. L'outil audite des sites
 * avec le Chrome de l'utilisateur, il n'a pas à être joignable depuis le réseau.
 */
export const HOST = '127.0.0.1';

/**
 * Dossier des audits enregistrés : `data/` à la racine du dépôt, ignoré par git.
 * Un fichier JSON par audit (voir store.js).
 */
export const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'audits'
);

/* -------------------------------------------------------------------------
 * Estimation de durée
 * ---------------------------------------------------------------------- */

/**
 * Durée moyenne d'une page (deux passages Lighthouse), en millisecondes.
 * Sert d'estimation de départ, avant d'avoir mesuré quoi que ce soit sur le
 * site en cours. Dès la première page auditée, la moyenne réelle prend le
 * relais. Valeur calibrée sur les mesures de développement (22 à 28 s).
 */
export const DUREE_PAGE_ESTIMEE_MS = 25000;

/* -------------------------------------------------------------------------
 * Avertissement éco-index
 * ---------------------------------------------------------------------- */

/**
 * Affiché PARTOUT où un éco-index apparaît.
 * Centralisé ici pour rester rigoureusement identique dans toute l'UI.
 */
export const ECOINDEX_DISCLAIMER =
  'Estimation calculée localement à partir des mesures Lighthouse ' +
  '(éléments du DOM, requêtes, poids transféré), selon la méthodologie ' +
  'EcoIndex de GreenIT / CNUMR. Ce n’est PAS un résultat officiel du ' +
  'service ecoindex.fr : les conditions de mesure diffèrent, les valeurs ' +
  'peuvent donc s’écarter de celles du site officiel.';
