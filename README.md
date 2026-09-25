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
2. **Sélection.** Cochez jusqu'à 8 pages, ou ajoutez-en à la main (même site uniquement).
3. **Rapport.** Chaque page passe deux fois dans Lighthouse (bureau, puis mobile), soit environ
   25 secondes par page. Les résultats s'affichent au fur et à mesure. Le bouton
   **Arrêter le scan** interrompt l'audit immédiatement, en gardant les pages terminées.

Un seul audit tourne à la fois : un audit utilise tout Chrome, et deux audits simultanés
fausseraient leurs mesures.

### Vos audits

- Chaque audit est enregistré dans `data/audits/<numéro>.json`, à la racine du dépôt (dossier
  ignoré par git). Rien n'est supprimé automatiquement.
- La page **Mes audits** les liste tous et permet d'en supprimer.
- Le bouton **Exporter le rapport (JSON)**, en bas de chaque rapport, télécharge le rapport
  complet : scores par page, moyennes, éco-index, durées.

## Réglages (facultatif)

Tout fonctionne sans configuration. Pour changer un réglage, copiez `.env.example` en `.env`
(à la racine du dépôt), modifiez la valeur, puis relancez `npm run dev`.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `4322` | Port du serveur d'audit. |
| `WEB_PORT` | `4321` | Port de l'interface (l'adresse à ouvrir devient `http://localhost:<WEB_PORT>`). |
| `CHROME_PATH` | détection automatique | Chemin complet de `chrome.exe` (ou d'un autre Chromium) à utiliser. |
| `ECO_AUDIT_RUN_TIMEOUT` | `180000` | Durée maximale d'un passage Lighthouse, en millisecondes. Au-delà, Chrome est arrêté et la page est marquée en erreur. |
| `ECO_AUDIT_DESKTOP_THROTTLING` | `provided` | `provided` : aucune simulation en bureau, on mesure votre machine telle quelle. `simulate` : réglage bureau officiel de Lighthouse, celui de PageSpeed Insights. |
| `ECO_AUDIT_DISABLE_GPU` | `0` | `1` désactive l'accélération graphique de Chrome (voir « Un audit reste bloqué »). |

La détection automatique cherche Chrome dans `%ProgramFiles%`, `%ProgramFiles(x86)%` puis
`%LOCALAPPDATA%`, et se rabat sur Microsoft Edge.

## Pourquoi mes scores diffèrent de PageSpeed Insights ou de DevTools

C'est normal, et c'est en partie le but : Lighthouse est une mesure **de laboratoire**, qui
dépend de la machine, du réseau et des réglages. Les principales sources d'écart :

- **Le throttling (ralentissement simulé).**
  - En **mobile**, eco-audit utilise la configuration par défaut de Lighthouse : téléphone
    moyen et 4G lente simulés. C'est aussi ce que fait PageSpeed Insights.
  - En **bureau**, eco-audit ne simule rien par défaut (`provided`) : le score reflète votre
    processeur et votre connexion. PageSpeed Insights simule une connexion et un processeur de
    bureau « moyens ». Sur une machine rapide avec une bonne connexion, attendez-vous à des
    scores de performance bureau **plus élevés** que sur PSI. Pour vous en rapprocher, passez
    `ECO_AUDIT_DESKTOP_THROTTLING=simulate`.
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
  indiquez son chemin dans `.env` :
  ```
  CHROME_PATH=D:\Apps\Chrome\chrome.exe
  ```

### Port déjà utilisé

Dans les deux cas, les deux programmes s'arrêtent aussitôt, avec un message dans le terminal :

- `[serveur] … Le port 4322 est déjà utilisé` : un autre programme occupe le port du serveur
  (souvent une instance d'eco-audit restée ouverte dans un autre terminal). Fermez-la, ou
  choisissez un autre port avec `PORT=4330` dans `.env`.
- `[web] Port 4321 is already in use` : même chose pour l'interface. Fermez le programme
  concerné, ou choisissez un autre port avec `WEB_PORT=4400` dans `.env`, puis ouvrez
  `http://localhost:4400`.

Pour trouver le programme qui occupe un port (PowerShell) :

```powershell
Get-NetTCPConnection -LocalPort 4322 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
```

### Un audit reste bloqué ou échoue

- Chaque passage Lighthouse est limité à 3 minutes (`ECO_AUDIT_RUN_TIMEOUT`). Au-delà, Chrome
  est arrêté, la page est marquée en erreur et l'audit continue avec la page suivante.
- Le bouton **Arrêter le scan** interrompt l'audit immédiatement.
- Si Chrome se bloque régulièrement (pilote graphique instable, machine virtuelle sans GPU),
  essayez `ECO_AUDIT_DISABLE_GPU=1` dans `.env`.
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
