//! Nombres et conversions « à la JavaScript », pour un JSON identique à celui du serveur Node.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// Nombre JSON écrit comme JavaScript : `72` et non `72.0`, `null` si non fini.
#[derive(Clone, Copy, Debug, Default, PartialEq, PartialOrd)]
pub struct Nombre(pub f64);

impl Serialize for Nombre {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let v = self.0;
        if !v.is_finite() {
            s.serialize_none()
        } else if v.fract() == 0.0 && v.abs() < 9_007_199_254_740_992.0 {
            s.serialize_i64(v as i64)
        } else {
            s.serialize_f64(v)
        }
    }
}

impl<'de> Deserialize<'de> for Nombre {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        f64::deserialize(d).map(Nombre)
    }
}

impl From<f64> for Nombre {
    fn from(v: f64) -> Self {
        Nombre(v)
    }
}

/// `Math.round` : moitié vers +∞.
pub fn arrondi(x: f64) -> f64 {
    let bas = x.floor();
    if x - bas >= 0.5 { bas + 1.0 } else { bas }
}

/// `Math.round(n * 100) / 100`.
pub fn arrondi2(n: f64) -> f64 {
    arrondi(n * 100.0) / 100.0
}

/// `String(valeur)` pour les cas utiles (nombre, texte, tableau d'un élément).
fn en_texte(valeur: &Value) -> Option<String> {
    match valeur {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null => Some("null".into()),
        Value::Array(a) => match a.as_slice() {
            [] => Some(String::new()),
            [seul] => en_texte(seul),
            _ => None,
        },
        Value::Object(_) => None,
    }
}

/// `Number.parseInt(texte, 10)` : chiffres en tête, `None` pour NaN.
pub fn parse_int_texte(texte: &str) -> Option<f64> {
    let t = texte.trim_start();
    let (signe, reste) = match t.as_bytes().first() {
        Some(b'-') => (-1.0, &t[1..]),
        Some(b'+') => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    let chiffres: String = reste.chars().take_while(|c| c.is_ascii_digit()).collect();
    if chiffres.is_empty() {
        return None;
    }
    chiffres.parse::<f64>().ok().map(|n| signe * n)
}

/// `Number.parseInt(valeur, 10)` ; `None` pour une valeur absente ou NaN.
pub fn parse_int(valeur: Option<&Value>) -> Option<f64> {
    let valeur = valeur?;
    if let Value::Number(n) = valeur {
        // `parseInt(3.7)` lit « 3.7 » : partie entière.
        return n.as_f64().filter(|v| v.is_finite()).map(f64::trunc);
    }
    parse_int_texte(&en_texte(valeur)?)
}

/// `Number(valeur)` ; NaN pour une valeur absente ou illisible.
pub fn nombre_js(valeur: Option<&Value>) -> f64 {
    let Some(valeur) = valeur else {
        return f64::NAN;
    };
    match valeur {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Object(_) => f64::NAN,
        autre => en_texte(autre).map_or(f64::NAN, |t| texte_en_nombre(&t)),
    }
}

/// Conversion d'un texte par `Number()`.
fn texte_en_nombre(texte: &str) -> f64 {
    let t = texte.trim();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefixe, base) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(reste) = t.strip_prefix(prefixe) {
            return u64::from_str_radix(reste, base).map_or(f64::NAN, |n| n as f64);
        }
    }
    // Rust accepte « inf » ou « nan », pas JavaScript.
    if t.chars().any(|c| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nombre_ecrit_comme_javascript() {
        assert_eq!(serde_json::to_string(&Nombre(72.0)).unwrap(), "72");
        assert_eq!(serde_json::to_string(&Nombre(-0.0)).unwrap(), "0");
        assert_eq!(serde_json::to_string(&Nombre(0.5)).unwrap(), "0.5");
        assert_eq!(serde_json::to_string(&Nombre(f64::NAN)).unwrap(), "null");
    }

    #[test]
    fn arrondis() {
        assert_eq!(arrondi(2.5), 3.0);
        assert_eq!(arrondi(-2.5), -2.0);
        assert_eq!(arrondi(0.49999999999999994), 0.0);
        assert_eq!(arrondi2(1.005 * 1.0), 1.0);
        assert_eq!(arrondi2(224.095703125), 224.1);
    }

    #[test]
    fn parse_int_comme_javascript() {
        assert_eq!(parse_int(Some(&json!("12abc"))), Some(12.0));
        assert_eq!(parse_int(Some(&json!(" -3"))), Some(-3.0));
        assert_eq!(parse_int(Some(&json!(3.7))), Some(3.0));
        assert_eq!(parse_int(Some(&json!("abc"))), None);
        assert_eq!(parse_int(Some(&json!(null))), None);
        assert_eq!(parse_int(None), None);
    }

    #[test]
    fn number_comme_javascript() {
        assert_eq!(nombre_js(Some(&json!("4"))), 4.0);
        assert_eq!(nombre_js(Some(&json!(null))), 0.0);
        assert_eq!(nombre_js(Some(&json!(""))), 0.0);
        assert!(nombre_js(Some(&json!("inf"))).is_nan());
        assert!(nombre_js(None).is_nan());
        assert_eq!(nombre_js(Some(&json!([5]))), 5.0);
    }
}
