// Animaux de l'univers Lucania (low-poly), viewBox 0 0 64 64.
// Eco Audit : le lynx, dont l'œil inspecte les sites.
// Format : facets = polygones { points, opacity } ; eyes = cercles { cx, cy, r } ;
// accents = petits polygones { points }. Tout est rendu en currentColor (aucun rouge).
export const animals = {
  lynx: {
    id: 'lynx',
    set: 'minimal',
    facets: [
      // Oreille gauche, tempe, front et joue
      { points: [[11,9],[26,22],[12,31]], opacity: 0.7 },
      { points: [[12,31],[26,22],[20,36]], opacity: 0.5 },
      { points: [[26,22],[29,23],[32,41],[20,36]], opacity: 0.35 },
      { points: [[12,31],[20,36],[4,44]], opacity: 0.3 },
      // Favori gauche et museau
      { points: [[4,44],[20,36],[22,48]], opacity: 0.55 },
      { points: [[20,36],[32,41],[22,48]], opacity: 0.4 },
      { points: [[4,44],[22,48],[13,60]], opacity: 0.3 },
      { points: [[22,48],[32,61],[13,60]], opacity: 0.45 },
      { points: [[22,48],[32,41],[32,61]], opacity: 0.7 },
      // Arête du nez, au centre
      { points: [[29,23],[35,23],[32,41]], opacity: 1 },
      // Côté droit, plus sombre (lumière venant de la gauche)
      { points: [[53,9],[38,22],[52,31]], opacity: 0.45 },
      { points: [[52,31],[38,22],[44,36]], opacity: 0.3 },
      { points: [[38,22],[35,23],[32,41],[44,36]], opacity: 0.2 },
      { points: [[52,31],[44,36],[60,44]], opacity: 0.2 },
      { points: [[60,44],[44,36],[42,48]], opacity: 0.35 },
      { points: [[44,36],[32,41],[42,48]], opacity: 0.25 },
      { points: [[60,44],[42,48],[51,60]], opacity: 0.2 },
      { points: [[42,48],[32,61],[51,60]], opacity: 0.3 },
      { points: [[42,48],[32,41],[32,61]], opacity: 0.4 },
    ],
    eyes: [{ cx: 25, cy: 32, r: 1.8 }, { cx: 39, cy: 32, r: 1.8 }],
    // Pinceaux des oreilles et truffe
    accents: [
      { points: [[11,9],[9,1],[18,15]] },
      { points: [[53,9],[55,1],[46,15]] },
      { points: [[29.5,41.5],[34.5,41.5],[32,46]] },
    ],
  },
};

/** Renvoie les données d'un animal ; lève une Error si l'id est inconnu. */
export function getAnimal(id) {
  const animal = animals[id];
  if (!animal) throw new Error(`Animal inconnu : ${id}`);
  return animal;
}
