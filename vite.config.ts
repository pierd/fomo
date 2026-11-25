import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        id: "/",
        name: "FOMO",
        short_name: "FOMO",
        description: "Everything you want to read, watch and play, and a tournament to pick what's next.",
        display: "standalone",
        theme_color: "#7c3aed",
        background_color: "#f7f6f3",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        runtimeCaching: [
          {
            // Covers: a new image always gets a new URL. Fetched with CORS, as
            // opaque responses count for megabytes of quota each.
            urlPattern: /^https:\/\/[^/]+\.convex\.cloud\/api\/storage\//,
            handler: "CacheFirst",
            options: {
              cacheName: "covers",
              fetchOptions: { mode: "cors", credentials: "omit" },
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 2000, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
});
