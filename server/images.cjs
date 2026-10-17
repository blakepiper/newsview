const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fetchPublic, parsePublicUrl } = require("./public-fetch.cjs");
const { extractMetadataImages } = require("./metadata.cjs");

// Judge detail after resizing, using the landscape photo area as the target.
function resolution(image) {
  return Math.min(image.info.width / 1000, image.info.height / 560);
}

class ImageCache {
  constructor(
    directory,
    {
      maxEntries = 120,
      maxBytes = 96 * 1024 * 1024,
      fetcher = fetchPublic,
    } = {},
  ) {
    this.directory = directory;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.fetcher = fetcher;
    this.entries = new Map();
    this.pending = new Map();
    this.failures = new Map();
    this.active = 0;
    this.queue = [];
    this.ready = this.restore();
  }
  async restore() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.webp$/.test(name)) continue;
      const stat = await fs.stat(path.join(this.directory, name));
      this.entries.set(name.slice(0, -5), {
        at: stat.mtimeMs,
        used: stat.mtimeMs,
        size: stat.size,
      });
    }
    await this.prune();
  }
  async prune() {
    let bytes = [...this.entries.values()].reduce((sum, x) => sum + x.size, 0);
    for (const [key, entry] of [...this.entries].sort(
      (a, b) => a[1].used - b[1].used,
    )) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
      this.entries.delete(key);
      bytes -= entry.size;
      await fs.rm(path.join(this.directory, `${key}.webp`), { force: true });
    }
  }
  async acquire() {
    if (this.active < 2) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
  async convert(url, timeoutMs = 12000) {
    const response = await this.fetcher(url, {
      maxBytes: 8 * 1024 * 1024,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
      timeoutMs,
    });
    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
      ].includes(response.type)
    )
      throw new Error("Unsupported image");
    const body = response.body;
    const signature = body.subarray(0, 16);
    const bitmap =
      signature
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (signature[0] === 255 && signature[1] === 216 && signature[2] === 255) ||
      /^GIF8[79]a/.test(signature.toString("ascii")) ||
      (signature.toString("ascii", 0, 4) === "RIFF" &&
        signature.toString("ascii", 8, 12) === "WEBP") ||
      (signature.toString("ascii", 4, 8) === "ftyp" &&
        /^(avif|avis)$/.test(signature.toString("ascii", 8, 12)));
    if (!bitmap) throw new Error("Unsupported bitmap signature");
    const sharp = require("sharp");
    sharp.concurrency(1);
    sharp.cache(false);
    return sharp(response.body, {
      limitInputPixels: 20_000_000,
      animated: false,
    })
      .rotate()
      .resize({
        width: 1200,
        height: 900,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 2 })
      .toBuffer({ resolveWithObject: true });
  }
  async load(article, image) {
    let best;
    if (image) {
      try {
        best = await this.convert(image);
        if (resolution(best) >= 1) return best.data;
      } catch {
        /* Try the publisher's metadata next. */
      }
    }
    // An optional upgrade gets six seconds total, including metadata and images.
    const deadline = Date.now() + (best ? 6000 : 12000);
    const attempted = new Set(image ? [image] : []);
    try {
      const page = await this.fetcher(article, {
        maxBytes: 1024 * 1024,
        accept: "text/html,application/xhtml+xml",
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      if (!["text/html", "application/xhtml+xml"].includes(page.type))
        throw new Error("Not an article");
      const candidates = extractMetadataImages(page.body.toString("utf8"), page.url);
      for (const candidate of candidates) {
        if (Date.now() >= deadline) break;
        if (attempted.has(candidate)) continue;
        attempted.add(candidate);
        try {
          const converted = await this.convert(candidate, Math.max(1, deadline - Date.now()));
          if (!best || resolution(converted) > resolution(best)) best = converted;
          if (resolution(best) >= 1) break;
        } catch {
          /* A broken alternative must not hide a usable photograph. */
        }
      }
    } catch (error) {
      if (!best) throw error;
    }
    if (!best) throw new Error("No article image");
    return best.data;
  }
  async get(article, image = "") {
    parsePublicUrl(article);
    if (image) parsePublicUrl(image);
    await this.ready;
    const key = createHash("sha256")
      .update(JSON.stringify([2, article, image]))
      .digest("hex");
    const file = path.join(this.directory, `${key}.webp`);
    // Refresh old thumbnail selections lazily, retaining them during outages.
    const legacyKey = createHash("sha256")
      .update(JSON.stringify([article, image]))
      .digest("hex");
    const cachedKey = this.entries.has(key) ? key : legacyKey;
    const cached = this.entries.get(cachedKey);
    const cachedFile = path.join(this.directory, `${cachedKey}.webp`);
    if (cached && cachedKey === key && Date.now() - cached.at < 86400000) {
      cached.used = Date.now();
      try {
        return await fs.readFile(file);
      } catch {
        this.entries.delete(key);
      }
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (Date.now() - (this.failures.get(key) || 0) < 600000) {
      if (cached) return fs.readFile(cachedFile);
      throw new Error("No image available");
    }
    if (this.pending.size >= 10) throw new Error("Image queue busy");
    const task = (async () => {
      await this.acquire();
      try {
        let body = await this.load(article, image);
        if (cached) {
          try {
            const previous = await fs.readFile(cachedFile);
            const sharp = require("sharp");
            const currentInfo = await sharp(body).metadata();
            const previousInfo = await sharp(previous).metadata();
            if (resolution({ info: previousInfo }) > resolution({ info: currentInfo }))
              body = previous;
          } catch {
            /* A missing or corrupt old cache must not prevent a fresh image. */
          }
        }
        if (body.length > this.maxBytes)
          throw new Error("Image exceeds cache budget");
        await fs.writeFile(`${file}.tmp`, body, { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
        this.entries.set(key, {
          at: Date.now(),
          used: Date.now(),
          size: body.length,
        });
        if (cachedKey === legacyKey && cached) {
          this.entries.delete(legacyKey);
          await fs.rm(cachedFile, { force: true });
        }
        await this.prune();
        return body;
      } catch (error) {
        this.failures.delete(key);
        this.failures.set(key, Date.now());
        while (this.failures.size > 128)
          this.failures.delete(this.failures.keys().next().value);
        if (cached) {
          try {
            return await fs.readFile(cachedFile);
          } catch {
            /* Cache evicted. */
          }
        }
        throw error;
      } finally {
        this.release();
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, task);
    return task;
  }
}

module.exports = { ImageCache };
