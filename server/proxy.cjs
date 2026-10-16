const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const cacheDir =
  process.env.NEWSVIEW_CACHE_DIR ||
  path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "newsview",
  );
process.env.FEED_CACHE_DIR ||= path.join(cacheDir, "feeds");
process.env.FEED_CONCURRENCY ||= "4";
const { registerRoutes, RSS_FEEDS } = require("./data-feeds.cjs");
const { jsonResponses } = require("./json-response.cjs");
const { ImageCache } = require("./images.cjs");
const { fetchPublic } = require("./public-fetch.cjs");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  const configPath =
    process.env.NEWSVIEW_CONFIG ||
    path.join(__dirname, "../config/default.json");
  const settings = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const images = new ImageCache(path.join(cacheDir, "images"));
  images.ready.catch((error) => console.error("[images]", error.message));
  app.use((req, res, next) => {
    if (
      req.get("origin") &&
      req.get("origin") !== `http://${req.get("host")}` &&
      req.get("origin") !== `https://${req.get("host")}`
    ) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https://basemap.nationalmap.gov; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(jsonResponses);
  app.get("/health", (_req, res) =>
    res.json({ app: "newsview", status: "ok", version: "0.1.0" }),
  );
  app.get("/api/config", (_req, res) => res.json(settings));
  app.get("/api/sources", (_req, res) =>
    res.json({
      ...Object.fromEntries(
        Object.entries(RSS_FEEDS).map(([key, feeds]) => [
          key,
          feeds.map((x) => x.name),
        ]),
      ),
      social: [
        "Hacker News",
        "Bluesky Discover",
        "Mastodon Trending",
        "c/news",
        "c/world",
        "c/technology",
        "c/politics",
        "c/science",
        "/news/",
        "/pol/",
        "/lit/",
        "/his/",
        "/g/",
      ],
    }),
  );
  app.get("/api/image", async (req, res) => {
    const article = req.query.article;
    const image = req.query.image || "";
    if (
      typeof article !== "string" ||
      typeof image !== "string" ||
      article.length > 4096 ||
      image.length > 4096
    )
      return res.status(400).end();
    try {
      const body = await images.get(article, image);
      res.set("Cache-Control", "private, max-age=86400");
      res.set("ETag", `"${createHash("sha256").update(body).digest("hex")}"`);
      if (req.fresh) return res.status(304).end();
      res.type("webp").send(body);
    } catch {
      res.set("Cache-Control", "private, max-age=600").status(404).end();
    }
  });
  app.get("/api/radar/tile", async (req, res) => {
    try {
      const url = new URL(String(req.query.url));
      if (
        url.origin !== "https://tilecache.rainviewer.com" ||
        url.username ||
        url.password ||
        !/^\/v2\/radar\/[\w/._-]+\.png$/.test(url.pathname)
      )
        return res.status(403).end();
      const tile = await fetchPublic(url.href, {
        maxBytes: 1024 * 1024,
        accept: "image/png",
      });
      if (tile.type !== "image/png") return res.status(502).end();
      res
        .set("Cache-Control", "public, max-age=1800")
        .type("png")
        .send(tile.body);
    } catch {
      res.status(502).end();
    }
  });
  registerRoutes(app);
  const dist = path.join(__dirname, "../dist");
  app.use((req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method) || !req.acceptsEncodings("gzip"))
      return next();
    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = path.resolve(
      dist,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !file.startsWith(dist + path.sep) ||
      !/\.(?:html|js|css|svg)$/.test(file) ||
      !fs.existsSync(file + ".gz")
    )
      return next();
    res.set("Content-Encoding", "gzip").vary("Accept-Encoding");
    res.set(
      "Cache-Control",
      pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    res.type(path.extname(file)).sendFile(file + ".gz");
  });
  app.use(
    express.static(dist, {
      setHeaders(res, file) {
        res.set(
          "Cache-Control",
          file.includes(`${path.sep}assets${path.sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    }),
  );
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || "127.0.0.1";
  const server = createApp().listen(port, host, () =>
    console.log(`Newsview: http://${host}:${port}`),
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  const stop = () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
module.exports = { createApp };
