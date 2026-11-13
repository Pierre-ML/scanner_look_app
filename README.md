<div align="center"><h1>Luca-Audit</h1><p>Auditez les pages de votre site depuis votre machine : Lighthouse bureau et mobile, estimation EcoIndex.<br/>Audit your site's pages from your own machine: desktop and mobile Lighthouse, EcoIndex estimate.</p>
<a href="https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/Luca-Audit-Setup.exe"><b>⬇ Télécharger pour Windows · Download for Windows</b></a><br/><sub>setup pour installer · update pour mettre à jour / setup to install · update to update · <a href="https://github.com/Pierre-ML/scanner_look_app/releases/latest">releases</a></sub></div>

<p align="center">
<a href="https://github.com/Pierre-ML/scanner_look_app/releases/latest"><img src="https://img.shields.io/github/v/release/Pierre-ML/scanner_look_app" alt="Dernière release" /></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-green" alt="MIT" /></a>
<img src="https://img.shields.io/badge/plateforme-Windows-blue" alt="Windows" />
<a href="https://github.com/Pierre-ML/scanner_look_app/releases"><img src="https://img.shields.io/github/downloads/Pierre-ML/scanner_look_app/total" alt="Téléchargements" /></a>
</p>

<p align="center"><a href="#français">Français</a> · <a href="#english">English</a></p>

<!-- TODO: capture d'écran -->

---

# Français

## Présentation

Luca-Audit est un logiciel de bureau Windows qui audite les pages d'un site **depuis votre machine** : scores Lighthouse bureau et mobile (performance, accessibilité, bonnes pratiques, référencement) et estimation de l'éco-index, page par page, avec un rapport qui se construit en direct.

Tout tourne en local, avec **votre** Chrome : rien n'est hébergé, aucune donnée ne quitte votre machine (hormis les requêtes envoyées aux sites que vous auditez). Les mesures reflètent votre vrai processeur et votre vrai réseau.

## Fonctionnalités

- 🔎 Découverte des pages : `sitemap.xml`, sinon liens internes (le `robots.txt` est respecté)
- ✅ Sélection libre des pages, ajout manuel (même site uniquement), durée estimée
- 📊 Lighthouse 13 bureau et mobile, rapport en direct, arrêt immédiat du scan
- 🌱 Estimation de l'éco-index (méthodologie GreenIT / CNUMR)
- 🛠️ Section « À corriger » : les audits en échec, avec les textes et liens de Lighthouse, regroupés par point et par page
- ⚙️ Trois modes : arrière-plan, personnalisé (1 à 6 pages en parallèle) et rapide
- 🗂️ Page « Mes audits » et export du rapport en JSON
- 🔄 Mise à jour depuis l'application
- 💾 Données stockées localement (fichiers JSON)

## Installation

1. Pour une première installation, téléchargez [`Luca-Audit-Setup.exe`](https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/Luca-Audit-Setup.exe) (lien direct, dernière release).
2. Lancez l'installateur. Luca-Audit s'installe pour votre compte Windows, dans `%LOCALAPPDATA%\Programs\Luca-Audit`. Aucune autorisation administrateur n'est demandée.

Prérequis : Windows 10 ou 11 (64 bits) et **Google Chrome** installé normalement (à défaut, Microsoft Edge). Aucun Chromium n'est téléchargé et Node.js est embarqué.

> **Antivirus.** L'exécutable n'est pas signé. Windows SmartScreen ou certains antivirus peuvent donc l'analyser ou afficher un avertissement.

Le nom du fichier ne change jamais : une seule exception dans votre antivirus suffit pour toutes les versions.

## Premiers pas

