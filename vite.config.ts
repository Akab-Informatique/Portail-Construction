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
      const dist = path.resolve(__dirname, "dist");
      fs.rmSync(path.join(dist, "devs-inspect.js"), { force: true });
      // The dev-only in-browser database is not used in production; drop its
      // WASM/data files when no production chunk references them.
      const assets = path.join(dist, "assets");
      if (!fs.existsSync(assets)) return;
      const files = fs.readdirSync(assets);
      const js = files.filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(assets, f), "utf8"));
      for (const f of files) {
        if (/^postgres-.*\.(wasm|data)$/.test(f) && !js.some((code) => code.includes(f))) {
          fs.rmSync(path.join(assets, f));
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
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
    // `npm run dev:local` (mode "workstation") uses Vite's normal HMR on this machine.
    hmr: mode === "workstation" ? undefined : { clientPort: 443, protocol: "wss" },
  },
}));
