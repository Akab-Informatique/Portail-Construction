import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
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

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".wasm", ".map"]);
/** Compressed copies of static files, keyed by path + encoding. Files are immutable per build. */
const compressedCache = new Map();

function pickEncoding(req) {
  const accept = String(req.headers["accept-encoding"] || "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

async function compressedFile(file, encoding) {
  const key = `${encoding}:${file}`;
  let buf = compressedCache.get(key);
  if (!buf) {
    const raw = await readFile(file);
    buf =
      encoding === "br"
        ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } })
        : gzipSync(raw, { level: 9 });
    compressedCache.set(key, buf);
  }
  return buf;
}

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
    // index.html names the current build's assets; always revalidate it.
    else if (extname(file) === ".html") res.setHeader("Cache-Control", "no-cache");
    const encoding = COMPRESSIBLE.has(extname(file)) && info.size > 1024 ? pickEncoding(req) : null;
    res.setHeader("Vary", "Accept-Encoding");
    if (encoding) {
      res.setHeader("Content-Encoding", encoding);
      res.end(await compressedFile(file, encoding));
      return;
    }
    createReadStream(file).pipe(res);
  } catch {
    const index = await readFile(join(dist, "index.html"));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Always revalidate so a new deploy's asset names are picked up immediately.
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
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // Only scripts from this origin may run, and the page may only talk to this origin.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  if (process.env.COOKIE_INSECURE !== "1" && process.env.COOKIE_INSECURE !== "true") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  if (url.pathname.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    // Cross-site forms can't send application/json, so requiring it blocks CSRF-style posts.
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      const type = String(req.headers["content-type"] || "");
      if (!type.toLowerCase().startsWith("application/json")) {
        res.statusCode = 415;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Expected application/json" }));
        return;
      }
    }
    // Behind the reverse proxy the client address arrives in X-Real-IP / X-Forwarded-For.
    const forwarded = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const headers = { cookie: req.headers.cookie || "", "x-client-ip": forwarded || req.socket.remoteAddress || "" };
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
