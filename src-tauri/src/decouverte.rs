//! Découverte des pages à auditer : robots.txt, sitemaps, puis crawl de repli.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;

use quick_xml::Reader;
use quick_xml::events::Event;
use scraper::{Html, Selector};

use crate::http::{
    USER_AGENT, est_meme_origine, normaliser_url, origine, recuperer_texte,
    requete_avec_delai, ressemble_a_une_page_html,
};

/// Profondeur max de sitemap index imbriqués, pour éviter les boucles.
const PROFONDEUR_SITEMAP_MAX: usize = 3;

/// Nombre max de fichiers sitemap téléchargés pour une même découverte.
const FICHIERS_SITEMAP_MAX: usize = 50;

const ACCEPT_HTML: &str = "text/html,application/xhtml+xml";

/// Résultat de la découverte.
pub struct Decouverte {
    pub urls: Vec<String>,
    pub sitemap_utilise: bool,
}

/* robots.txt */

struct Regle {
    autorise: bool,
    motif: String,
}

/// robots.txt analysé : règles par agent et sitemaps déclarés.
#[derive(Default)]
struct Robots {
    origine: String,
    groupes: HashMap<String, Vec<Regle>>,
    sitemaps: Vec<String>,
}

/// Nom de produit d'un user-agent : minuscules, sans version.
fn nom_agent(agent: &str) -> String {
    let minuscules = agent.to_lowercase();
    minuscules.split('/').next().unwrap_or("").trim().to_string()
}

impl Robots {
    fn analyser(url_robots: &str, corps: &str) -> Robots {
        let mut robots = Robots {
            origine: origine(url_robots).unwrap_or_default(),
            ..Robots::default()
        };
        let mut agents: Vec<String> = Vec::new();
        let mut regles_vues = false;

        for ligne in corps.lines() {
            let ligne = ligne.split('#').next().unwrap_or("").trim();
            let Some((cle, valeur)) = ligne.split_once(':') else {
                continue;
            };
            let cle = cle.trim().to_lowercase();
            let valeur = valeur.trim();

            match cle.as_str() {
                "user-agent" => {
                    // Un user-agent après des règles ouvre un nouveau groupe.
                    if regles_vues {
                        agents.clear();
                        regles_vues = false;
                    }
                    let agent = nom_agent(valeur);
                    robots.groupes.entry(agent.clone()).or_default();
                    agents.push(agent);
                }
                "allow" | "disallow" => {
                    regles_vues = true;
                    if valeur.is_empty() {
                        continue;
                    }
                    for agent in &agents {
                        robots.groupes.entry(agent.clone()).or_default().push(Regle {
                            autorise: cle == "allow",
                            motif: valeur.to_string(),
                        });
                    }
                }
                "sitemap" if !valeur.is_empty() => robots.sitemaps.push(valeur.to_string()),
                _ => {}
            }
        }
        robots
    }

    /// Une URL est-elle autorisée pour notre user-agent ? (aucune règle applicable : oui)
    fn autorise(&self, url: &str) -> bool {
        if origine(url).as_deref() != Some(self.origine.as_str()) {
            return true;
        }
        let Ok(u) = url::Url::parse(url) else {
            return true;
        };
        let mut cible = u.path().to_string();
        if let Some(q) = u.query() {
            cible.push('?');
            cible.push_str(q);
        }

        let regles = self
            .groupes
            .get(&nom_agent(USER_AGENT))
            .or_else(|| self.groupes.get("*"));
        let Some(regles) = regles else {
            return true;
        };

        // La règle au motif le plus long l'emporte ; à égalité, « allow ».
        let mut meilleure: Option<&Regle> = None;
        for regle in regles.iter().filter(|r| motif_correspond(&r.motif, &cible)) {
            meilleure = match meilleure {
                Some(m)
                    if m.motif.len() > regle.motif.len()
                        || (m.motif.len() == regle.motif.len() && m.autorise) =>
                {
                    Some(m)
                }
                _ => Some(regle),
            };
        }
        meilleure.is_none_or(|r| r.autorise)
    }
}

