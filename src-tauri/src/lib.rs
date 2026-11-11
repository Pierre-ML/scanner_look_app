use std::path::PathBuf;

use tauri::Manager;

mod audit;
mod crashlog;
mod decouverte;
mod http;
mod updater;

/// Retire le préfixe verbatim (backslash x2, point d'interrogation, backslash) que Windows
/// ajoute aux chemins de ressources et que node ne sait pas résoudre.
#[cfg(not(debug_assertions))]
fn clean(p: PathBuf) -> PathBuf {
  let s = p.to_string_lossy().to_string();
  match s.strip_prefix(r"\\?\") {
    Some(rest) => PathBuf::from(rest),
    None => p,
  }
}

#[cfg(not(debug_assertions))]
mod sidecar {
  use std::net::{SocketAddr, TcpStream};
  use std::process::{Child, Command};
  use std::sync::Mutex;
  use std::time::{Duration, Instant};
  use tauri::{AppHandle, Manager};

  use super::clean;

  /// Port du serveur Astro autonome (celui de `astro dev`).
  pub const PORT: u16 = 4321;

  #[derive(Default)]
  pub struct NodeProcess(pub Mutex<Option<Child>>);

  /// Chemin du node embarqué (à côté de l'exécutable), aussi utilisé par les processus de mesure.
  pub fn node_path() -> Result<std::path::PathBuf, String> {
    let exe_dir = std::env::current_exe()
      .map_err(|e| e.to_string())?
      .parent()
      .ok_or("répertoire de l'exécutable introuvable")?
      .to_path_buf();
    let node = exe_dir.join("node.exe");
    if !node.exists() {
      return Err(format!("node.exe introuvable : {}", node.display()));
    }
    Ok(node)
  }

  fn spawn_node(app: &AppHandle) -> Result<Child, String> {
    let node = node_path()?;
    let res = clean(app.path().resource_dir().map_err(|e| e.to_string())?);
    let entry = res.join("app").join("server").join("entry.mjs");
    if !entry.exists() {
      return Err(format!("serveur introuvable : {}", entry.display()));
    }
    let app_dir = clean(app.path().app_data_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(node);
    cmd
      .arg(entry)
      .env("PORT", PORT.to_string())
      .env("HOST", "127.0.0.1")
      .current_dir(app_dir);
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("lancement de node impossible : {e}"))
  }

  fn show_error(app: &AppHandle, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
      let js = format!(
        "var m=document.getElementById('msg');if(m){{m.className='error';m.textContent={};}}",
        serde_json::to_string(msg).unwrap_or_else(|_| "\"Erreur\"".into())
      );
      let _ = w.eval(&js);
    }
  }

  pub fn start(app: &AppHandle) {
    let child = match spawn_node(app) {
      Ok(c) => c,
      Err(e) => {
        show_error(app, &format!("Impossible de démarrer Eco Audit : {e}"));
        return;
      }
    };
    *app.state::<NodeProcess>().0.lock().unwrap() = Some(child);

    let handle = app.clone();
    std::thread::spawn(move || {
      let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
      let deadline = Instant::now() + Duration::from_secs(30);
      loop {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
          break;
        }
        // Le processus a-t-il planté ?
        if let Some(c) = handle.state::<NodeProcess>().0.lock().unwrap().as_mut() {
          if let Ok(Some(status)) = c.try_wait() {
            show_error(&handle, &format!("Le serveur s'est arrêté au démarrage ({status})."));
            return;
          }
        }
        if Instant::now() >= deadline {
          show_error(&handle, "Le serveur Eco Audit ne répond pas (délai de 30 s dépassé).");
          return;
        }
        std::thread::sleep(Duration::from_millis(250));
      }
      match (handle.get_webview_window("main"), format!("http://127.0.0.1:{PORT}").parse()) {
        (Some(w), Ok(url)) => {
          if let Err(e) = w.navigate(url) {
            show_error(&handle, &format!("Navigation impossible : {e}"));
          }
        }
        _ => show_error(&handle, "Fenêtre principale introuvable."),
      }
    });
  }

  pub fn kill(app: &AppHandle) {
    if let Some(mut c) = app.state::<NodeProcess>().0.lock().unwrap().take() {
      let _ = c.kill();
      let _ = c.wait();
    }
  }
}

