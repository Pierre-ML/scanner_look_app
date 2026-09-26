/** Sortie du journal Fastify, lisible dans un terminal. */

const NIVEAUX = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO ', 40: 'AVERT', 50: 'ERREUR', 60: 'FATAL' };

/** Champs techniques de pino, jamais affichés. */
const IGNORES = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'reqId', 'v']);

export const fluxJournal = {
  write(ligne) {
    let entree;
    try {
      entree = JSON.parse(ligne);
    } catch {
      process.stdout.write(ligne);
      return;
    }

    const heure = new Date(entree.time || Date.now()).toLocaleTimeString('fr-FR');
    const niveau = NIVEAUX[entree.level] || 'INFO ';

    const details = Object.entries(entree)
      .filter(([cle]) => !IGNORES.has(cle))
      .map(([cle, valeur]) => {
        if (cle === 'err' && valeur && typeof valeur === 'object') {
          return valeur.stack || valeur.message || JSON.stringify(valeur);
        }
        return `${cle}=${typeof valeur === 'string' ? valeur : JSON.stringify(valeur)}`;
      })
      .join(' ');

    const sortie = entree.level >= 50 ? process.stderr : process.stdout;
    sortie.write(`${heure} ${niveau} ${entree.msg ?? ''}${details ? `  (${details})` : ''}\n`);
  },
};