/// Motif robots.txt (préfixe, `*` joker, `$` fin) contre chemin + query.
fn motif_correspond(motif: &str, cible: &str) -> bool {
    let (motif, ancre_fin) = match motif.strip_suffix('$') {
        Some(m) => (m, true),
        None => (motif, false),
    };
    let morceaux: Vec<&str> = motif.split('*').collect();
    let dernier = morceaux.len() - 1;
    let mut reste = cible;

    for (i, morceau) in morceaux.iter().enumerate() {
        if i == 0 {
            match reste.strip_prefix(morceau) {
                Some(r) => reste = r,
                None => return false,
            }
        } else if i == dernier && ancre_fin {
            return reste.ends_with(morceau);
        } else {
            match reste.find(morceau) {
                Some(pos) => reste = &reste[pos + morceau.len()..],
                None => return false,
            }
        }
    }
    !ancre_fin || reste.is_empty()
}

/// Charge et analyse le robots.txt du site ; absent ou illisible, ce n'est pas bloquant.
async fn charger_robots(origine: &str) -> (Option<Robots>, Vec<String>) {
    let url_robots = format!("{origine}/robots.txt");
    let Some(corps) = recuperer_texte(&url_robots).await else {
        return (None, Vec::new());
    };
    let robots = Robots::analyser(&url_robots, &corps);
    let sitemaps = robots
        .sitemaps
        .iter()
        .filter_map(|s| normaliser_url(s, Some(origine)))
        .collect();
    (Some(robots), sitemaps)
}

fn autorise(robots: &Option<Robots>, url: &str) -> bool {
    robots.as_ref().is_none_or(|r| r.autorise(url))
}

/* sitemaps */

/// Contenu d'un sitemap : `<loc>` de chaque `<sitemap>` (index) ou `<url>` (urlset).
struct SitemapXml {
    index: Vec<String>,
    urlset: Vec<String>,
}

