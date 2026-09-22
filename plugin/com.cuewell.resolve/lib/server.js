"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

const ROOT = path.join(__dirname, "..");
const FILES = {
  "/": { file: path.join(ROOT, "ui", "index.html"), type: "text/html; charset=utf-8" },
  "/styles.css": { file: path.join(ROOT, "ui", "styles.css"), type: "text/css; charset=utf-8" },
  "/app.js": { file: path.join(ROOT, "ui", "app.js"), type: "text/javascript; charset=utf-8" },
  "/catalog.js": { file: path.join(ROOT, "lib", "catalog.js"), type: "text/javascript; charset=utf-8" },
};

function startServer(engine, { port = 47321, host } = {}) {
  const clients = new Set();
  let server;
  let currentHost = host || (engine.getState().lan ? "0.0.0.0" : "127.0.0.1");
  let currentPort = port;

  const requestHandler = (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && FILES[url.pathname]) {
      serveStatic(res, FILES[url.pathname]);
      return;
    }
    if (!authorized(req, url, engine.token)) {
      send(res, 401, { error: "Missing or wrong token." });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      engine.handle("state").then((result) => send(res, result.ok ? 200 : 400, present(engine, result, info())));
      return;
    }
    if (req.method === "GET" && url.pathname === "/licenses.csv") {
      engine.handle("licensesCsv").then((result) => {
        res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=cuewell-licenses.csv" });
        res.end(result.csv || "");
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      serveMedia(engine, decodeURIComponent(url.pathname.slice("/media/".length)), req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/call") {
      readBody(req).then(async (body) => {
        let parsed = {};
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          send(res, 400, { ok: false, error: "Invalid JSON." });
          return;
        }
        const result = await engine.handle(parsed.name, parsed.payload || {});
        if (result.result && result.result.restart) {
          setTimeout(() => restart().catch(() => {}), 50);
        }
        send(res, result.ok ? 200 : 400, present(engine, result, info()));
      }).catch((error) => send(res, 500, { ok: false, error: error.message }));
      return;
    }
    send(res, 404, { error: "Not found." });
  };

  function info() {
    const lan = engine.getState().lan;
    const portNumber = currentPort;
    const localUrl = `http://127.0.0.1:${portNumber}/?token=${engine.token}`;
    const network = lan ? lanAddresses().map((address) => `http://${address}:${portNumber}/?token=${engine.token}`) : [];
    return { port: portNumber, lan, localUrl, networkUrls: network, host: currentHost };
  }

  function restart() {
    const nextHost = engine.getState().lan ? "0.0.0.0" : "127.0.0.1";
    if (nextHost === currentHost) {
      broadcast();
      return Promise.resolve(info());
    }
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        currentHost = nextHost;
        server = http.createServer(requestHandler);
        server.listen(currentPort, currentHost, () => {
          broadcast();
          resolve(info());
        });
      });
    });
  }

  engine.onChange(() => broadcast());

  function broadcast() {
    const payload = `data: ${JSON.stringify({ revision: engine.getState().revision })}\n\n`;
    for (const client of clients) client.write(payload);
  }

  return new Promise((resolve, reject) => {
    const boot = (hostName, portNumber, allowFallback) => {
      const instance = http.createServer(requestHandler);
      instance.once("error", (error) => {
        if (allowFallback && error.code === "EADDRINUSE") {
          boot(hostName, 0, false);
          return;
        }
        reject(error);
      });
      instance.listen(portNumber, hostName, () => {
        server = instance;
        currentHost = hostName;
        currentPort = instance.address().port;
        resolve({
          info,
          close() {
            return new Promise((done) => server.close(() => done()));
          },
        });
      });
    };
    boot(currentHost, port, true);
  });
}

function authorized(req, url, token) {
  const header = req.headers["x-cuewell-token"];
  const query = url.searchParams.get("token");
  return timingSafe(header || query || "", token);
}

function timingSafe(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return require("crypto").timingSafeEqual(a, b);
}

function present(engine, result, connection) {
  if (!result.state) return result;
  return { ...result, state: { ...result.state, connection } };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function serveStatic(res, item) {
  const body = fs.readFileSync(item.file);
  res.writeHead(200, { "content-type": item.type, "content-length": body.length, "cache-control": "no-cache" });
  res.end(body);
}

function serveMedia(engine, id, req, res) {
  const track = engine.track(id);
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  const stemType = requestUrl.searchParams.get("stem");
  const stem = stemType && track && (track.stems || []).find((item) => item.type === stemType);
  if (stem && stem.url) {
    proxyRemote(stem.url, req, res);
    return;
  }
  if (track && track.remoteUrl && !(track.path && fs.existsSync(track.path))) {
    proxyRemote(track.remoteUrl, req, res);
    return;
  }
  if (!track || !track.path || !fs.existsSync(track.path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const stat = fs.statSync(track.path);
  const type = mediaType(track.path);
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.writeHead(416);
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start > end || end >= stat.size) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    });
    fs.createReadStream(track.path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": stat.size, "accept-ranges": "bytes" });
  fs.createReadStream(track.path).pipe(res);
}

function proxyRemote(url, req, res) {
  const headers = { "user-agent": "Cuewell/1.0" };
  if (req.headers.range) headers.range = req.headers.range;
  fetch(url, { headers }).then((upstream) => {
    const responseHeaders = {
      "content-type": upstream.headers.get("content-type") || "audio/mpeg",
      "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
    };
    const length = upstream.headers.get("content-length");
    const range = upstream.headers.get("content-range");
    if (length) responseHeaders["content-length"] = length;
    if (range) responseHeaders["content-range"] = range;
    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  }).catch((error) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(error.message);
  });
}

function mediaType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a" || ext === ".aac") return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".aif" || ext === ".aiff") return "audio/aiff";
  return "audio/wav";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

module.exports = { startServer };
