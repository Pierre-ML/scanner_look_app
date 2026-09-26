// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Même fichier `.env` que le serveur d'audit (à la racine du dépôt), pour que les deux process
// s'accordent sur le port.

/** Port du serveur d'audit local (server/), vers lequel `/api` est relayé. */
const PORT_SERVEUR = 4322;

/** Port de l'interface. */
const PORT_WEB = 4321;

// Outil LOCAL : l'interface tourne avec `astro dev` (lancé par `npm run dev` à la racine), sur
// http://localhost:4321.
export default defineConfig({
  output: 'static',

  server: {
    port: PORT_WEB,
    host: 'localhost',
  },

  // La barre d'outils de développement d'Astro s'afficherait par-dessus l'interface : ici, `astro
  // dev` est le mode d'utilisation normal, pas un mode de mise au point.
  devToolbar: { enabled: false },

  vite: {
    plugins: [tailwindcss()],

    /* Relais `/api` → serveur d'audit local. */
    server: {
      /* Port pris : échec net plutôt que glissement vers le port suivant. */
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
