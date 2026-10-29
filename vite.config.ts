import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/ai-marks-cleaner/",
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: { input: { main: "index.html", about: "about.html" } },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "AI Marks Cleaner",
        short_name: "Marks Cleaner",
        description: "Removes AI provenance marks from text and Office files, in your browser.",
        start_url: "/ai-marks-cleaner/",
        scope: "/ai-marks-cleaner/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#b3261e",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,wasm,mjs,zip,json,py,png,svg,webmanifest}", "engine/LICENSE", "licenses/*"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/about\.html$/],
      },
    }),
  ],
});
