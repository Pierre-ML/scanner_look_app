/** Constantes du serveur d'audit local. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nombre maximal de pages PROPOSÉES par la découverte (sitemap ou crawl). */
export const LIMITE_DECOUVERTE = 500;

/** Port du serveur Fastify. */
export const PORT = 4322;

/** Hôte d'écoute : la boucle locale, et rien d'autre. */
export const HOST = '127.0.0.1';

/** Dossier des audits enregistrés : `data/` à la racine du dépôt, ignoré par git. */
export const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'audits'
);

/* Estimation de durée */

/** Durée moyenne d'une page (deux passages Lighthouse), en millisecondes. */
export const DUREE_PAGE_ESTIMEE_MS = 25000;

/* Avertissement éco-index */

/** Affiché PARTOUT où un éco-index apparaît. */
export const ECOINDEX_DISCLAIMER =
  'Estimation calculée localement à partir des mesures Lighthouse ' +
  '(éléments du DOM, requêtes, poids transféré), selon la méthodologie ' +
  'EcoIndex de GreenIT / CNUMR. Ce n’est PAS un résultat officiel du ' +
  'service ecoindex.fr : les conditions de mesure diffèrent, les valeurs ' +
  'peuvent donc s’écarter de celles du site officiel.';
