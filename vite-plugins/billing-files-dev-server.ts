import { loadEnv, type Plugin } from "vite";
import handler from "../api/billing-files";

/**
 * Local development only: the in-browser database has no server side, so this just serves the
 * stateless AI analysis (it needs GEMINI_API_KEY or ANTHROPIC_API_KEY in .env). Everything else answers { local: true }.
 */
export function billingFilesDevServer(): Plugin {
  return {
    name: "billing-files-dev-server",
    config(_, { mode }) {
      // Vite only exposes VITE_* variables; the AI settings are server-side, so copy them from .env into this process.
      const env = loadEnv(mode, process.cwd(), "");
      for (const [key, value] of Object.entries(env)) {
        if (/^(AI_|GEMINI_|GOOGLE_API_KEY|ANTHROPIC_)/.test(key) && process.env[key] === undefined) process.env[key] = value;
      }
    },
    configureServer(server) {
      server.middlewares.use("/api/billing-files", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: Record<string, unknown> = {};
        if (chunks.length) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>;
          } catch {
            body = {};
          }
        }
        const query: Record<string, string> = {};
        new URL(req.url || "", "http://local").searchParams.forEach((v, k) => {
          query[k] = v;
        });
        const fakeRes = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          setHeader(k: string, v: string) {
            res.setHeader(k, v);
          },
          json(payload: unknown) {
            res.writeHead(this.statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
          },
          end(payload?: Buffer | string) {
            res.writeHead(this.statusCode);
            res.end(payload);
          },
        };
        await handler({ method: req.method, body, query, headers: { cookie: req.headers.cookie || "" } }, fakeRes);
      });
    },
  };
}
