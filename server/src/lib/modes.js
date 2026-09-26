/** Modes d'audit : combien de pages sont mesurées en même temps, et à quelle priorité. */

import os from 'node:os';

export const MODES = ['econome', 'rapide', 'personnalise'];

/** Plafond absolu de pages simultanées, quelle que soit la machine. */
export const PLAFOND_SIMULTANES = 6;

// Mémoire à prévoir par page mesurée en même temps : un Chrome headless et son processus
// Lighthouse.
export const MEMOIRE_PAR_PAGE_GO = 0.7;

// Nombre de pages que la machine peut mesurer en même temps, calculé À CHAQUE LANCEMENT (la
// mémoire libre change d'un moment à l'autre) : - la moitié des cœurs logiques (Chrome +
// Lighthouse occupent bien plus d'un cœur) ; - la mémoire libre divisée par MEMOIRE_PAR_PAGE_GO…
export function capaciteMachine() {
  const coeurs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const memoireLibreGo = os.freemem() / 1024 ** 3;

  const parCoeurs = Math.max(1, Math.floor(coeurs / 2));
  const parMemoire = Math.max(1, Math.floor(memoireLibreGo / MEMOIRE_PAR_PAGE_GO));
  const max = Math.min(PLAFOND_SIMULTANES, parCoeurs, parMemoire);

  const limitePar =
    max === parMemoire && parMemoire < Math.min(PLAFOND_SIMULTANES, parCoeurs)
      ? 'memoire'
      : max === parCoeurs && parCoeurs < PLAFOND_SIMULTANES
        ? 'coeurs'
        : 'plafond';

  return { max, plafond: PLAFOND_SIMULTANES, coeurs, memoireLibreGo: Math.round(memoireLibreGo * 10) / 10, limitePar };
}

/** Traduit le choix de l'utilisateur en réglages effectifs. */
export function resoudreMode(mode, demande, nombrePages) {
  const borne = (n) => Math.max(1, Math.min(n, PLAFOND_SIMULTANES, Math.max(1, nombrePages)));
  const n = Math.floor(Number(demande));

  if (mode === 'econome') return { mode, simultanes: 1, prioriteBasse: true };
  // Rapide : le nombre recommandé affiché par l'interface (la mémoire libre bouge d'un instant à l'autre).
  if (mode === 'rapide') return { mode, simultanes: borne(Number.isFinite(n) ? n : capaciteMachine().max), prioriteBasse: false };

  return {
    mode: 'personnalise',
    simultanes: borne(Number.isFinite(n) ? n : 1),
    prioriteBasse: false,
  };
}
