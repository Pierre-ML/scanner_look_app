# eco-audit — consignes pour les agents

Outil **local** d'audit (Lighthouse bureau + mobile, estimation EcoIndex). Monorepo npm :

- `web/` — interface Astro 7 + Tailwind 4 + daisyUI 5, servie par `astro dev` (port 4321).
  Le design est figé : ne pas le refaire, ne pas relancer de scaffolding (`npm create astro`).
- `server/` — serveur Fastify 5 (127.0.0.1, port 4322) : routes JSON + tâches d'audit
  (Lighthouse 13 via `puppeteer-core` et le Chrome installé sur la machine).
- `data/audits/` — un fichier JSON par audit (ignoré par git).

## Lancer

```
npm install
npm run dev
```

`npm run dev` lance le serveur et l'interface ensemble (concurrently). Ctrl+C arrête les deux
et ferme Chrome proprement. `astro dev` relaie `/api` vers le serveur (`vite.server.proxy`
dans `web/astro.config.mjs`).

## Règles

- Styles : **uniquement Tailwind** (utilitaires et composants daisyUI) dans le balisage. Aucune
  classe CSS maison, aucun bloc `<style>`, aucun `style="…"` sauf une valeur dynamique exigée
  par un composant (ex. `--value` de `radial-progress`). `web/src/styles/global.css` ne contient
  que la configuration Tailwind : `@import`, `@plugin` daisyUI, `@theme` (jetons, animations et
  leurs `@keyframes`) et `@font-face`. Un retard d'animation se pose avec `[--retard:…]`.
- Ne pas mettre à jour les dépendances (`@latest`) sans demande explicite.
- Code et commentaires en français, dans le style existant.
- Commentaires : l'essentiel seulement, une ligne en général, trois au maximum.
- Outil 100 % local : aucun `.env` ni fichier d'exemple ; valeurs fixes dans le code
  (seule exception : `CHROME_PATH`, pour un Chrome installé à un endroit inhabituel).
- Un seul audit à la fois ; ne pas réintroduire de worker permanent, de file de jobs ni de CORS.
  Les pages d'UN audit peuvent être mesurées en parallèle par une équipe de processus
  (`server/src/lib/processus-audit.js`, lancée et arrêtée par `taches.js`) : c'est le seul
  multi-processus autorisé, et chaque processus doit fermer son Chrome.
- Après une modification du serveur, relancer `npm run dev` : Node ne recharge pas le code
  (l'accueil affiche « À relancer » tant que ce n'est pas fait).
- Tester un changement du serveur avec un audit réel, puis vérifier qu'aucun Chrome ne reste :
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? CommandLine -like '*puppeteer_dev_chrome_profile*'`

## Documentation

- Astro : https://docs.astro.build
- Fastify : https://fastify.dev/docs/latest/
- Lighthouse : https://github.com/GoogleChrome/lighthouse/tree/main/docs
