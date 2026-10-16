// Persist normalized records, never raw multi-megabyte XML or executable content.
const fs = require('node:fs');
const path = require('node:path');
class FeedSnapshots {
  constructor(directory, { maxEntries = 512, maxBytes = 12 * 1024 * 1024 } = {}) {
    this.file = path.join(directory, 'feeds-v1.json');
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.sizes = new Map();
    this.bytes = 0;
    try {
      if (fs.statSync(this.file).size <= maxBytes) {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved.version === 1 && Array.isArray(saved.entries)) {
          for (const [key, entry] of saved.entries.slice(-maxEntries)) {
            if (typeof key === 'string' && Number.isFinite(entry?.at) && entry.at <= Date.now() && Array.isArray(entry.items)) {
              const record = { at: entry.at, items: entry.items.slice(0, 300) };
              this.entries.set(key, record);
              const size = Buffer.byteLength(JSON.stringify([key, record])) + 1;
              this.sizes.set(key, size); this.bytes += size;
            }
          }
        }
      }
    } catch { /* An absent or interrupted cache is a normal cold start. */ }
  }
  get(key) { return this.entries.get(key); }
  set(key, items, at = Date.now()) {
    const record = { at, items: items.slice(0, 300) };
    const size = Buffer.byteLength(JSON.stringify([key, record])) + 1;
    if (size + 32 > this.maxBytes) return;
    this.bytes -= this.sizes.get(key) || 0;
    this.entries.delete(key);
    this.entries.set(key, record); this.sizes.set(key, size); this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes + 32 > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.sizes.get(oldest) || 0;
      this.entries.delete(oldest); this.sizes.delete(oldest);
    }
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 200);
      this.timer.unref();
    }
  }
  flush() {
    try {
      let entries = [...this.entries];
      let body = JSON.stringify({ version: 1, entries });
      while (Buffer.byteLength(body) > this.maxBytes && entries.length) {
        entries.shift();
        body = JSON.stringify({ version: 1, entries });
      }
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', body, { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (error) { console.error('[CACHE]', error.message); }
  }
}
module.exports = { FeedSnapshots };
