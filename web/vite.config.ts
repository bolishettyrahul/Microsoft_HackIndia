import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor libraries in their own long-lived chunks, so app changes don't re-download them.
        // three.js is deliberately not grouped: it stays inside the hero's lazy chunk and loads only with the 3D scene.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\\/]/ },
            { name: "motion", test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
    // The lazy 3D hero chunk (three.js) is ~0.99 MB by itself; it never blocks the first paint.
    chunkSizeWarningLimit: 1000,
  },
});
