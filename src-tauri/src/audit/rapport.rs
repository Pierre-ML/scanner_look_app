//! Rapport, moyennes, points à corriger et progression d'un audit.

use std::collections::HashMap;

use serde::Serialize;

use super::config::{DUREE_PAGE_ESTIMEE_MS, ECOINDEX_DISCLAIMER};
use super::ecoindex::note;
use super::nombre::{Nombre, arrondi};
use super::store::{Job, Page, Recommandation, Scores, est_termine};

/* Moyennes */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoyennesScores {
    performance: Option<Nombre>,
    accessibility: Option<Nombre>,
    best_practices: Option<Nombre>,
    seo: Option<Nombre>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoyennesEco {
    score: Option<Nombre>,
    // La note moyenne est recalculée depuis le score moyen (une « moyenne de lettres » n'aurait
    // pas de sens).
    grade: Option<&'static str>,
    ghg: Option<Nombre>,
    water: Option<Nombre>,
    dom: Option<Nombre>,
    requests: Option<Nombre>,
    size_ko: Option<Nombre>,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moyennes {
    desktop: MoyennesScores,
    mobile: MoyennesScores,
    ecoindex: MoyennesEco,
    ok_count: usize,
    error_count: usize,
}

/// Moyenne arrondie au dixième ; `None` sans aucune valeur.
fn moyenne(valeurs: impl Iterator<Item = Option<Nombre>>) -> Option<Nombre> {
    let nombres: Vec<f64> = valeurs.flatten().map(|n| n.0).filter(|v| !v.is_nan()).collect();
    if nombres.is_empty() {
        return None;
    }
    let somme: f64 = nombres.iter().sum();
    Some(Nombre(arrondi(somme / nombres.len() as f64 * 10.0) / 10.0))
}

fn moyennes_scores(pages: &[&Page], scores: impl Fn(&Page) -> Option<&Scores>) -> MoyennesScores {
    let champ = |f: fn(&Scores) -> Option<Nombre>| moyenne(pages.iter().map(|p| scores(p).and_then(f)));
    MoyennesScores {
        performance: champ(|s| s.performance),
        accessibility: champ(|s| s.accessibility),
        best_practices: champ(|s| s.best_practices),
        seo: champ(|s| s.seo),
    }
}

/// Moyennes de synthèse.
pub fn calculer_moyennes(pages: &[&Page]) -> Moyennes {
    let ok: Vec<&Page> = pages.iter().copied().filter(|p| p.status == "ok").collect();
    let eco = |f: fn(&super::ecoindex::EcoIndex) -> Option<Nombre>| {
        moyenne(ok.iter().map(|p| p.ecoindex.as_ref().and_then(f)))
    };
    let score = eco(|e| e.score);

    Moyennes {
        desktop: moyennes_scores(&ok, |p| p.desktop_scores.as_ref()),
        mobile: moyennes_scores(&ok, |p| p.mobile_scores.as_ref()),
        ecoindex: MoyennesEco {
            score,
            grade: score.map(|s| note(s.0)),
            ghg: eco(|e| e.ghg),
            water: eco(|e| e.water),
            dom: eco(|e| e.dom),
            requests: eco(|e| e.requests),
            size_ko: eco(|e| e.size_ko),
            count: ok.iter().filter(|p| p.ecoindex.is_some()).count(),
        },
        ok_count: ok.len(),
        error_count: pages.len() - ok.len(),
    }
}

/* À corriger */

/// Ordre d'affichage des catégories, celui des scores.
const ORDRE_CATEGORIES: [&str; 4] = ["performance", "accessibility", "bestPractices", "seo"];

#[derive(Serialize)]
struct Detail<'a> {
    valeur: Option<&'a str>,
    elements: &'a [String],
}

#[derive(Serialize)]
struct PagePoint<'a> {
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    bureau: Option<Detail<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mobile: Option<Detail<'a>>,
}

#[derive(Serialize)]
struct Point<'a> {
    id: &'a str,
    categorie: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    titre: Option<&'a str>,
    description: &'a str,
    poids: Nombre,
    // Pire score relevé (0 à 0,89) : fixe la gravité affichée, comme dans Lighthouse.
    score: Nombre,
    pages: Vec<PagePoint<'a>>,
}

#[derive(Serialize)]
pub struct Groupe<'a> {
    categorie: &'static str,
    points: Vec<Point<'a>>,
}

