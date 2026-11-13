//! Processus de mesure (`node processus.mjs`) : lancement, protocole en lignes JSON, arrêt forcé.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use super::ecoindex::Mesures;
use super::journal;
use super::store::{Recommandation, Scores};

/// Résultat d'une page, tel que le renvoie le processus de mesure.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResultatMesure {
    pub url: String,
    pub status: String,
    pub desktop_scores: Option<Scores>,
    pub mobile_scores: Option<Scores>,
    pub desktop_recommandations: Option<Vec<Recommandation>>,
    pub mobile_recommandations: Option<Vec<Recommandation>>,
    pub mesures: Option<Mesures>,
    pub error: Option<String>,
    pub duration_ms: Option<f64>,
}

/// Ce qu'on peut attendre d'un processus de mesure.
pub enum Evenement {
    Pret,
    Resultat(Box<ResultatMesure>),
    Echec(String),
    /// Le processus est sorti.
    Sorti,
    /// Rien reçu dans le délai.
    Delai,
}

/// Job Object Windows : tue d'un coup le processus, son Chrome et tous leurs descendants.
#[cfg(windows)]
struct JobWindows(windows_sys::Win32::Foundation::HANDLE);

// SAFETY : un handle de job s'utilise depuis n'importe quel thread.
#[cfg(windows)]
unsafe impl Send for JobWindows {}
#[cfg(windows)]
unsafe impl Sync for JobWindows {}

#[cfg(windows)]
impl JobWindows {
    /// Crée un job « tué à la fermeture » et y place le processus (avant qu'il lance Chrome).
    fn pour(processus: std::os::windows::io::RawHandle) -> Option<Self> {
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };
        // SAFETY : appels Win32 sur des handles valides, structure initialisée à zéro.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let job = JobWindows(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&raw const info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 || AssignProcessToJobObject(job.0, processus as _) == 0 {
                return None;
            }
            Some(job)
        }
    }

    fn terminer(&self) {
        // SAFETY : handle de job valide jusqu'au Drop.
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for JobWindows {
    fn drop(&mut self) {
        // Fermeture du dernier handle : Windows tue ce qui resterait dans le job.
        // SAFETY : handle possédé par cette structure.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

/// Commande d'un processus de mesure, partageable (arrêt depuis la route d'annulation ou à la fermeture).
pub struct Controle {
    envoi: mpsc::UnboundedSender<String>,
    sorti: Arc<AtomicBool>,
    pid: Option<u32>,
    #[cfg(windows)]
    job: Option<JobWindows>,
}

impl Controle {
    /// Envoie un message (une ligne JSON) au processus ; sans effet s'il est déjà fermé.
    pub fn envoyer(&self, message: Value) {
        let _ = self.envoi.send(format!("{message}\n"));
    }

    pub fn envoyer_type(&self, type_message: &str) {
        self.envoyer(json!({ "type": type_message }));
    }

    pub fn est_sorti(&self) -> bool {
        self.sorti.load(Ordering::SeqCst)
    }

    /// Tue le processus et tous ses descendants (Chrome, gpu-process, renderers).
    pub fn tuer(&self) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminer();
            return;
        }
        // Déjà terminé : son PID a pu être réattribué à un autre processus.
        if self.est_sorti() {
            return;
        }
        if let Some(pid) = self.pid {
            tuer_arbre(pid);
        }
    }
}

/// Tue un arbre de processus par son PID (repli sans Job Object).
fn tuer_arbre(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(unix)]
    for cible in [format!("-{pid}"), pid.to_string()] {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &cible])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Un processus de mesure en cours, avec la file de ses messages.
pub struct Membre {
    pub controle: Arc<Controle>,
    evenements: mpsc::UnboundedReceiver<Evenement>,
}

/// Traduit une ligne de stdout en événement (`None` : ligne ignorée).
fn lire_message(ligne: &str) -> Option<Evenement> {
    let valeur: Value = serde_json::from_str(ligne).ok()?;
    match valeur.get("type")?.as_str()? {
        "pret" => Some(Evenement::Pret),
        "echec" => Some(Evenement::Echec(
            valeur.get("message").and_then(Value::as_str).unwrap_or_default().to_string(),
        )),
        "resultat" => {
            let brut = valeur.get("resultat").cloned().unwrap_or(Value::Null);
            let resultat = serde_json::from_value::<ResultatMesure>(brut).unwrap_or_else(|e| {
                journal::avert(&format!("résultat de mesure illisible : {e}"));
                ResultatMesure {
                    url: valeur.get("url").and_then(Value::as_str).unwrap_or_default().into(),
                    status: "error".into(),
                    error: Some("Résultat de mesure illisible.".into()),
                    ..ResultatMesure::default()
                }
            });
            Some(Evenement::Resultat(Box::new(resultat)))
        }
        _ => None,
    }
}

