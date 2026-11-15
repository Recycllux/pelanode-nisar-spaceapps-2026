// Static build for GitHub Pages: `npm run build` writes index.html + assets/ into ../docs,
// next to the existing docs/data/, logo.png/logo.webp, og.jpg, favicon.png and licenses/ (never emptied, never copied).
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../docs", import.meta.url)),
    emptyOutDir: false,
    chunkSizeWarningLimit: 1500,
  },
});
