# eco-audit

Auditez les pages d'un site **depuis votre machine** : scores Lighthouse bureau et mobile
(performance, accessibilité, bonnes pratiques, référencement) et estimation de l'éco-index,
page par page, avec un rapport qui se construit en direct.

Tout tourne en local, avec **votre** Chrome : rien n'est hébergé, aucune donnée ne quitte
votre machine (hormis, bien sûr, les requêtes envoyées aux sites que vous auditez). Les
mesures reflètent votre vrai processeur et votre vrai réseau, pas ceux d'un serveur distant.

---

## Prérequis

| | |
| --- | --- |
| **Système** | Windows 10 ou 11 |
| **Node.js** | version **22.19 ou plus récente** ([nodejs.org](https://nodejs.org/), version LTS). Vérifiez avec `node -v`. |
| **Navigateur** | **Google Chrome** installé normalement. À défaut, Microsoft Edge est utilisé. |

Aucun Chromium n'est téléchargé : l'outil pilote le Chrome déjà présent sur votre poste.

## Installation et lancement

```sh
git clone https://github.com/Pierre-ML/scanner_look_app.git
cd scanner_look_app
npm install
npm run dev
```

Ouvrez ensuite **http://localhost:4321** dans votre navigateur.

`npm run dev` démarre deux programmes dans le même terminal :

- `[serveur]` : le serveur d'audit (Lighthouse), sur `127.0.0.1:4322`, jamais joignable depuis
  le réseau ;
- `[web]` : l'interface, sur `http://localhost:4321`.

Au démarrage, le serveur indique le navigateur qu'il va utiliser :

```
[serveur] 10:39:55 INFO  Navigateur d'audit : Google Chrome (C:\Program Files\Google\Chrome\Application\chrome.exe)
```

Pour tout arrêter : **Ctrl+C** dans le terminal. Un audit en cours est arrêté proprement (les
pages déjà mesurées sont gardées) et Chrome est fermé. Si Windows demande
« Terminer le programme de commandes (O/N) ? », répondez `O`.

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
  fin, à l'arrêt demandé et au Ctrl+C.

Un seul audit tourne à la fois : un audit utilise tout Chrome, et deux audits simultanés
fausseraient leurs mesures.

### Vos audits

- Chaque audit est enregistré dans `data/audits/<numéro>.json`, à la racine du dépôt (dossier
  ignoré par git). Rien n'est supprimé automatiquement.
- La page **Mes audits** les liste tous et permet d'en supprimer.
- Le bouton **Exporter le rapport (JSON)**, en bas de chaque rapport, télécharge le rapport
  complet : scores par page, moyennes, éco-index, durées.

## Aucune configuration

L'outil est 100 % local et ne demande aucun fichier de configuration : l'interface est sur le
port 4321, le serveur d'audit sur le port 4322. Chrome est trouvé automatiquement dans
`%ProgramFiles%`, `%ProgramFiles(x86)%` puis `%LOCALAPPDATA%`, avec repli sur Microsoft Edge.
La découverte propose au plus 500 pages ; chaque passage Lighthouse est limité à 3 minutes.

## Pourquoi mes scores diffèrent de PageSpeed Insights ou de DevTools

C'est normal, et c'est en partie le but : Lighthouse est une mesure **de laboratoire**, qui
dépend de la machine, du réseau et des réglages. Les principales sources d'écart :

- **Le throttling (ralentissement simulé).**
  - En **mobile**, eco-audit utilise la configuration par défaut de Lighthouse : téléphone
    moyen et 4G lente simulés. C'est aussi ce que fait PageSpeed Insights.
  - En **bureau**, eco-audit ne simule rien : le score reflète votre processeur et votre
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
  de publicité, gestionnaire de mots de passe…). eco-audit lance Chrome avec un **profil
  temporaire vierge** : ni extensions, ni cache, ni cookies. C'est plus proche de PSI, mais
  peut s'écarter de ce que vous voyez dans DevTools.
- **La variabilité.** Deux passages successifs sur la même page donnent rarement le même score
  de performance : quelques points d'écart sont courants. Comparez des tendances, pas des
  unités.
- **Les versions.** Lighthouse 13 et votre version de Chrome peuvent différer de celles de PSI
  à un instant donné.
- **Données de terrain.** PSI affiche aussi, quand elles existent, les données réelles des
  visiteurs (Chrome UX Report). eco-audit ne produit que des mesures de laboratoire.

L'**éco-index** est une estimation calculée localement selon la méthodologie EcoIndex
(GreenIT / CNUMR), à partir du nombre d'éléments du DOM, du nombre de requêtes et du poids
transféré lors du passage bureau. Ce n'est **pas** un résultat officiel d'ecoindex.fr.

## Dépannage

### « Aucun navigateur trouvé »

Le serveur l'affiche au démarrage, et l'interface l'indique dans l'encart **État du service**
de la page d'accueil.

- Installez [Google Chrome](https://www.google.com/chrome/), puis relancez `npm run dev`.
- Chrome est installé à un emplacement inhabituel (version portable, Chrome Beta, Chromium) :
  indiquez son chemin au lancement (PowerShell) :
  ```powershell
  $env:CHROME_PATH = "D:\Apps\Chrome\chrome.exe"; npm run dev
  ```

### Port déjà utilisé

Dans les deux cas, les deux programmes s'arrêtent aussitôt, avec un message dans le terminal :

- `[serveur] … Le port 4322 est déjà utilisé` : un autre programme occupe le port du serveur,
  souvent une instance d'eco-audit restée ouverte dans un autre terminal. Fermez-la.
- `[web] Port 4321 is already in use` : même chose pour l'interface.

- `[web] Another astro dev server is already running` : eco-audit tourne déjà dans un autre
  terminal (Astro n'accepte qu'une interface à la fois par projet). Utilisez celle-là, ou
  fermez-la avec Ctrl+C avant de relancer `npm run dev`.

Pour trouver le programme qui occupe un port (PowerShell) :

```powershell
Get-NetTCPConnection -LocalPort 4322 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
```

### Un audit reste bloqué ou échoue

- Chaque passage Lighthouse est limité à 3 minutes. Au-delà, Chrome est arrêté, la page est
  marquée en erreur et l'audit continue avec la page suivante.
- Le bouton **Arrêter le scan** interrompt l'audit immédiatement.
- Une page protégée (connexion obligatoire, pare-feu applicatif, anti-bot) peut échouer ou
  être mesurée sur sa page d'erreur : le message d'erreur s'affiche dans le détail par page.
- « Serveur injoignable » dans l'interface : le serveur d'audit s'est arrêté. Regardez les
  lignes `[serveur]` du terminal, puis relancez `npm run dev`.

### Des processus Chrome restent ouverts

Ils ne devraient pas : Chrome est fermé à la fin de chaque audit, à l'arrêt demandé, au
dépassement du délai et au Ctrl+C. Si le terminal a été fermé brutalement, vous pouvez
vérifier (PowerShell) :

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object CommandLine -like '*puppeteer_dev_chrome_profile*'
```

Ces processus utilisent un profil temporaire et peuvent être arrêtés sans risque pour votre
Chrome habituel. Un audit interrompu par un arrêt brutal est marqué comme arrêté au démarrage
suivant.

## Organisation du dépôt

```
web/       interface Astro 7 + Tailwind CSS 4 + daisyUI 5 (lancée par « astro dev »)
server/    serveur Fastify 5 : routes JSON, découverte des pages, audits Lighthouse 13
  src/lib/audit.js      passages Lighthouse bureau + mobile, arrêt forcé de Chrome
  src/lib/chrome.js     détection de Chrome / Edge
  src/lib/discover.js   sitemap, robots.txt, crawl des liens internes
  src/lib/ecoindex.js   calcul de l'éco-index
  src/lib/store.js      enregistrement des audits dans data/
  src/lib/taches.js     découverte et audit en tâche de fond, un audit à la fois
data/      audits enregistrés (créé au premier lancement, ignoré par git)
```

`astro dev` relaie les appels `/api/*` de l'interface vers le serveur d'audit : le
navigateur ne parle qu'à `localhost:4321`.

Sous macOS ou Linux, l'outil n'a pas été testé : la détection automatique ne cherche que les
emplacements Windows, mais `CHROME_PATH` permet d'indiquer le navigateur.

## Bon usage

Un audit charge chaque page plusieurs fois et lit le plan du site : auditez de préférence les
sites que vous gérez, ou pour lesquels vous avez une autorisation. Le robot s'annonce avec
l'agent `eco-audit/1.0`.

## Licence

[MIT](LICENSE) © 2026 Pierre Mouilleseaux Lhuillier.

Lighthouse est un projet Google publié sous licence Apache 2.0. La méthodologie EcoIndex est
publiée par GreenIT.fr / CNUMR.
