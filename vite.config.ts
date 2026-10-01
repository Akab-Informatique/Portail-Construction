import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import { mailDevServer } from "./vite-plugins/mail-dev-server";
import { sharepointDevServer } from "./vite-plugins/sharepoint-dev-server";
import { dbDevServer } from "./vite-plugins/db-dev-server";

/**
 * devs-inspect.js is the page builder's preview inspector (DOM/screenshot
 * bridge to a parent frame). Keep it out of production builds.
 */
function stripPreviewInspector(): Plugin {
  return {
    name: "strip-preview-inspector",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/\s*<script src="\/devs-inspect\.js"><\/script>/, "");
    },
    closeBundle() {
      fs.rmSync(path.resolve(__dirname, "dist/devs-inspect.js"), { force: true });
    },
  };
}

export default defineConfig({
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  plugins: [react(), tailwindcss(), mailDevServer(), sharepointDevServer(), dbDevServer(), stripPreviewInspector()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // strictPort: a stale "npm run dev" leaves Vite drifting to 5174/5175 and the
    // saved app.url (which routes to the bare host = primary port) intermittently
    // 502s. Crash on conflict instead so the wake handler sees a real error.
    strictPort: true,
    // allowedHosts must be true: sandboxes are accessed via dynamic Vercel-assigned hostnames
    allowedHosts: true,
    // The preview iframe loads the app through the vercel.run edge proxy on
    // 443 (wss), not directly on 5173. Without this, Vite's HMR client opens
    // its WebSocket against :5173 (the dev-server port), which the proxy does
    // not expose — the socket drops, the client logs "server connection lost.
    // Polling for restart...", and forces a full page reload on reconnect, so
    // the preview appears to refresh even though nothing changed.
    hmr: { clientPort: 443, protocol: "wss" },
  },
});