// Regroupe les points à corriger de toutes les pages : un même audit en échec sur plusieurs pages
// n'apparaît qu'une fois, avec les pages concernées (bureau, mobile ou les deux).
fn regrouper_recommandations<'a>(pages: &[&'a Page]) -> Vec<Groupe<'a>> {
    let mut points: Vec<Point<'a>> = Vec::new();
    let mut index: HashMap<(&str, &str), usize> = HashMap::new();

    for page in pages {
        let supports: [(bool, &'a Option<Vec<Recommandation>>); 2] =
            [(true, &page.desktop_recommandations), (false, &page.mobile_recommandations)];
        for (bureau, liste) in supports {
            for reco in liste.iter().flatten() {
                let i = *index.entry((reco.categorie.as_str(), reco.id.as_str())).or_insert_with(|| {
                    points.push(Point {
                        id: &reco.id,
                        categorie: &reco.categorie,
                        titre: reco.titre.as_deref(),
                        description: &reco.description,
                        poids: reco.poids,
                        score: reco.score,
                        pages: Vec::new(),
                    });
                    points.len() - 1
                });
                let point = &mut points[i];
                point.poids = Nombre(point.poids.0.max(reco.poids.0));
                point.score = Nombre(point.score.0.min(reco.score.0));

                let j = match point.pages.iter().position(|p| p.url == page.url) {
                    Some(j) => j,
                    None => {
                        point.pages.push(PagePoint { url: &page.url, bureau: None, mobile: None });
                        point.pages.len() - 1
                    }
                };
                let detail = Some(Detail { valeur: reco.valeur.as_deref(), elements: &reco.elements });
                if bureau {
                    point.pages[j].bureau = detail;
                } else {
                    point.pages[j].mobile = detail;
                }
            }
        }
    }

    let mut groupes: Vec<Groupe<'a>> =
        ORDRE_CATEGORIES.iter().map(|&c| Groupe { categorie: c, points: Vec::new() }).collect();
    for point in points {
        if let Some(g) = groupes.iter_mut().find(|g| g.categorie == point.categorie) {
            g.points.push(point);
        }
    }
    for g in &mut groupes {
        g.points.sort_by(|a, b| {
            b.pages.len().cmp(&a.pages.len()).then(
                b.poids.0.partial_cmp(&a.poids.0).unwrap_or(std::cmp::Ordering::Equal),
            )
        });
    }
    groupes
}

/* Rapport */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rapport<'a> {
    job_id: u64,
    target_url: &'a str,
    status: &'a str,
    // Un rapport partiel reste lisible (audit arrêté ou encore en cours) : le front sait, grâce à
    // ce drapeau, s'il doit continuer à interroger.
    complete: bool,
    sitemap_used: Option<bool>,
    selected_urls: &'a [String],
    total_pages: u64,
    processed_pages: u64,
    error_pages: usize,
    pages: Vec<&'a Page>,
    averages: Moyennes,
    // `null` : aucune page mesurée ne porte de recommandations (audit antérieur à leur ajout).
    a_corriger: Option<Vec<Groupe<'a>>>,
    ecoindex_disclaimer: &'static str,
    mode: &'a str,
    simultanes: u64,
    error: Option<&'a str>,
    created_at: Option<&'a str>,
    audit_started_at: Option<&'a str>,
    finished_at: Option<&'a str>,
}

/// Rapport complet d'un job : servi en JSON et proposé à l'export.
pub fn construire_rapport(job: &Job) -> Rapport<'_> {
    // Dans l'ordre de la sélection, et non d'arrivée : en parallèle, les pages se terminent dans le
    // désordre.
    let rang: HashMap<&str, usize> =
        job.selected_urls.iter().enumerate().map(|(i, u)| (u.as_str(), i)).collect();
    let mut pages: Vec<&Page> = job.pages.iter().collect();
    pages.sort_by_key(|p| rang.get(p.url.as_str()).copied().unwrap_or(1_000_000_000));

    let a_corriger = pages
        .iter()
        .any(|p| p.desktop_recommandations.is_some() || p.mobile_recommandations.is_some())
        .then(|| regrouper_recommandations(&pages));

    Rapport {
        job_id: job.id,
        target_url: &job.target_url,
        status: &job.status,
        complete: est_termine(&job.status),
        sitemap_used: job.sitemap_used,
        selected_urls: &job.selected_urls,
        total_pages: job.total_pages,
        processed_pages: job.processed_pages,
        error_pages: pages.iter().filter(|p| p.status == "error").count(),
        averages: calculer_moyennes(&pages),
        pages,
        a_corriger,
        ecoindex_disclaimer: ECOINDEX_DISCLAIMER,
        mode: job.mode.as_deref().unwrap_or("personnalise"),
        simultanes: job.simultanes.unwrap_or(1),
        error: job.error.as_deref(),
        created_at: job.created_at.as_deref(),
        audit_started_at: job.audit_started_at.as_deref(),
        finished_at: job.finished_at.as_deref(),
    }
}

