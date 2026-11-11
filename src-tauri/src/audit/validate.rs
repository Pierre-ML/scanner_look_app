//! Validation des entrées du formulaire / de l'API.

use serde_json::Value;
use url::Url;

use super::config::LIMITE_DECOUVERTE;
use super::nombre::parse_int;

/// Le texte commence-t-il par un schéma (`xxx://`) ?
fn a_un_schema(texte: &str) -> bool {
    let Some((schema, _)) = texte.split_once("://") else {
        return false;
    };
    let mut c = schema.chars();
    c.next().is_some_and(|p| p.is_ascii_alphabetic())
        && c.all(|x| x.is_ascii_alphanumeric() || matches!(x, '+' | '.' | '-'))
}

/// Valide et normalise une URL de site.
pub fn valider_url(brute: Option<&Value>) -> Result<String, &'static str> {
    let Some(Value::String(brute)) = brute else {
        return Err("URL manquante.");
    };
    let mut candidate = brute.trim().to_string();
    if candidate.is_empty() {
        return Err("URL manquante.");
    }

    // Tolérance : on préfixe en https:// si aucun schéma n'est fourni.
    if !a_un_schema(&candidate) {
        candidate = format!("https://{candidate}");
    }

    let mut url = Url::parse(&candidate).map_err(|_| "URL invalide.")?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Seules les URL http:// et https:// sont acceptées.");
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("Nom de domaine manquant.");
    }

    // Le fragment n'a aucun sens pour un audit de site.
    url.set_fragment(None);
    Ok(url.to_string())
}

/// Valide le nombre de pages à découvrir.
pub fn valider_max_pages(brute: Option<&Value>) -> u64 {
    match parse_int(brute) {
        Some(n) if n >= 1.0 => (n as u64).min(LIMITE_DECOUVERTE),
        _ => LIMITE_DECOUVERTE,
    }
}

/// Valide la liste de pages choisie par l'utilisateur (même origine que la cible, sans doublon).
pub fn valider_selection(urls: Option<&Value>, cible: &str) -> Result<Vec<String>, String> {
    let liste = match urls {
        Some(Value::Array(liste)) if !liste.is_empty() => liste,
        _ => return Err("Sélectionnez au moins une page à auditer.".into()),
    };
    let origine_cible = crate::http::origine(cible).ok_or("URL cible invalide.")?;

    let mut retenues: Vec<String> = Vec::new();
    for brute in liste {
        let Value::String(brute) = brute else { continue };
        let Some(url) = crate::http::normaliser_url(brute.trim(), None) else { continue };
        let Some(origine) = crate::http::origine(&url) else { continue };
        if origine != origine_cible {
            return Err(format!("La page {brute} n’appartient pas au site audité ({origine_cible})."));
        }
        if !retenues.contains(&url) {
            retenues.push(url);
        }
    }

    // Pas de plafond : en local, l'utilisateur audite autant de pages qu'il veut.
    if retenues.is_empty() {
        return Err("Aucune page valide dans la sélection.".into());
    }
    Ok(retenues)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selection_filtree() {
        let cible = "https://ex.fr/";
        assert_eq!(
            valider_selection(Some(&json!(["https://ex.fr/a/", " https://ex.fr/a ", 3, "mailto:x"])), cible),
            Ok(vec!["https://ex.fr/a".to_string()])
        );
        assert_eq!(
            valider_selection(Some(&json!([])), cible),
            Err("Sélectionnez au moins une page à auditer.".into())
        );
        assert_eq!(
            valider_selection(Some(&json!(["https://autre.fr/"])), cible),
            Err("La page https://autre.fr/ n’appartient pas au site audité (https://ex.fr).".into())
        );
        assert_eq!(
            valider_selection(Some(&json!([1, "ftp://ex.fr"])), cible),
            Err("Aucune page valide dans la sélection.".into())
        );
    }

    #[test]
    fn url_completee_et_normalisee() {
        assert_eq!(valider_url(Some(&json!("  example.com "))), Ok("https://example.com/".into()));
        assert_eq!(valider_url(Some(&json!("http://ex.fr/a#b"))), Ok("http://ex.fr/a".into()));
        assert_eq!(valider_url(Some(&json!("HTTPS://Ex.FR"))), Ok("https://ex.fr/".into()));
    }

    #[test]
    fn url_refusee() {
        assert_eq!(valider_url(None), Err("URL manquante."));
        assert_eq!(valider_url(Some(&json!("   "))), Err("URL manquante."));
        assert_eq!(valider_url(Some(&json!(42))), Err("URL manquante."));
        assert_eq!(
            valider_url(Some(&json!("ftp://ex.fr"))),
            Err("Seules les URL http:// et https:// sont acceptées.")
        );
        assert_eq!(valider_url(Some(&json!("https://exa mple.com"))), Err("URL invalide."));
    }

    #[test]
    fn max_pages_borne() {
        assert_eq!(valider_max_pages(None), LIMITE_DECOUVERTE);
        assert_eq!(valider_max_pages(Some(&json!("0"))), LIMITE_DECOUVERTE);
        assert_eq!(valider_max_pages(Some(&json!("12"))), 12);
        assert_eq!(valider_max_pages(Some(&json!(20.9))), 20);
        assert_eq!(valider_max_pages(Some(&json!(100000))), LIMITE_DECOUVERTE);
    }
}
