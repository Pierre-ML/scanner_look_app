# EcoAudit

Logiciel de bureau Windows pour auditer les pages d'un site **depuis votre machine** : scores
Lighthouse bureau et mobile (performance, accessibilité, bonnes pratiques, référencement) et
estimation de l'éco-index, page par page, avec un rapport qui se construit en direct.

Tout tourne en local, avec **votre** Chrome : rien n'est hébergé, aucune donnée ne quitte
votre machine (hormis, bien sûr, les requêtes envoyées aux sites que vous auditez). Les
mesures reflètent votre vrai processeur et votre vrai réseau, pas ceux d'un serveur distant.

[Télécharger EcoAudit-Setup.exe](https://github.com/Pierre-ML/scanner_look_app/releases/latest/download/EcoAudit-Setup.exe)
(dernière release ; `EcoAudit-Update.exe` sert à mettre à jour).

---

## Prérequis

| | |
| --- | --- |
| **Système** | Windows 10 ou 11 (64 bits) |
| **Navigateur** | **Google Chrome** installé normalement. À défaut, Microsoft Edge est utilisé. |

Aucun Chromium n'est téléchargé : l'outil pilote le Chrome déjà présent sur votre poste. Node.js
est embarqué dans le logiciel : il n'est pas à installer.

## Installation et mise à jour

1. Téléchargez `EcoAudit-Setup.exe` (lien ci-dessus) et lancez-le. EcoAudit s'installe pour votre
   compte Windows, dans `%LOCALAPPDATA%\Programs\EcoAudit`, sans droits administrateur.
2. Mise à jour : depuis l'application (vérification de la dernière release GitHub), ou en lançant
   `EcoAudit-Update.exe`. Vos audits sont conservés.
3. Désinstaller (Paramètres Windows) supprime aussi vos audits.

> **Antivirus.** L'exécutable n'est pas signé : Windows SmartScreen ou certains antivirus peuvent
> l'analyser ou afficher un avertissement. Le nom des fichiers ne change jamais d'une version à l'autre.

## Utilisation

1. **Découverte.** Saisissez une adresse (`exemple.fr` suffit). Les pages sont trouvées dans le
   plan du site (`sitemap.xml`), sinon en suivant les liens internes. Le `robots.txt` est
   respecté.
2. **Sélection.** Cochez les pages à auditer, sans limite de nombre, ou ajoutez-en à la main
   (même site uniquement). Les 8 premières sont cochées d'office. Au-delà de 15 pages,
   l'interface prévient que l'audit sera long et en estime la durée.
3. **Rapport.** Chaque page passe deux fois dans Lighthouse (bureau, puis mobile), soit environ
   25 secondes par page. Les résultats s'affichent au fur et à mesure. Le bouton
   **Arrêter le scan** interrompt l'audit immédiatement, en gardant les pages terminées.

### Ce qu'il faut corriger

Sous les moyennes, la section **À corriger** liste ce que Lighthouse signale sur les pages
auditées, par catégorie (performance, accessibilité, bonnes pratiques, référencement) :

- les textes sont **ceux de Lighthouse**, en français, avec ses liens vers la documentation
  (Chrome for Developers, Deque…) : rien n'est reformulé ni ajouté ;
- un point relevé sur plusieurs pages n'apparaît qu'une fois, avec la liste des pages
  concernées, le support (bureau, mobile) et, quand Lighthouse la donne, l'économie estimée ;
- les plus répandus viennent en premier ; ▲ signale un échec, ■ un point à améliorer, comme
  dans Lighthouse ;
- pour chaque page, les 5 premiers éléments en cause (extrait HTML, fichier, lien).

Limites :
- seuls les audits **en échec** (score sous 0,9, la règle du rapport Lighthouse) sont listés ;
- les mesures (LCP, TBT…) n'y figurent pas : elles sont résumées par le score de performance ;
- les vérifications que Lighthouse demande de faire à la main n'y figurent pas non plus ;
- les audits réalisés avant l'ajout de cette section n'ont pas ces données : relancez-les.

### Modes d'audit

Au moment de lancer l'audit, trois modes au choix :

| Mode | Pages en même temps | Pour quoi |
| --- | --- | --- |
| **Arrière-plan** | 1, Chrome en priorité basse | Continuer à travailler pendant l'audit : le PC reste fluide. Le plus long. |
| **Personnalisé** (par défaut) | de 1 à 6, au choix | À 1 page : la mesure la plus fiable. |
| **Rapide** | le maximum de la machine | Le plus court. |

Le maximum recommandé est calculé au lancement : la moitié des cœurs du processeur, et environ
0,7 Go de mémoire **libre** par page, au plus 6. Avec peu de mémoire libre, il peut tomber à 1 :
fermez des applications, ou montez plus haut en mode personnalisé (l'interface prévient que la
machine risque de ralentir).

À savoir :
- **Plusieurs pages en même temps faussent les scores de performance** : les pages se
  partagent le processeur (le README de Lighthouse le signale aussi). L'accessibilité, les
  bonnes pratiques et le référencement ne changent pas. Le rapport l'indique en tête.
- **Aucun mode ne « consomme rien »** : Lighthouse a besoin du processeur. Le mode
  arrière-plan baisse seulement la priorité de Chrome ; si le PC est très sollicité pendant
  ce temps, la performance mesurée peut baisser un peu. Chrome ajuste lui-même la priorité de
  quelques-uns de ses sous-processus.
- Chaque page en parallèle a son propre processus et son propre Chrome ; tout est fermé à la
  fin, à l'arrêt demandé et à la fermeture du logiciel.

Un seul audit tourne à la fois : un audit utilise tout Chrome, et deux audits simultanés
fausseraient leurs mesures.

### Vos audits

- Chaque audit est enregistré dans `%APPDATA%\com.ecoaudit.desktop\audits\<numéro>.json`. Rien
  n'est supprimé automatiquement.
- La page **Mes audits** les liste tous et permet d'en supprimer.
- Le bouton **Exporter le rapport (JSON)**, en bas de chaque rapport, télécharge le rapport
  complet : scores par page, moyennes, éco-index, durées.

## Aucune configuration

Le logiciel est 100 % local et ne demande aucun réglage : l'interface est servie sur
`127.0.0.1:4321` et l'API d'audit sur `127.0.0.1:4322`, jamais joignables depuis le réseau.
Chrome est trouvé automatiquement dans `%ProgramFiles%`, `%ProgramFiles(x86)%` puis
`%LOCALAPPDATA%`, avec repli sur Microsoft Edge. La découverte propose au plus 500 pages ;
chaque passage Lighthouse est limité à 3 minutes.

## Pourquoi mes scores diffèrent de PageSpeed Insights ou de DevTools

C'est normal, et c'est en partie le but : Lighthouse est une mesure **de laboratoire**, qui
dépend de la machine, du réseau et des réglages. Les principales sources d'écart :

- **Le throttling (ralentissement simulé).**
  - En **mobile**, EcoAudit utilise la configuration par défaut de Lighthouse : téléphone
    moyen et 4G lente simulés. C'est aussi ce que fait PageSpeed Insights.
  - En **bureau**, EcoAudit ne simule rien : le score reflète votre processeur et votre
    connexion. PageSpeed Insights simule une connexion et un processeur de bureau « moyens ».
    Sur une machine rapide avec une bonne connexion, attendez-vous à des scores de performance
    bureau **plus élevés** que sur PSI.
- **La machine.** Le throttling simulé part des mesures réelles : un processeur occupé
  (compilation, visioconférence, autre onglet lourd) fait baisser les scores, y compris en
  mode simulé. Fermez les applications gourmandes pendant un audit.
- **Le réseau.** PSI mesure depuis les serveurs de Google ; vous mesurez depuis chez vous.
  La latence vers le site, le Wi-Fi, un VPN ou un antivirus qui inspecte le trafic changent
  les temps de chargement.
- **Les extensions.** DevTools audite dans votre profil Chrome, extensions comprises (bloqueur
  de publicité, gestionnaire de mots de passe…). EcoAudit lance Chrome avec un **profil
  temporaire vierge** : ni extensions, ni cache, ni cookies. C'est plus proche de PSI, mais
  peut s'écarter de ce que vous voyez dans DevTools.
- **La variabilité.** Deux passages successifs sur la même page donnent rarement le même score
  de performance : quelques points d'écart sont courants. Comparez des tendances, pas des
  unités.
- **Les versions.** Lighthouse 13 et votre version de Chrome peuvent différer de celles de PSI
  à un instant donné.
- **Données de terrain.** PSI affiche aussi, quand elles existent, les données réelles des
  visiteurs (Chrome UX Report). EcoAudit ne produit que des mesures de laboratoire.

L'**éco-index** est une estimation calculée localement selon la méthodologie EcoIndex
(GreenIT / CNUMR), à partir du nombre d'éléments du DOM, du nombre de requêtes et du poids
transféré lors du passage bureau. Ce n'est **pas** un résultat officiel d'ecoindex.fr.

## Dépannage

### « Aucun navigateur trouvé »

L'encart **État du service** de la page d'accueil l'indique.

- Installez [Google Chrome](https://www.google.com/chrome/), puis relancez EcoAudit.
- Chrome est installé à un emplacement inhabituel (version portable, Chrome Beta, Chromium) :
  définissez la variable d'environnement utilisateur `CHROME_PATH` (chemin de `chrome.exe`),
  puis relancez EcoAudit.

### Le logiciel ne démarre pas, ou une seule fenêtre s'ouvre

- Une seule instance tourne à la fois : relancer EcoAudit ramène la fenêtre existante au premier plan.
- Les ports 4321 et 4322 doivent être libres. Pour trouver le programme qui occupe un port
  (PowerShell) :
  ```powershell
  Get-NetTCPConnection -LocalPort 4322 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
  ```
- Les journaux de diagnostic (`session.log` et rapports de plantage) sont dans
  `%LOCALAPPDATA%\com.ecoaudit.desktop\logs-crash`.

### Un audit reste bloqué ou échoue

- Chaque passage Lighthouse est limité à 3 minutes. Au-delà, Chrome est arrêté, la page est
  marquée en erreur et l'audit continue avec la page suivante.
- Le bouton **Arrêter le scan** interrompt l'audit immédiatement.
- Une page protégée (connexion obligatoire, pare-feu applicatif, anti-bot) peut échouer ou
  être mesurée sur sa page d'erreur : le message d'erreur s'affiche dans le détail par page.

### Des processus Chrome restent ouverts

Ils ne devraient pas : Chrome est fermé à la fin de chaque audit, à l'arrêt demandé, au
dépassement du délai et à la fermeture du logiciel. Si EcoAudit a été tué brutalement, vous
pouvez vérifier (PowerShell) :

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object CommandLine -like '*puppeteer_dev_chrome_profile*'
```

Ces processus utilisent un profil temporaire et peuvent être arrêtés sans risque pour votre
Chrome habituel. Un audit interrompu par un arrêt brutal est marqué comme arrêté au démarrage
suivant.

## Développement

Prérequis : Node.js 22.19 ou plus, Rust 1.90 ou plus (MSVC) avec les Visual Studio Build Tools.

| Commande | Rôle |
| --- | --- |
| `npm install` | Installer les dépendances (interface et paquet de mesure) |
| `npm run dev` | Interface seule (`astro dev`, http://localhost:4321), sans API d'audit |
| `npm run desktop:dev` | Logiciel complet en dev (interface, API d'audit, fenêtre Tauri) |
| `npm run desktop:build` | Produire `EcoAudit-Setup.exe` et `EcoAudit-Update.exe` (dans `src-tauri/target/release/bundle/release/`) |
| `npm run version:set X.Y.Z` | Mettre à jour la version partout |

### Publier une version

1. `npm run version:set X.Y.Z` (met à jour `tauri.conf.json`, `package.json`, `package-lock.json` et `Cargo.toml`).
2. Commit puis push sur `main` : le workflow GitHub (`.github/workflows/build.yml`) vérifie que les
   versions concordent, construit sous Windows et publie la release `vX.Y.Z` avec les deux exe,
   si ce tag n'existe pas encore.

## Organisation du dépôt

```
src/          interface Astro 7 + Tailwind CSS 4 + daisyUI 5 (pages, composants, route /api qui relaie l'API d'audit)
src-tauri/    coque Tauri 2 et backend Rust
  src/audit/        API d'audit (127.0.0.1:4322), tâches de découverte et d'audit, un audit à la fois
  src/decouverte.rs sitemap, robots.txt, crawl des liens internes
  src/http.rs       client HTTP
  src/updater.rs    mise à jour depuis GitHub
  src/crashlog.rs   journaux de diagnostic
  windows/          modèle d'installateur NSIS (setup et update)
mesure/       processus Node de mesure Lighthouse (bureau + mobile), un par page en parallèle
scripts/      build du bureau, des installateurs, gestion de la version
```

L'application lance un serveur Astro autonome (Node embarqué) pour l'interface ; la route
`/api` de l'interface relaie vers l'API d'audit du backend Rust, qui pilote les processus de
mesure.

Version : source unique dans `src-tauri/tauri.conf.json`, identique dans `package.json`,
`package-lock.json` et `src-tauri/Cargo.toml`.

## Bon usage

Un audit charge chaque page plusieurs fois et lit le plan du site : auditez de préférence les
sites que vous gérez, ou pour lesquels vous avez une autorisation. Le robot s'annonce avec
l'agent `eco-audit/1.0`.

## Licence

[MIT](LICENSE) © 2026 Pierre Mouilleseaux Lhuillier.

Lighthouse est un projet Google publié sous licence Apache 2.0. La méthodologie EcoIndex est
publiée par GreenIT.fr / CNUMR.
