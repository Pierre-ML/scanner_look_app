/** Calcul de l'EcoIndex — implémentation locale de la méthodologie officielle. */

// Quantiles de référence (21 valeurs = les centiles 0, 5, 10 … 100 observés sur le corpus
// GreenIT).
const QUANTILES_DOM = [
  0, 47, 75, 159, 233, 298, 358, 417, 476, 537, 603, 674, 753, 843, 949, 1076,
  1237, 1459, 1801, 2479, 594601,
];

const QUANTILES_REQ = [
  0, 2, 15, 25, 34, 42, 49, 56, 63, 70, 78, 86, 95, 105, 117, 130, 147, 170,
  205, 281, 3920,
];

/** En Ko (kilo-octets) de données transférées. */
const QUANTILES_SIZE = [
  0, 1.37, 144.7, 319.53, 479.46, 631.97, 783.38, 937.91, 1098.62, 1265.47,
  1448.32, 1648.27, 1876.08, 2142.06, 2465.37, 2866.31, 3401.59, 4155.73,
  5400.08, 8037.54, 223212.26,
];

/** Seuils de note, du meilleur au moins bon (valeur = borne basse exclue). */
export const ECOINDEX_GRADES = [
  { value: 80, grade: 'A', color: '#349A47' },
  { value: 70, grade: 'B', color: '#51B84B' },
  { value: 55, grade: 'C', color: '#CADB2A' },
  { value: 40, grade: 'D', color: '#F6EB15' },
  { value: 25, grade: 'E', color: '#FECD06' },
  { value: 10, grade: 'F', color: '#F99839' },
  { value: 0, grade: 'G', color: '#ED2124' },
];

// Position d'une valeur dans l'échelle des quantiles, avec interpolation linéaire à l'intérieur de
// l'intervalle.
export function computeQuantile(quantiles, value) {
  for (let i = 1; i < quantiles.length; i++) {
    if (value < quantiles[i]) {
      return (
        i - 1 + (value - quantiles[i - 1]) / (quantiles[i] - quantiles[i - 1])
      );
    }
  }
  // Au-delà du dernier quantile : on plafonne.
  return quantiles.length - 1;
}

/** Score EcoIndex brut (0-100). */
export function computeEcoIndex(dom, req, sizeKo) {
  const qDom = computeQuantile(QUANTILES_DOM, dom);
  const qReq = computeQuantile(QUANTILES_REQ, req);
  const qSize = computeQuantile(QUANTILES_SIZE, sizeKo);

  const score = 100 - (5 * (3 * qDom + 2 * qReq + qSize)) / 6;
  return Math.min(100, Math.max(0, score));
}

/** Note A-G correspondant à un score. */
export function getEcoIndexGrade(score) {
  const found = ECOINDEX_GRADES.find((g) => score > g.value);
  return found ? found.grade : 'G';
}

/** Couleur officielle associée à une note A-G. */
export function getGradeColor(grade) {
  const found = ECOINDEX_GRADES.find((g) => g.grade === grade);
  return found ? found.color : '#ED2124';
}

/** Émission de gaz à effet de serre estimée, en gCO2e (entre 1 et 3). */
export function computeGreenhouseGases(score) {
  return round2(2 + (2 * (50 - score)) / 100);
}

/** Consommation d'eau estimée, en cL (entre 1,5 et 4,5). */
export function computeWaterConsumption(score) {
  return round2(3 + (3 * (50 - score)) / 100);
}

/** Point d'entrée : construit l'objet éco-index complet stocké en base. */
export function buildEcoIndex({ dom, requests, sizeKo }) {
  const rawScore = computeEcoIndex(dom, requests, sizeKo);
  const score = round2(rawScore);

  return {
    score,
    grade: getEcoIndexGrade(rawScore),
    ghg: computeGreenhouseGases(rawScore),
    water: computeWaterConsumption(rawScore),
    dom,
    requests,
    sizeKo: round2(sizeKo),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
