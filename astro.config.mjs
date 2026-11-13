// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Build bureau (Tauri) : toutes les dépendances serveur sont embarquées dans dist/server,
// pour ne pas dépendre de node_modules à l'exécution.
const desktop = process.env.LUCAAUDIT_DESKTOP === '1';

// Le logiciel sert l'interface avec le serveur Astro autonome (127.0.0.1:4321, lancé par le node
// embarqué) ; en dev, `astro dev` écoute sur http://localhost:4321. L'API d'audit (127.0.0.1:4322)
// est relayée par la route src/pages/api/[...chemin].js.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  server: {
    port: 4321,
    host: 'localhost',
  },

  // La barre d'outils de développement d'Astro s'afficherait par-dessus l'interface.
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],

    server: {
      /* Port pris : échec net plutôt que glissement vers le port suivant. */
      strictPort: true,
      // Tauri compile dans src-tauri/target : ne pas le surveiller (EBUSY).
      watch: { ignored: ['**/src-tauri/**'] },
    },

    ...(desktop ? { ssr: { noExternal: true } } : {}),
  },
});
