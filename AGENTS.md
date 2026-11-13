# Luca-Audit — consignes pour les agents

Logiciel de bureau **Windows** d'audit (Lighthouse bureau + mobile, estimation EcoIndex), sur le
modèle de Lucania : Tauri 2 + interface Astro servie par un Node embarqué (sidecar) + installateur
NSIS + release GitHub donnant deux exe (`Luca-Audit-Setup.exe`, `Luca-Audit-Update.exe`).

## Structure

- `src/` — interface Astro 7 (`output: 'server'`, adaptateur `@astrojs/node`) + Tailwind 4 +
  daisyUI 5, port 4321. La route `src/pages/api/[...chemin].js` relaie `/api` vers l'API d'audit.
- `src-tauri/` — coque Tauri 2 et backend Rust :
  - `src/lib.rs` : fenêtre, sidecar Node (production), démarrage et arrêt de l'API d'audit ;
  - `src/audit/` : API d'audit (axum, 127.0.0.1:4322), tâches, stockage ; `src/decouverte.rs` :
    découverte des pages ; `src/http.rs` : client HTTP ;
  - `src/updater.rs` (commandes `app_check_update`, `app_install_update`) et `src/crashlog.rs`
    (journaux, commandes `app_crash_logs`, `app_open_crash_logs`) ;
  - `windows/` : modèle NSIS (setup et update), `loader/` : page de démarrage de la fenêtre.
- `mesure/` — paquet Node (workspace npm) : `processus.mjs` mesure une page avec Lighthouse 13 via
  `puppeteer-core` et le Chrome de la machine ; lancé par le backend Rust.
- `scripts/` — `build-desktop.mjs` (Astro + ressources + auto-test), `build-updater.mjs`,
  `name-installers.mjs`, `set-version.mjs`.
- `.github/workflows/build.yml` — build Windows et release à chaque push sur `main`.

Les audits sont des fichiers JSON dans `%APPDATA%\com.luca-audit.desktop\audits`.

## Lancer

```
npm install
npm run desktop:dev      # logiciel complet (interface + API d'audit + fenêtre Tauri)
npm run desktop:build    # Luca-Audit-Setup.exe et Luca-Audit-Update.exe
```

`npm run dev` lance l'interface seule (`astro dev`, localhost:4321), sans API d'audit.
Après une modification du Rust, `tauri dev` recompile et relance tout seul.

## Publier une version

`npm run version:set X.Y.Z` (met à jour `tauri.conf.json`, `package.json`, `package-lock.json`,
`Cargo.toml`), puis commit et push sur `main` : le workflow vérifie les versions, construit, et
publie la release `vX.Y.Z` avec les deux exe si le tag n'existe pas.

## Règles

- Styles : **uniquement Tailwind** (utilitaires et composants daisyUI) dans le balisage. Aucune
  classe CSS maison, aucun bloc `<style>`, aucun `style="…"` sauf une valeur dynamique exigée
  par un composant (ex. `--value` de `radial-progress`). `src/styles/global.css` ne contient
  que la configuration Tailwind : `@import`, `@plugin` daisyUI, `@theme` (jetons, animations et
  leurs `@keyframes`) et `@font-face`. Un retard d'animation se pose avec `[--retard:…]`.
  Exception : `src-tauri/loader/index.html` (page de démarrage hors Astro).
- Design : direction artistique de la série Lucania ; ne pas refaire l'interface ni relancer de
  scaffolding (`npm create astro`).
- Ne pas mettre à jour les dépendances (`@latest`) sans demande explicite.
- Code et commentaires en français, dans le style existant.
- Commentaires : l'essentiel seulement, une ligne en général, trois au maximum.
- Outil 100 % local : aucun `.env` ni fichier d'exemple ; valeurs fixes dans le code
  (seule exception : `CHROME_PATH`, pour un Chrome installé à un endroit inhabituel).
- Un seul audit à la fois ; ne pas réintroduire de file de jobs ni de CORS. Les pages d'UN audit
  peuvent être mesurées en parallèle par une équipe de processus `mesure/processus.mjs` lancée et
  arrêtée par le backend Rust : c'est le seul multi-processus autorisé, et chaque processus doit
  fermer son Chrome (aussi à la fermeture du logiciel).
- La version est unique (`tauri.conf.json`) : la changer uniquement avec `npm run version:set`.
- Tester un changement du backend avec un audit réel, puis vérifier qu'aucun Chrome ne reste :
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? CommandLine -like '*puppeteer_dev_chrome_profile*'`

## Documentation

- Astro : https://docs.astro.build
- Tauri 2 : https://v2.tauri.app
- Lighthouse : https://github.com/GoogleChrome/lighthouse/tree/main/docs
