const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fetchPublic, parsePublicUrl } = require("./public-fetch.cjs");
const { extractMetadata } = require("./metadata.cjs");

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
  async convert(url) {
    const response = await this.fetcher(url, {
      maxBytes: 8 * 1024 * 1024,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
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
      .toBuffer();
  }
  async load(article, image) {
    if (image) {
      try {
        return await this.convert(image);
      } catch {
        /* Try the publisher's metadata next. */
      }
    }
    const page = await this.fetcher(article, {
      maxBytes: 1024 * 1024,
      accept: "text/html,application/xhtml+xml",
    });
    if (!["text/html", "application/xhtml+xml"].includes(page.type))
      throw new Error("Not an article");
    const candidate = extractMetadata(page.body.toString("utf8"), page.url);
    if (!candidate || candidate === image) throw new Error("No article image");
    return this.convert(candidate);
  }
  async get(article, image = "") {
    parsePublicUrl(article);
    if (image) parsePublicUrl(image);
    await this.ready;
    const key = createHash("sha256")
      .update(JSON.stringify([article, image]))
      .digest("hex");
    const file = path.join(this.directory, `${key}.webp`);
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.at < 86400000) {
      cached.used = Date.now();
      try {
        return await fs.readFile(file);
      } catch {
        this.entries.delete(key);
      }
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (Date.now() - (this.failures.get(key) || 0) < 600000) {
      if (cached) return fs.readFile(file);
      throw new Error("No image available");
    }
    if (this.pending.size >= 10) throw new Error("Image queue busy");
    const task = (async () => {
      await this.acquire();
      try {
        const body = await this.load(article, image);
        if (body.length > this.maxBytes)
          throw new Error("Image exceeds cache budget");
        await fs.writeFile(`${file}.tmp`, body, { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
        this.entries.set(key, {
          at: Date.now(),
          used: Date.now(),
          size: body.length,
        });
        await this.prune();
        return body;
      } catch (error) {
        this.failures.delete(key);
        this.failures.set(key, Date.now());
        while (this.failures.size > 128)
          this.failures.delete(this.failures.keys().next().value);
        if (cached) {
          try {
            return await fs.readFile(file);
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
