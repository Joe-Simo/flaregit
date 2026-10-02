import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // The UI dev server talks to a real FlareGit Worker: `wrangler dev` (default) or your deployment via FLAREGIT_API.
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/auth-config", "/status.json", "/webhooks"].map((p) => [p, { target: process.env.FLAREGIT_API ?? "http://127.0.0.1:8787", changeOrigin: true }])
    ),
  },
});