/// Analyse un sitemap ; `None` si le XML est malformé.
fn analyser_sitemap(xml: &str) -> Option<SitemapXml> {
    let mut lecteur = Reader::from_str(xml);
    let mut pile: Vec<String> = Vec::new();
    let mut resultat = SitemapXml { index: Vec::new(), urlset: Vec::new() };
    // Entrée en cours : texte de son premier <loc> (vide si absent).
    let mut entree: Option<String> = None;
    let mut dans_loc = false;
    let mut loc_vu = false;

    loop {
        match lecteur.read_event().ok()? {
            Event::Start(e) => {
                let nom = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if pile.len() == 1 && (nom == "sitemap" || nom == "url") {
                    entree = Some(String::new());
                    loc_vu = false;
                } else if pile.len() == 2 && entree.is_some() && nom == "loc" && !loc_vu {
                    dans_loc = true;
                }
                pile.push(nom);
            }
            Event::End(_) => {
                let nom = pile.pop()?;
                if nom == "loc" {
                    if dans_loc {
                        loc_vu = true;
                    }
                    dans_loc = false;
                } else if pile.len() == 1 && (nom == "sitemap" || nom == "url") {
                    if let Some(texte) = entree.take() {
                        match (pile[0].as_str(), nom.as_str()) {
                            ("sitemapindex", "sitemap") => resultat.index.push(texte),
                            ("urlset", "url") => resultat.urlset.push(texte),
                            _ => {}
                        }
                    }
                }
            }
            Event::Empty(e) => {
                let nom = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if pile.len() == 1 && (nom == "sitemap" || nom == "url") {
                    match (pile[0].as_str(), nom.as_str()) {
                        ("sitemapindex", "sitemap") => resultat.index.push(String::new()),
                        ("urlset", "url") => resultat.urlset.push(String::new()),
                        _ => {}
                    }
                }
            }
            Event::Text(t) if dans_loc => {
                if let (Some(texte), Ok(brut)) = (entree.as_mut(), t.unescape()) {
                    texte.push_str(&brut);
                }
            }
            Event::CData(c) if dans_loc => {
                if let Some(texte) = entree.as_mut() {
                    texte.push_str(&String::from_utf8_lossy(&c.into_inner()));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !pile.is_empty() {
        return None;
    }
    for texte in resultat.index.iter_mut().chain(resultat.urlset.iter_mut()) {
        *texte = texte.trim().to_string();
    }
    Some(resultat)
}

struct EtatSitemaps {
    vus: HashSet<String>,
    fichiers: usize,
}

/// Lit un sitemap (urlset ou index) et, récursivement, les sitemaps qu'il référence.
fn lire_sitemap<'a>(
    url_sitemap: String,
    limite: usize,
    etat: &'a mut EtatSitemaps,
    profondeur: usize,
) -> Pin<Box<dyn Future<Output = Vec<String>> + Send + 'a>> {
    Box::pin(async move {
        if limite == 0
            || profondeur > PROFONDEUR_SITEMAP_MAX
            || etat.fichiers >= FICHIERS_SITEMAP_MAX
            || etat.vus.contains(&url_sitemap)
        {
            return Vec::new();
        }
        etat.vus.insert(url_sitemap.clone());
        etat.fichiers += 1;

        let Some(xml) = recuperer_texte(&url_sitemap).await else {
            return Vec::new();
        };
        let Some(contenu) = analyser_sitemap(&xml) else {
            return Vec::new();
        };
        selectionner_sitemap(contenu, &url_sitemap, limite, etat, profondeur).await
    })
}

async fn selectionner_sitemap(
    contenu: SitemapXml,
    url_sitemap: &str,
    limite: usize,
    etat: &mut EtatSitemaps,
    profondeur: usize,
) -> Vec<String> {
    let mut urls: Vec<String> = Vec::new();

    // Cas 1 : index de sitemaps.
    if !contenu.index.is_empty() {
        for entree in &contenu.index {
            if urls.len() >= limite {
                break;
            }
            let Some(loc) = normaliser_url(entree, Some(url_sitemap)) else {
                continue;
            };
            let imbriquees = lire_sitemap(loc, limite - urls.len(), etat, profondeur + 1).await;
            urls.extend(imbriquees);
        }
        return urls;
    }

    // Cas 2 : urlset, liste de pages.
    for entree in &contenu.urlset {
        if urls.len() >= limite {
            break;
        }
        if let Some(loc) = normaliser_url(entree, Some(url_sitemap)) {
            if ressemble_a_une_page_html(&loc) {
                urls.push(loc);
            }
        }
    }
    urls
}

/// Cherche un sitemap exploitable et renvoie ses URLs.
async fn decouvrir_par_sitemap(origine: &str, declares: &[String], limite: usize) -> Vec<String> {
    let mut candidats: Vec<String> = declares.to_vec();
    candidats.push(format!("{origine}/sitemap.xml"));
    candidats.push(format!("{origine}/sitemap_index.xml"));

    let mut etat = EtatSitemaps { vus: HashSet::new(), fichiers: 0 };
    let mut collectees: Vec<String> = Vec::new();
    let mut vues: HashSet<String> = HashSet::new();

    for candidat in candidats {
        if collectees.len() >= limite {
            break;
        }
        let trouvees = lire_sitemap(candidat, limite - collectees.len(), &mut etat, 0).await;
        for url in trouvees {
            if collectees.len() >= limite {
                break;
            }
            if vues.insert(url.clone()) {
                collectees.push(url);
            }
        }
        // Dès qu'un sitemap a donné des résultats, on lui fait confiance intégralement.
        if !collectees.is_empty() {
            break;
        }
    }
    collectees
}

/* crawl */

/// Crawler en largeur : suit les liens internes à partir de l'URL de départ.
async fn crawler(url_depart: &str, limite: usize, robots: &Option<Robots>) -> Vec<String> {
    let Some(depart) = normaliser_url(url_depart, None) else {
        return Vec::new();
    };

    let mut file: VecDeque<String> = VecDeque::from([depart.clone()]);
    let mut en_file: HashSet<String> = HashSet::from([depart.clone()]);
    let mut visitees: HashSet<String> = HashSet::new();
    let mut resultats: Vec<String> = Vec::new();
    let mut origine_crawl = origine(&depart).unwrap_or_default();

    while resultats.len() < limite {
        let Some(url) = file.pop_front() else {
            break;
        };
        // robots.txt : on saute les URLs interdites sans arrêter le crawl.
        if !autorise(robots, &url) {
            continue;
        }

        let Ok(reponse) = requete_avec_delai(&url, Some(ACCEPT_HTML)).await else {
            continue;
        };
        if !reponse.status().is_success() {
            continue;
        }
        // On ne parse que du HTML.
        let est_html = reponse
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.contains("html"));
        if !est_html {
            continue;
        }
        // On retient l'URL finale (après redirections), pas celle d'avant.
        let finale = normaliser_url(reponse.url().as_str(), None).unwrap_or_else(|| url.clone());
        let Ok(html) = reponse.text().await else {
            continue;
        };

        if resultats.is_empty() {
            // Première page atteinte : elle définit l'origine réelle du site.
            origine_crawl = origine(&finale).unwrap_or_default();
        } else if origine(&finale).as_deref() != Some(origine_crawl.as_str()) {
            continue;
        }

        if !visitees.insert(finale.clone()) {
            continue;
        }
        resultats.push(finale.clone());
        if resultats.len() >= limite {
            break;
        }

        for lien in extraire_liens(&html, &finale) {
            if en_file.len() >= limite * 5 {
                break; // garde-fou mémoire
            }
            if en_file.insert(lien.clone()) {
                file.push_back(lien);
            }
        }
    }
    resultats
}

/// Extrait les liens internes exploitables d'une page HTML.
fn extraire_liens(html: &str, url_base: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let (Ok(sel_base), Ok(sel_liens)) = (Selector::parse("base[href]"), Selector::parse("a[href]"))
    else {
        return Vec::new();
    };

    // Une balise <base href> change la résolution des liens relatifs.
    let base = match document.select(&sel_base).next().and_then(|e| e.value().attr("href")) {
        Some(h) if !h.is_empty() => {
            normaliser_url(h, Some(url_base)).unwrap_or_else(|| url_base.to_string())
        }
        _ => url_base.to_string(),
    };

    let mut liens: Vec<String> = Vec::new();
    let mut vus: HashSet<String> = HashSet::new();
    for element in document.select(&sel_liens) {
        let href = element.value().attr("href").unwrap_or("");
        if href.is_empty() || href.starts_with('#') {
            continue;
        }
        let Some(abs) = normaliser_url(href, Some(&base)) else {
            continue;
        };
        // Même origine uniquement, et pas de fichier manifestement non HTML.
        if !est_meme_origine(&abs, url_base) || !ressemble_a_une_page_html(&abs) {
            continue;
        }
        if vus.insert(abs.clone()) {
            liens.push(abs);
        }
    }
    liens
}

/* point d'entrée */

/// Suit les redirections de l'URL saisie et renvoie l'URL finale.
async fn resoudre_url_cible(url_cible: &str) -> String {
    let repli = normaliser_url(url_cible, None).unwrap_or_else(|| url_cible.to_string());
    match requete_avec_delai(url_cible, Some(ACCEPT_HTML)).await {
        Ok(reponse) => normaliser_url(reponse.url().as_str(), None).unwrap_or(repli),
        Err(_) => repli,
    }
}

/// Point d'entrée de la découverte : sitemap si possible, sinon crawl des liens internes.
pub async fn decouvrir(url_cible: &str, limite: usize) -> Result<Decouverte, String> {
    // L'URL saisie peut rediriger (apex -> www, http -> https).
    let resolue = resoudre_url_cible(url_cible).await;
    let origine_site = origine(&resolue).ok_or_else(|| "Invalid URL".to_string())?;

    let (robots, sitemaps) = charger_robots(&origine_site).await;

    let depuis_sitemap = decouvrir_par_sitemap(&origine_site, &sitemaps, limite).await;
    if !depuis_sitemap.is_empty() {
        return Ok(Decouverte { urls: depuis_sitemap, sitemap_utilise: true });
    }

    let crawlees = crawler(&resolue, limite, &robots).await;
    // Cas extrême : la page d'accueil elle-même est injoignable.
    let urls = if crawlees.is_empty() {
        normaliser_url(&resolue, None).into_iter().collect()
    } else {
        crawlees
    };
    Ok(Decouverte { urls, sitemap_utilise: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liens_internes_filtres_et_dedoublonnes() {
        let html = r##"<html><head><base href="/docs/"></head><body>
            <a href="a">A</a><a href="a#x">A bis</a><a href="#haut">ancre</a>
            <a href="https://autre.fr/z">externe</a><a href="/img/x.png">image</a>
            <a href="/b/?z=1&y=2">B</a><a href="mailto:x@y.fr">mail</a><a>sans href</a>
            </body></html>"##;
        // Comme en JS, le <base> normalisé perd son slash final : « a » se résout à la racine.
        assert_eq!(
            extraire_liens(html, "https://s.fr/"),
            vec!["https://s.fr/a".to_string(), "https://s.fr/b?y=2&z=1".to_string()]
        );
    }

    #[test]
    fn sitemap_urlset() {
        let xml = r#"<?xml version="1.0"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc> https://s.fr/a/ </loc><lastmod>2024-01-01</lastmod></url>
              <url><loc><![CDATA[https://s.fr/b?x=1&amp;y=2]]></loc></url>
              <url><loc>https://s.fr/doc.pdf</loc></url>
            </urlset>"#;
        let c = analyser_sitemap(xml).unwrap();
        assert!(c.index.is_empty());
        assert_eq!(c.urlset.len(), 3);
        assert_eq!(c.urlset[0], "https://s.fr/a/");
        assert_eq!(c.urlset[2], "https://s.fr/doc.pdf");
    }

    #[test]
    fn sitemap_index_et_xml_malforme() {
        let xml = r#"<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>https://s.fr/s1.xml</loc></sitemap>
              <sitemap><loc>/s2.xml</loc></sitemap>
            </sitemapindex>"#;
        let c = analyser_sitemap(xml).unwrap();
        assert_eq!(c.index, vec!["https://s.fr/s1.xml", "/s2.xml"]);
        assert!(c.urlset.is_empty());
        assert!(analyser_sitemap("<urlset><url><loc>x</url>").is_none());
    }

    const ROBOTS: &str = "# commentaire\n\
        User-agent: *\nDisallow: /prive\nDisallow: /*.json$\nAllow: /prive/public\n\
        Sitemap: /plan.xml\n\n\
        User-agent: autre-bot\nDisallow: /\n";

    #[test]
    fn regles_robots() {
        let r = Robots::analyser("https://s.fr/robots.txt", ROBOTS);
        assert!(r.autorise("https://s.fr/"));
        assert!(r.autorise("https://s.fr/blog"));
        assert!(!r.autorise("https://s.fr/prive/x"));
        assert!(r.autorise("https://s.fr/prive/public/x"));
        assert!(!r.autorise("https://s.fr/data/a.json"));
        assert!(r.autorise("https://s.fr/data/a.json.html"));
        assert!(r.autorise("https://ailleurs.fr/prive"));
        assert_eq!(r.sitemaps, vec!["/plan.xml"]);
    }

    #[test]
    fn robots_groupe_specifique_et_tout_interdit() {
        let r = Robots::analyser(
            "https://s.fr/robots.txt",
            "User-agent: eco-audit\nDisallow: /\n\nUser-agent: *\nDisallow:\n",
        );
        assert!(!r.autorise("https://s.fr/x"));
        let r = Robots::analyser("https://s.fr/robots.txt", "User-agent: *\nDisallow:\n");
        assert!(r.autorise("https://s.fr/x"));
    }

    #[test]
    fn motifs_robots() {
        assert!(motif_correspond("/a", "/ab"));
        assert!(motif_correspond("/a$", "/a"));
        assert!(!motif_correspond("/a$", "/ab"));
        assert!(motif_correspond("/*/x", "/q/r/x"));
        assert!(!motif_correspond("/*/x$", "/q/x/y"));
    }

    #[tokio::test]
    #[ignore = "réseau"]
    async fn essai_reel() {
        let r = decouvrir("https://example.com", 5).await.unwrap();
        println!("example.com : {:?} sitemap={}", r.urls, r.sitemap_utilise);
        assert!(!r.urls.is_empty());
        let r = decouvrir("https://www.sitemaps.org", 5).await.unwrap();
        println!("sitemaps.org : {:?} sitemap={}", r.urls, r.sitemap_utilise);
        assert!(!r.urls.is_empty());
        assert_eq!(decouvrir("pas une url", 5).await.err().as_deref(), Some("Invalid URL"));
    }
}