/// Mise à jour (updater.rs) : arrête le serveur node embarqué (kill + wait) AVANT le lancement de
/// l'updater, pour qu'il ne verrouille plus node.exe ni app\. Sans effet en dev (pas de sidecar).
pub(crate) fn stop_sidecar(_app: &tauri::AppHandle) {
  #[cfg(not(debug_assertions))]
  sidecar::kill(_app);
}

/// Mise à jour : relance le serveur node si l'updater n'a finalement pas pu être lancé.
pub(crate) fn restart_sidecar(_app: &tauri::AppHandle) {
  #[cfg(not(debug_assertions))]
  sidecar::start(_app);
}

/// Réglages de l'API d'audit : audits dans les données de l'app ; node et script de mesure
/// embarqués en production, `node` du PATH et dossier `mesure/` du dépôt en dev.
fn reglages(app: &tauri::App) -> Result<audit::Reglages, String> {
  let donnees = app.path().app_data_dir().map_err(|e| e.to_string())?;
  #[cfg(not(debug_assertions))]
  let donnees = clean(donnees);
  let dossier_donnees = donnees.join("audits");
  std::fs::create_dir_all(&dossier_donnees).map_err(|e| e.to_string())?;

  #[cfg(not(debug_assertions))]
  let (node, dossier_mesure) = (
    sidecar::node_path()?,
    clean(app.path().resource_dir().map_err(|e| e.to_string())?).join("mesure"),
  );
  #[cfg(debug_assertions)]
  let (node, dossier_mesure) = (
    PathBuf::from("node"),
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("mesure"),
  );

  Ok(audit::Reglages { dossier_donnees, node, dossier_mesure })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let context = tauri::generate_context!();
  // Journaux de diagnostic (panique, exception native) : installés avant tout le reste. Le
  // journal de session n'est ouvert que dans `setup` (instance principale).
  crashlog::init(
    crashlog::default_dir(&context.config().identifier),
    &context.package_info().version.to_string(),
  );

  let builder = tauri::Builder::default();

  // Instance unique : doit être le PREMIER plugin enregistré. Une 2e instance transmet ses
  // arguments à la première puis se termine avant setup (ni API d'audit ni sidecar lancés).
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    if let Some(w) = app.get_webview_window("main") {
      let _ = w.unminimize();
      let _ = w.show();
      let _ = w.set_focus();
    }
  }));

  let builder = builder
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      updater::app_check_update,
      updater::app_install_update,
      crashlog::app_crash_logs,
      crashlog::app_open_crash_logs,
    ])
    .setup(|app| {
      crashlog::start_session();

      // API d'audit (127.0.0.1:4322), lancée avant l'ouverture de l'interface.
      match reglages(app) {
        Ok(r) => {
          tauri::async_runtime::spawn(async move {
            if let Err(e) = audit::demarrer(r).await {
              crashlog::note(&format!("API d'audit arrêtée : {e}"));
            }
          });
        }
        Err(e) => crashlog::note(&format!("réglages de l'audit impossibles : {e}")),
      }

      #[cfg(debug_assertions)]
      if let Some(w) = app.get_webview_window("main") {
        w.open_devtools();
      }

      #[cfg(not(debug_assertions))]
      {
        app.manage(sidecar::NodeProcess::default());
        sidecar::start(app.handle());
      }
      Ok(())
    });

  builder
    .build(context)
    .expect("error while building tauri application")
    .run(|_app, event| {
      // Fermeture : processus de mesure (et leurs Chrome) puis serveur Astro embarqué.
      if let tauri::RunEvent::Exit = event {
        audit::arreter();
        #[cfg(not(debug_assertions))]
        sidecar::kill(_app);
      }
    });
}
