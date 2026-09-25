// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

/*
 * Même fichier `.env` que le serveur d'audit (à la racine du dépôt), pour que les deux
 * process s'accordent sur le port. Absent : tout garde sa valeur par défaut. Une variable
 * déjà définie dans l'environnement n'est pas écrasée.
 */
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // pas de .env : réglages par défaut
}

/** Port du serveur d'audit local (server/), vers lequel `/api` est relayé. */
const PORT_SERVEUR = Number(process.env.PORT || 4322);

/** Port de l'interface. */
const PORT_WEB = Number(process.env.WEB_PORT || 4321);

/**
 * Outil LOCAL : l'interface tourne avec `astro dev` (lancé par `npm run dev` à la racine),
 * sur http://localhost:4321. Pas d'adapter ni de build de production : rien n'est hébergé.
 *
 * Les pages de job (`/rapport/[jobId]`, `/decouverte/[jobId]`) et `/mes-audits` restent
 * marquées `prerender = false` : en mode dev, elles sont rendues à chaque requête et
 * interrogent directement le serveur d'audit depuis leur frontmatter.
 */
export default defineConfig({
  output: 'static',

  server: {
    port: PORT_WEB,
    host: 'localhost',
  },

  /*
   * La barre d'outils de développement d'Astro s'afficherait par-dessus l'interface :
   * ici, `astro dev` est le mode d'utilisation normal, pas un mode de mise au point.
   */
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],

    /*
     * Relais `/api` → serveur d'audit local. Le navigateur ne parle qu'à l'origine de
     * l'interface : aucun CORS à configurer, aucune adresse de serveur dans les pages.
     */
    server: {
      /*
       * Port pris : échec net plutôt que glissement vers le port suivant. Le suivant est
       * justement celui du serveur d'audit (4322), et l'interface s'y retrouverait en IPv6,
       * à côté de lui — une adresse différente de celle annoncée, source de confusion.
       */
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${PORT_SERVEUR}`,
          changeOrigin: false,
        },
      },
    },
  },
});