/* Progression et temps restant */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progression {
    pourcent: Nombre,
    faites: u64,
    total: u64,
    restantes: u64,
    moyenne_page_ms: Nombre,
    // `null` dès que l'audit ne tourne plus.
    restant_ms: Option<Nombre>,
    estimation_mesuree: bool,
}

/// Avancement et estimation du temps restant.
pub fn calculer_progression(job: &Job) -> Progression {
    let durees: Vec<f64> =
        job.pages.iter().filter_map(|p| p.duration_ms).map(|d| d.0).filter(|d| *d > 0.0).collect();
    let total = job.total_pages;
    let faites = job.processed_pages;
    let restantes = total.saturating_sub(faites);

    let pourcent = if total > 0 { arrondi(faites as f64 / total as f64 * 100.0) } else { 0.0 };
    let moyenne_ms = if durees.is_empty() {
        DUREE_PAGE_ESTIMEE_MS as f64
    } else {
        durees.iter().sum::<f64>() / durees.len() as f64
    };
    let simultanes = job.simultanes.filter(|n| *n > 0).unwrap_or(1);

    Progression {
        pourcent: Nombre(pourcent),
        faites,
        total,
        restantes,
        moyenne_page_ms: Nombre(arrondi(moyenne_ms)),
        restant_ms: (job.status == "running")
            .then(|| Nombre(arrondi((restantes as f64 / simultanes as f64).ceil() * moyenne_ms))),
        estimation_mesuree: !durees.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(url: &str, status: &str, perf: Option<f64>, recos: Option<serde_json::Value>) -> Page {
        serde_json::from_value(json!({
            "id": 1, "url": url, "status": status,
            "desktopScores": perf.map(|p| json!({"performance": p, "accessibility": 90, "bestPractices": null, "seo": 100})),
            "desktopRecommandations": recos,
            "ecoindex": {"score": 50.5, "grade": "D", "ghg": 2, "water": 3, "dom": 10, "requests": 5, "sizeKo": 100},
            "durationMs": 20000
        }))
        .unwrap()
    }

    #[test]
    fn moyennes_des_pages_ok() {
        let a = page("https://ex.fr/a", "ok", Some(90.0), None);
        let b = page("https://ex.fr/b", "ok", Some(85.0), None);
        let c = page("https://ex.fr/c", "error", Some(10.0), None);
        let m = serde_json::to_value(calculer_moyennes(&[&a, &b, &c])).unwrap();
        assert_eq!(m["desktop"]["performance"], json!(87.5));
        assert_eq!(m["desktop"]["bestPractices"], json!(null));
        assert_eq!(m["mobile"]["seo"], json!(null));
        assert_eq!(m["ecoindex"]["grade"], json!("D"));
        assert_eq!(m["ecoindex"]["count"], json!(2));
        assert_eq!((m["okCount"].clone(), m["errorCount"].clone()), (json!(2), json!(1)));
    }

    #[test]
    fn recommandations_regroupees() {
        let reco = |score: f64, poids: f64| {
            json!([{"id": "lcp", "categorie": "performance", "titre": "LCP", "description": "",
                    "valeur": "3 s", "score": score, "poids": poids, "elements": []}])
        };
        let a = page("https://ex.fr/a", "ok", Some(90.0), Some(reco(0.5, 10.0)));
        let b = page("https://ex.fr/b", "ok", Some(90.0), Some(reco(0.2, 25.0)));
        let groupes = serde_json::to_value(regrouper_recommandations(&[&a, &b])).unwrap();
        assert_eq!(groupes.as_array().unwrap().len(), 4);
        let point = &groupes[0]["points"][0];
        assert_eq!(point["score"], json!(0.2));
        assert_eq!(point["poids"], json!(25));
        assert_eq!(point["pages"].as_array().unwrap().len(), 2);
        assert_eq!(point["pages"][0], json!({"url": "https://ex.fr/a", "bureau": {"valeur": "3 s", "elements": []}}));
    }

    #[test]
    fn progression_et_temps_restant() {
        let mut job = Job { status: "running".into(), total_pages: 5, processed_pages: 2, simultanes: Some(2), ..Job::default() };
        job.pages = vec![page("a", "ok", Some(1.0), None), page("b", "ok", Some(1.0), None)];
        let p = serde_json::to_value(calculer_progression(&job)).unwrap();
        assert_eq!(p["pourcent"], json!(40));
        assert_eq!(p["restantMs"], json!(40000));
        assert_eq!(p["estimationMesuree"], json!(true));
        job.status = "done".into();
        assert_eq!(serde_json::to_value(calculer_progression(&job)).unwrap()["restantMs"], json!(null));
    }
}
