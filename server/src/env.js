/**
 * Chargement du fichier `.env` à la racine du dépôt, s'il existe.
 *
 * Importé EN PREMIER par server.js : les autres modules lisent `process.env`
 * dès leur évaluation (port, timeout, CHROME_PATH…). Un fichier absent n'est
 * pas une erreur, tous les réglages ont une valeur par défaut. Une variable
 * déjà définie dans l'environnement n'est pas écrasée.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

if (fs.existsSync(fichier)) {
  process.loadEnvFile(fichier);
}
