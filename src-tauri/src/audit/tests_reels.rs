//! Audit réel de bout en bout (réseau, Node, Chrome), ignoré par défaut :
//! `cargo test --lib audit::tests_reels -- --ignored --nocapture`

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{Value, json};

use super::{Reglages, arreter, demarrer};

const BASE: &str = "http://127.0.0.1:4322";

/// Chrome lancés par puppeteer encore en vie (Windows).
fn chrome_restants() -> usize {
    let sortie = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ? CommandLine -like '*puppeteer_dev_chrome_profile*').Count",
        ])
        .output()
        .expect("powershell");
    String::from_utf8_lossy(&sortie.stdout).trim().parse().unwrap_or(usize::MAX)
}

async fn lire(client: &reqwest::Client, chemin: &str) -> Value {
    client.get(format!("{BASE}{chemin}")).send().await.unwrap().json().await.unwrap()
}

async fn poster(client: &reqwest::Client, chemin: &str, corps: Value) -> (u16, Value) {
    let r = client.post(format!("{BASE}{chemin}")).json(&corps).send().await.unwrap();
    (r.status().as_u16(), r.json().await.unwrap_or(Value::Null))
}

/// Attend que le statut du job vérifie la condition (2 min au plus).
async fn attendre(client: &reqwest::Client, id: u64, condition: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..240 {
        let s = lire(client, &format!("/api/status/{id}")).await;
        if condition(&s) {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("délai dépassé pour le job {id}");
}

/// Crée un job sur example.com et attend la fin de la découverte.
async fn decouvrir(client: &reqwest::Client) -> u64 {
    let (code, r) = poster(client, "/api/discover", json!({ "url": "example.com", "maxPages": 5 })).await;
    assert_eq!(code, 201, "{r}");
    let id = r["jobId"].as_u64().unwrap();
    attendre(client, id, |s| s["status"] != "discovering").await;
    id
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn audit_complet_annulation_et_arret() {
    let dossier = std::env::temp_dir().join(format!("eco-audit-test-{}", std::process::id()));
    let mesure = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("mesure");
    tokio::spawn(demarrer(Reglages { dossier_donnees: dossier.clone(), node: "node".into(), dossier_mesure: mesure }));

    let client = reqwest::Client::new();
    for _ in 0..50 {
        if client.get(format!("{BASE}/api/etat")).send().await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let etat = lire(&client, "/api/etat").await;
    println!("etat : {etat}");
    assert_eq!(etat["navigateur"]["trouve"], json!(true));

    // 1. Audit complet d'une page.
    let id = decouvrir(&client).await;
    let d = lire(&client, &format!("/api/discover/{id}")).await;
    println!("découverte : {d}");
    let urls = d["discoveredUrls"].clone();
    let (code, r) = poster(&client, &format!("/api/audit/{id}"), json!({ "selectedUrls": urls, "mode": "econome" })).await;
    assert_eq!(code, 200, "{r}");
    let fin = attendre(&client, id, |s| s["finished"] == json!(true)).await;
    assert_eq!(fin["status"], json!("done"), "{fin}");
    let rapport = lire(&client, &format!("/api/report/{id}")).await;
    let page = &rapport["pages"][0];
    println!("page : scores {} / ecoindex {}", page["desktopScores"], page["ecoindex"]);
    assert_eq!(page["status"], json!("ok"));
    assert!(page["ecoindex"]["grade"].is_string());
    assert!(rapport["aCorriger"].is_array());
    assert!(dossier.join(format!("{id}.json")).is_file());
    assert_eq!(chrome_restants(), 0, "Chrome restant après un audit terminé");

    // 2. Annulation en pleine mesure, deux processus en parallèle.
    let id = decouvrir(&client).await;
    let selection = json!(["https://example.com/", "https://example.com/?a=1", "https://example.com/?b=2"]);
    let (code, r) = poster(&client, &format!("/api/audit/{id}"), json!({ "selectedUrls": selection, "mode": "personnalise", "simultanes": 2 })).await;
    assert_eq!((code, r["simultanes"].clone()), (200, json!(2)), "{r}");
    attendre(&client, id, |s| s["currentUrls"].as_array().is_some_and(|u| u.len() == 2)).await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let (code, r) = poster(&client, &format!("/api/jobs/{id}/cancel"), json!({})).await;
    assert_eq!(code, 200, "{r}");
    let fin = attendre(&client, id, |s| s["finished"] == json!(true)).await;
    assert_eq!(fin["status"], json!("stopped"), "{fin}");
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(chrome_restants(), 0, "Chrome restant après une annulation");

    // 3. Fermeture de l'application pendant un audit.
    let id = decouvrir(&client).await;
    let (code, _) = poster(&client, &format!("/api/audit/{id}"), json!({ "selectedUrls": ["https://example.com/"] })).await;
    assert_eq!(code, 200);
    attendre(&client, id, |s| s["currentUrls"].as_array().is_some_and(|u| !u.is_empty())).await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let debut = std::time::Instant::now();
    tokio::task::spawn_blocking(arreter).await.unwrap();
    println!("arrêt en {} ms", debut.elapsed().as_millis());
    let s = lire(&client, &format!("/api/status/{id}")).await;
    assert!(s["finished"] == json!(true), "{s}");
    assert_eq!(chrome_restants(), 0, "Chrome restant après l'arrêt de l'application");

    let _ = std::fs::remove_dir_all(dossier);
}