impl Membre {
    /// Lance `<node> <dossier_mesure>/processus.mjs`, sans fenêtre console.
    pub fn lancer(
        node: &Path,
        dossier_mesure: &Path,
        chrome: &Path,
        priorite_basse: bool,
        rang: usize,
    ) -> std::io::Result<Membre> {
        let script = dossier_mesure.join("processus.mjs");

        // Priorité basse (mode économe) dès le lancement : Chrome en hérite.
        #[cfg(unix)]
        let mut commande = if priorite_basse {
            let mut c = Command::new("nice");
            c.arg("-n").arg("10").arg(node);
            c
        } else {
            Command::new(node)
        };
        #[cfg(not(unix))]
        let mut commande = Command::new(node);

        commande
            .arg(&script)
            .current_dir(dossier_mesure)
            .env("LUCA_AUDIT_CHROME", chrome)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Threading::BELOW_NORMAL_PRIORITY_CLASS;
            let priorite = if priorite_basse { BELOW_NORMAL_PRIORITY_CLASS } else { 0 };
            commande.creation_flags(CREATE_NO_WINDOW | priorite);
        }
        #[cfg(unix)]
        commande.process_group(0);
        #[cfg(not(any(windows, unix)))]
        let _ = priorite_basse;

        let mut enfant = commande.spawn()?;
        let pid = enfant.id();

        #[cfg(windows)]
        let job = enfant.raw_handle().and_then(JobWindows::pour);
        #[cfg(windows)]
        if job.is_none() {
            journal::avert("Job Object indisponible : arrêt forcé par taskkill");
        }

        let (Some(mut stdin), Some(stdout), Some(stderr)) =
            (enfant.stdin.take(), enfant.stdout.take(), enfant.stderr.take())
        else {
            return Err(std::io::Error::other("canaux du processus de mesure indisponibles"));
        };

        let (envoi, mut a_envoyer) = mpsc::unbounded_channel::<String>();
        let (evt, evenements) = mpsc::unbounded_channel::<Evenement>();
        let sorti = Arc::new(AtomicBool::new(false));

        // Écriture : une ligne par message ; stdin est fermé quand plus personne ne peut écrire.
        tokio::spawn(async move {
            while let Some(ligne) = a_envoyer.recv().await {
                if stdin.write_all(ligne.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        // Lecture des messages du protocole.
        let evt_lecture = evt.clone();
        tokio::spawn(async move {
            let mut lignes = BufReader::new(stdout).lines();
            while let Ok(Some(ligne)) = lignes.next_line().await {
                if let Some(e) = lire_message(&ligne) {
                    let _ = evt_lecture.send(e);
                }
            }
        });

        // Journaux du processus, recopiés dans celui de l'application.
        tokio::spawn(async move {
            let mut lignes = BufReader::new(stderr).lines();
            while let Ok(Some(ligne)) = lignes.next_line().await {
                if !ligne.trim().is_empty() {
                    eprintln!("[mesure {}] {ligne}", rang + 1);
                }
            }
        });

        // Sortie du processus.
        let sorti_attente = sorti.clone();
        tokio::spawn(async move {
            let _ = enfant.wait().await;
            sorti_attente.store(true, Ordering::SeqCst);
            let _ = evt.send(Evenement::Sorti);
        });

        Ok(Membre {
            controle: Arc::new(Controle {
                envoi,
                sorti,
                pid,
                #[cfg(windows)]
                job,
            }),
            evenements,
        })
    }

    /// Attend le prochain message du processus.
    pub async fn attendre(&mut self, delai: Duration) -> Evenement {
        match tokio::time::timeout(delai, self.evenements.recv()).await {
            Ok(Some(e)) => e,
            Ok(None) => Evenement::Sorti,
            Err(_) => Evenement::Delai,
        }
    }

    /// Attend la sortie du processus ; `false` si elle n'est pas venue dans le délai.
    pub async fn attendre_sortie(&mut self, delai: Duration) -> bool {
        let fin = tokio::time::Instant::now() + delai;
        loop {
            if self.controle.est_sorti() {
                return true;
            }
            match tokio::time::timeout_at(fin, self.evenements.recv()).await {
                Ok(Some(Evenement::Sorti)) | Ok(None) => return true,
                Ok(Some(_)) => continue,
                Err(_) => return self.controle.est_sorti(),
            }
        }
    }
}
