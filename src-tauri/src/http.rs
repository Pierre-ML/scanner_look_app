//! Utilitaires réseau pour la phase de découverte (robots.txt, sitemap, crawl).

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, Response, redirect::Policy};
use url::Url;

/// Délai maximal d'une requête de découverte.
pub const DELAI_REQUETE: Duration = Duration::from_millis(15_000);

/// User-Agent annoncé : identifiable, pour que les admins sachent qui crawle.
pub const USER_AGENT: &str =
    "eco-audit/1.0 (+https://github.com/Pierre-ML/scanner_look_app; audit eco-conception)";

/// Taille maximale d'un corps texte (un sitemap énorme ferait exploser la RAM).
const OCTETS_MAX: usize = 10 * 1024 * 1024;

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .timeout(DELAI_REQUETE)
            .redirect(Policy::limited(20))
            .build()
            .expect("client HTTP")
    })
}

/// GET avec délai dur, redirections suivies et en-tête `accept` facultatif.
pub async fn requete_avec_delai(url: &str, accept: Option<&str>) -> Result<Response, String> {
    let mut requete = client().get(url);
    if let Some(accept) = accept {
        requete = requete.header("accept", accept);
    }
    requete.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("Timeout ({} ms) sur {url}", DELAI_REQUETE.as_millis())
        } else {
            e.to_string()
        }
    })
}

/// Récupère un corps de réponse texte ; `None` si échec, statut non 2xx ou corps trop gros.
pub async fn recuperer_texte(url: &str) -> Option<String> {
    let reponse = requete_avec_delai(url, None).await.ok()?;
    if !reponse.status().is_success() {
        return None;
    }
    if reponse.content_length().is_some_and(|n| n > OCTETS_MAX as u64) {
        return None;
    }
    let mut texte = reponse.text().await.ok()?;
    if texte.len() > OCTETS_MAX {
        let mut coupe = OCTETS_MAX;
        while !texte.is_char_boundary(coupe) {
            coupe -= 1;
        }
        texte.truncate(coupe);
    }
    Some(texte)
}

/// Normalise une URL : sans fragment, sans slash final (sauf racine), query triée.
pub fn normaliser_url(brute: &str, base: Option<&str>) -> Option<String> {
    let mut u = match base {
        Some(b) => Url::parse(b).ok()?.join(brute).ok()?,
        None => Url::parse(brute).ok()?,
    };
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }

    u.set_fragment(None);

    if u.query().is_some() {
        let mut paires: Vec<(String, String)> = u
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        // Tri stable sur les unités UTF-16, comme `searchParams.sort()`.
        paires.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        if paires.is_empty() {
            u.set_query(None);
        } else {
            let query = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(paires)
                .finish();
            u.set_query(Some(&query));
        }
    }

    let chemin = u.path();
    if chemin.len() > 1 && chemin.ends_with('/') {
        let court = chemin[..chemin.len() - 1].to_string();
        u.set_path(&court);
    }
    Some(u.to_string())
}

/// Origine (protocole + hôte + port) d'une URL.
pub fn origine(url: &str) -> Option<String> {
    Some(Url::parse(url).ok()?.origin().ascii_serialization())
}

/// Deux URLs appartiennent-elles à la même origine ?
pub fn est_meme_origine(a: &str, b: &str) -> bool {
    match (origine(a), origine(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Extensions de fichiers qui ne sont manifestement pas des pages HTML.
const EXTENSIONS_NON_HTML: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "pdf", "zip",
    "rar", "7z", "gz", "tgz", "bz2", "mp3", "mp4", "avi", "mov", "wmv", "flv", "webm", "ogg",
    "wav", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "csv", "json", "xml",
    "rss", "atom", "txt", "css", "js", "mjs", "map", "woff", "woff2", "ttf", "otf", "eot", "exe",
    "dmg", "apk", "iso",
];

/// Filtre les URLs qui ne sont manifestement pas des pages HTML, d'après leur extension.
pub fn ressemble_a_une_page_html(url: &str) -> bool {
    let Ok(u) = Url::parse(url) else {
        return false;
    };
    let chemin = u.path().to_ascii_lowercase();
    match chemin.rsplit_once('.') {
        Some((_, ext)) => !EXTENSIONS_NON_HTML.contains(&ext),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_fragment_slash_et_query() {
        assert_eq!(
            normaliser_url("https://a.fr/x/?b=2&a=1#haut", None).as_deref(),
            Some("https://a.fr/x?a=1&b=2")
        );
        assert_eq!(normaliser_url("https://a.fr", None).as_deref(), Some("https://a.fr/"));
        assert_eq!(normaliser_url("https://a.fr/?", None).as_deref(), Some("https://a.fr/"));
    }

    #[test]
    fn normalise_relatif_et_protocoles() {
        assert_eq!(
            normaliser_url("../b/", Some("https://a.fr/x/y")).as_deref(),
            Some("https://a.fr/b")
        );
        assert_eq!(normaliser_url("", Some("https://a.fr/s.xml")).as_deref(), Some("https://a.fr/s.xml"));
        assert_eq!(normaliser_url("mailto:x@a.fr", None), None);
        assert_eq!(normaliser_url("pas une url", None), None);
    }

    #[test]
    fn meme_origine() {
        assert!(est_meme_origine("https://a.fr/x", "https://a.fr:443/y"));
        assert!(!est_meme_origine("https://a.fr", "http://a.fr"));
        assert!(!est_meme_origine("https://a.fr", "https://www.a.fr"));
        assert!(!est_meme_origine("n'importe quoi", "https://a.fr"));
    }

    #[test]
    fn extensions() {
        assert!(ressemble_a_une_page_html("https://a.fr/page"));
        assert!(ressemble_a_une_page_html("https://a.fr/page.html"));
        assert!(ressemble_a_une_page_html("https://a.fr/v1.2/page"));
        assert!(!ressemble_a_une_page_html("https://a.fr/doc.PDF"));
        assert!(!ressemble_a_une_page_html("https://a.fr/sitemap.xml?x=1"));
    }
}
