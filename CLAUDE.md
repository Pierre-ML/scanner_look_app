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

- Ne pas mettre à jour les dépendances (`@latest`) sans demande explicite.
- Code et commentaires en français, dans le style existant.
- Un seul audit à la fois ; ne pas réintroduire de worker séparé, de file de jobs ni de CORS.
- Tester un changement du serveur avec un audit réel, puis vérifier qu'aucun Chrome ne reste :
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? CommandLine -like '*puppeteer_dev_chrome_profile*'`

## Documentation

- Astro : https://docs.astro.build
- Fastify : https://fastify.dev/docs/latest/
- Lighthouse : https://github.com/GoogleChrome/lighthouse/tree/main/docs