1. **Découverte.** Saisissez une adresse (`exemple.fr` suffit).
2. **Sélection.** Cochez les pages à auditer (les 8 premières le sont d'office). Au-delà de 15 pages, l'interface prévient que l'audit sera long.
3. **Rapport.** Chaque page passe deux fois dans Lighthouse (bureau, puis mobile), soit environ 25 secondes par page. **Arrêter le scan** interrompt l'audit en gardant les pages terminées.

## Modes d'audit

| Mode | Pages en même temps | Pour quoi |
| --- | --- | --- |
| **Arrière-plan** | 1, Chrome en priorité basse | Continuer à travailler pendant l'audit. Le plus long. |
| **Personnalisé** (par défaut) | de 1 à 6, au choix | À 1 page : la mesure la plus fiable. |
| **Rapide** | le maximum de la machine | Le plus court. |

Le maximum recommandé est calculé au lancement : la moitié des cœurs du processeur et environ 0,7 Go de mémoire **libre** par page, au plus 6.

- **Plusieurs pages en même temps faussent les scores de performance** : elles se partagent le processeur. L'accessibilité, les bonnes pratiques et le référencement ne changent pas. Le rapport l'indique en tête.
- Aucun mode ne « consomme rien » : Lighthouse a besoin du processeur.
- Un seul audit tourne à la fois. Chaque page en parallèle a son propre Chrome, fermé à la fin, à l'arrêt demandé et à la fermeture du logiciel.

## « À corriger »

Sous les moyennes, la section liste ce que Lighthouse signale, par catégorie :

- les textes sont **ceux de Lighthouse**, en français, avec ses liens vers la documentation : rien n'est reformulé ;
- un point relevé sur plusieurs pages n'apparaît qu'une fois, avec les pages concernées, le support (bureau, mobile) et l'économie estimée quand elle existe ;
- les plus répandus d'abord ; ▲ un échec, ■ un point à améliorer ;
- pour chaque page, les 5 premiers éléments en cause.

Limites : seuls les audits en échec (score sous 0,9) sont listés ; les mesures (LCP, TBT…) sont résumées par le score de performance ; les vérifications manuelles de Lighthouse n'y figurent pas.

## Pourquoi mes scores diffèrent de PageSpeed Insights ou de DevTools

Lighthouse est une mesure **de laboratoire** : elle dépend de la machine, du réseau et des réglages.

- **Throttling.** En mobile, la configuration par défaut de Lighthouse (téléphone moyen, 4G lente simulés), comme PSI. En bureau, rien n'est simulé : attendez-vous à des scores de performance **plus élevés** que sur PSI sur une machine rapide.
- **Machine et réseau.** Un processeur occupé, un VPN ou un antivirus qui inspecte le trafic font baisser les scores. Fermez les applications gourmandes pendant un audit.
- **Extensions.** Luca-Audit lance Chrome avec un **profil temporaire vierge** (ni extensions, ni cache, ni cookies), plus proche de PSI que de DevTools.
- **Variabilité.** Quelques points d'écart entre deux passages sont courants : comparez des tendances.
- **Données de terrain.** PSI affiche aussi les données réelles des visiteurs (CrUX) ; Luca-Audit ne produit que des mesures de laboratoire.

L'**éco-index** est une estimation locale (éléments du DOM, requêtes et poids transféré, passage bureau). Ce n'est **pas** un résultat officiel d'ecoindex.fr.

## Mise à jour

Depuis l'application : le bouton de mise à jour vérifie la dernière release GitHub, télécharge l'updater et l'installe après confirmation.

À la main : téléchargez [`Luca-Audit-Update.exe`](https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/Luca-Audit-Update.exe) (lien direct, dernière release) et lancez-le.

Vos audits sont conservés. Repartir de zéro : désinstallez Luca-Audit depuis les Paramètres Windows (cela supprime aussi vos audits), puis relancez le setup.

## Dépannage

- **« Aucun navigateur trouvé »** (encart *État du service*) : installez [Google Chrome](https://www.google.com/chrome/), ou, pour un Chrome à un emplacement inhabituel, définissez la variable d'environnement utilisateur `CHROME_PATH` (chemin de `chrome.exe`) puis relancez.
- **Le logiciel ne démarre pas** : une seule instance tourne à la fois, et les ports 4321 et 4322 doivent être libres. Journaux : `%LOCALAPPDATA%\com.luca-audit.desktop\logs-crash`.
- **Un audit reste bloqué** : chaque passage Lighthouse est limité à 3 minutes, puis la page est marquée en erreur et l'audit continue. Une page protégée (connexion, anti-bot) peut échouer.
- **Des processus Chrome restent ouverts** (après un arrêt brutal) : ils utilisent un profil temporaire et peuvent être arrêtés sans risque.
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object CommandLine -like '*puppeteer_dev_chrome_profile*'
  ```

## Développement

Prérequis : Node.js 22.19 ou plus, Rust 1.90 ou plus (MSVC) et les Visual Studio Build Tools.

| Commande | Rôle |
| --- | --- |
| `npm install` | Installer les dépendances (interface et paquet de mesure) |
| `npm run dev` | Interface seule sur http://localhost:4321, sans API d'audit |
| `npm run desktop:dev` | Logiciel complet en dev (interface, API d'audit, fenêtre Tauri) |
| `npm run desktop:build` | Produire les deux exe Windows (`Luca-Audit-Setup.exe` et `Luca-Audit-Update.exe`, dans `src-tauri/target/release/bundle/release/`) |
| `npm run version:set X.Y.Z` | Mettre à jour la version partout |

Version : source unique dans `src-tauri/tauri.conf.json`, identique dans `package.json`, `package-lock.json` et `src-tauri/Cargo.toml`. Commit et push sur `main` : le workflow GitHub (`.github/workflows/build.yml`) construit sous Windows et publie la release `vX.Y.Z` si ce tag n'existe pas.

## Stack

Astro 7 (SSR, adapter Node) · Tailwind CSS 4 · daisyUI 5 · Lighthouse 13 · `puppeteer-core` · Tauri 2 · Rust (`axum`, `reqwest`).

## Structure

- `src` : interface Astro (pages, composants, route `/api` qui relaie l'API d'audit).
- `src-tauri` : coque Tauri et backend Rust (`audit/` : API d'audit sur 127.0.0.1:4322, `decouverte.rs`, `http.rs`, `updater.rs`, `crashlog.rs`, `windows/` : installateur NSIS).
- `mesure` : processus Node de mesure Lighthouse, un par page en parallèle.
- `scripts` : build du bureau, des installateurs, gestion de la version.

## Confidentialité

Luca-Audit ne contacte que :

- les sites que vous auditez (robot annoncé par l'agent `luca-audit/1.0`) ;
- GitHub, pour vérifier et télécharger les mises à jour.

L'interface (127.0.0.1:4321) et l'API d'audit (127.0.0.1:4322) ne sont jamais joignables depuis le réseau. Chaque audit est un fichier JSON dans `%APPDATA%\com.luca-audit.desktop\audits`, jamais supprimé automatiquement.

> Auditez de préférence les sites que vous gérez, ou pour lesquels vous avez une autorisation.

## Licence

[MIT](LICENSE) © 2026 Pierre Mouilleseaux Lhuillier. Dépôt : https://github.com/Pierre-ML/scanner_look_app

Lighthouse est un projet Google sous licence Apache 2.0. La méthodologie EcoIndex est publiée par GreenIT.fr / CNUMR.

---

# English

## Overview

Luca-Audit is a Windows desktop app that audits your site's pages **from your own machine**: desktop and mobile Lighthouse scores (performance, accessibility, best practices, SEO) and an EcoIndex estimate, page by page, with a report that builds live.

Everything runs locally, with **your** Chrome: nothing is hosted, no data leaves your machine (apart from the requests sent to the sites you audit). Measurements reflect your real CPU and network.

## Features

- 🔎 Page discovery: `sitemap.xml`, otherwise internal links (`robots.txt` is honored)
- ✅ Free page selection, manual additions (same site only), estimated duration
- 📊 Lighthouse 13 desktop and mobile, live report, immediate scan stop
- 🌱 EcoIndex estimate (GreenIT / CNUMR methodology)
- 🛠️ "To fix" section: failing audits, with Lighthouse's own texts and links, grouped by issue and page
- ⚙️ Three modes: background, custom (1 to 6 pages in parallel) and fast
- 🗂️ "My audits" page and JSON report export
- 🔄 In-app update
- 💾 Data stored locally (JSON files)

## Installation

1. For a first install, download [`Luca-Audit-Setup.exe`](https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/Luca-Audit-Setup.exe) (direct link, latest release).
2. Run the installer. Luca-Audit installs for your Windows account, in `%LOCALAPPDATA%\Programs\Luca-Audit`. No administrator permission is asked.

Requirements: Windows 10 or 11 (64-bit) and a regular **Google Chrome** install (Microsoft Edge as a fallback). No Chromium is downloaded and Node.js is embedded.

> **Antivirus.** The executable is not signed. Windows SmartScreen or some antivirus tools may scan it or show a warning.

The file name never changes: a single exception in your antivirus is enough for all versions.

## Getting started

1. **Discovery.** Enter an address (`example.com` is enough).
2. **Selection.** Tick the pages to audit (the first 8 are ticked by default). Beyond 15 pages, the interface warns that the audit will be long.
3. **Report.** Each page goes through Lighthouse twice (desktop, then mobile), about 25 seconds per page. **Stop the scan** interrupts the audit and keeps finished pages.

## Audit modes

| Mode | Pages at once | For |
| --- | --- | --- |
| **Background** | 1, Chrome at low priority | Keep working during the audit. The longest. |
| **Custom** (default) | 1 to 6, your choice | At 1 page: the most reliable measurement. |
| **Fast** | the machine's maximum | The shortest. |

The recommended maximum is computed at launch: half the CPU cores and about 0.7 GB of **free** memory per page, at most 6.

- **Several pages at once skew performance scores**: they share the CPU. Accessibility, best practices and SEO are unaffected. The report says so at the top.
- No mode "uses nothing": Lighthouse needs the CPU.
- Only one audit runs at a time. Each parallel page has its own Chrome, closed at the end, on stop and when the app closes.

## "To fix"

Under the averages, the section lists what Lighthouse flags, by category:

- the texts are **Lighthouse's own**, in French, with its documentation links: nothing is reworded;
- an issue found on several pages appears once, with the affected pages, the device (desktop, mobile) and the estimated savings when available;
- most widespread first; ▲ a failure, ■ an improvement;
- for each page, the first 5 offending elements.

Limits: only failing audits (score below 0.9) are listed; metrics (LCP, TBT…) are summarized by the performance score; Lighthouse's manual checks are not included.

## Why my scores differ from PageSpeed Insights or DevTools

Lighthouse is a **lab** measurement: it depends on the machine, the network and the settings.

- **Throttling.** On mobile, Lighthouse's default (simulated mid-range phone, slow 4G), like PSI. On desktop nothing is simulated: on a fast machine, expect **higher** desktop performance scores than on PSI.
- **Machine and network.** A busy CPU, a VPN or an antivirus inspecting traffic lowers scores. Close heavy apps during an audit.
- **Extensions.** Luca-Audit starts Chrome with a **blank temporary profile** (no extensions, cache or cookies), closer to PSI than to DevTools.
- **Variability.** A few points between two runs are common: compare trends.
- **Field data.** PSI also shows real visitor data (CrUX); Luca-Audit only produces lab measurements.

The **EcoIndex** is a local estimate (DOM elements, requests and transferred size, desktop run). It is **not** an official ecoindex.fr result.

## Updating

From the app: the update button checks the latest GitHub release, downloads the updater and installs it after confirmation.

By hand: download [`Luca-Audit-Update.exe`](https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/Luca-Audit-Update.exe) (direct link, latest release) and run it.

Your audits are kept. Start from scratch: uninstall Luca-Audit from Windows Settings (this also deletes your audits), then run the setup again.

## Troubleshooting

- **"No browser found"** (*Service status* box): install [Google Chrome](https://www.google.com/chrome/), or, for Chrome at an unusual location, set the user environment variable `CHROME_PATH` (path to `chrome.exe`) and restart.
- **The app does not start**: only one instance runs at a time, and ports 4321 and 4322 must be free. Logs: `%LOCALAPPDATA%\com.luca-audit.desktop\logs-crash`.
- **An audit hangs**: each Lighthouse run is capped at 3 minutes, then the page is marked as failed and the audit continues. A protected page (login, anti-bot) may fail.
- **Chrome processes remain** (after a hard kill): they use a temporary profile and can be stopped safely.
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object CommandLine -like '*puppeteer_dev_chrome_profile*'
  ```

## Development

Requirements: Node.js 22.19 or newer, Rust 1.90 or newer (MSVC) and Visual Studio Build Tools.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies (interface and measurement package) |
| `npm run dev` | Interface only on http://localhost:4321, no audit API |
| `npm run desktop:dev` | Full app in dev (interface, audit API, Tauri window) |
| `npm run desktop:build` | Build both Windows exes (`Luca-Audit-Setup.exe` and `Luca-Audit-Update.exe`, in `src-tauri/target/release/bundle/release/`) |
| `npm run version:set X.Y.Z` | Set the version everywhere |

Version: single source in `src-tauri/tauri.conf.json`, identical in `package.json`, `package-lock.json` and `src-tauri/Cargo.toml`. Commit and push to `main`: the GitHub workflow (`.github/workflows/build.yml`) builds on Windows and publishes the `vX.Y.Z` release if that tag does not exist.

## Stack

Astro 7 (SSR, Node adapter) · Tailwind CSS 4 · daisyUI 5 · Lighthouse 13 · `puppeteer-core` · Tauri 2 · Rust (`axum`, `reqwest`).

## Structure

- `src`: Astro interface (pages, components, `/api` route relaying to the audit API).
- `src-tauri`: Tauri shell and Rust backend (`audit/`: audit API on 127.0.0.1:4322, `decouverte.rs`, `http.rs`, `updater.rs`, `crashlog.rs`, `windows/`: NSIS installer).
- `mesure`: Node Lighthouse measurement process, one per page in parallel.
- `scripts`: desktop and installer builds, version management.

## Privacy

Luca-Audit only contacts:

- the sites you audit (the bot announces itself as `luca-audit/1.0`);
- GitHub, to check and download updates.

The interface (127.0.0.1:4321) and the audit API (127.0.0.1:4322) are never reachable from the network. Each audit is a JSON file in `%APPDATA%\com.luca-audit.desktop\audits`, never deleted automatically.

> Preferably audit sites you manage or are authorized to test.

## License

[MIT](LICENSE) © 2026 Pierre Mouilleseaux Lhuillier. Repository: https://github.com/Pierre-ML/scanner_look_app

Lighthouse is a Google project under the Apache 2.0 license. The EcoIndex methodology is published by GreenIT.fr / CNUMR.
