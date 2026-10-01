import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharepointHandler from "./api/sharepoint.ts";
import mailHandler from "./api/mail/send.ts";
import dbHandler from "./api/db.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function adaptRes(res) {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      res.setHeader(k, v);
    },
    json(body) {
      res.statusCode = this.statusCode;
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    },
    end(body) {
      res.statusCode = this.statusCode;
      res.end(body);
    },
  };
}

// Uploads are capped at 4 MB of file data (base64 ~5.4 MB) plus JSON overhead.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

class BodyTooLarge extends Error {}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return {};
  }
}

function queryOf(url) {
  const q = {};
  url.searchParams.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = normalize(join(dist, rel));
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error("dir");
    res.setHeader("Content-Type", MIME[extname(file)] || "application/octet-stream");
    // Vite emits content-hashed file names under /assets.
    if (rel.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(file).pipe(res);
  } catch {
    const index = await readFile(join(dist, "index.html"));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(index);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  if (url.pathname.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    const headers = { cookie: req.headers.cookie || "" };
    if (url.pathname === "/api/sharepoint") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await sharepointHandler({ method: req.method, query: queryOf(url), body, headers }, adaptRes(res));
      return;
    }
    if (url.pathname === "/api/mail/send") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await mailHandler({ method: req.method, body, headers }, adaptRes(res));
      return;
    }
    if (url.pathname === "/api/db/ping" || (url.pathname === "/api/db" && req.method === "GET")) {
      await dbHandler({ method: "POST", body: { action: "ping" }, headers }, adaptRes(res));
      return;
    }
    if (url.pathname === "/api/db") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await dbHandler({ method: req.method, body, headers }, adaptRes(res));
      return;
    }
    if (url.pathname === "/api/change-password") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await dbHandler(
        { method: "POST", body: { ...body, action: "change_password" }, headers, query: { action: "change_password" } },
        adaptRes(res),
      );
      return;
    }
    if (url.pathname === "/api/complete-tutorial") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await dbHandler(
        { method: "POST", body: { ...body, action: "complete_tutorial" }, headers, query: { action: "complete_tutorial" } },
        adaptRes(res),
      );
      return;
    }
    if (url.pathname === "/api/set-tutorial") {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      await dbHandler(
        { method: "POST", body: { ...body, action: "set_tutorial" }, headers, query: { action: "set_tutorial" } },
        adaptRes(res),
      );
      return;
    }
    if (url.pathname === "/healthz") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    if (err instanceof BodyTooLarge) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: "Request too large" }));
      req.destroy();
      return;
    }
    res.statusCode = 500;
    console.error(err);
    res.end(JSON.stringify({ error: "Server error" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`FRX portal listening on ${port}`);
});
