const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { FeedSnapshots } = require('../server/feed-snapshots.cjs');
const { jsonResponses } = require('../server/json-response.cjs');
const express = require('express');

test('source snapshots survive restart and bound disk size, records and entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnn-cache-'));
  try {
    const cache = new FeedSnapshots(dir, { maxEntries: 2, maxBytes: 2000 });
    cache.set('old', [{ title: 'old' }]);
    cache.set('second', [{ title: 'second' }]);
    cache.set('third', [{ title: 'third' }]);
    cache.set('latest', Array.from({ length: 500 }, () => ({ title: 'long'.repeat(50) })));
    assert.equal(cache.get('old'), undefined);
    assert.equal(cache.get('latest'), undefined); // Oversized records cannot grow RAM either.
    cache.set('small', [{ title: 'retained' }]);
    cache.flush();
    assert.ok(fs.statSync(cache.file).size <= 2000);
    const restarted = new FeedSnapshots(dir, { maxEntries: 2, maxBytes: 2000 });
    assert.equal(restarted.get('small').items[0].title, 'retained');
    clearTimeout(cache.timer);
    fs.writeFileSync(cache.file, '{broken');
    assert.equal(new FeedSnapshots(dir).entries.size, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JSON responses compress, honor encoding negotiation and return conditional 304s', async t => {
  const app = express(); app.use(jsonResponses);
  const data = { title: 'a'.repeat(8000) };
  app.get('/', (_req, res) => { res.set('X-Feed-Updating', '1'); res.json(data); });
  app.get('/failure', (_req, res) => res.status(500).json(data));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const request = (headers, endpoint = '/') => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.address().port}${endpoint}`, { headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const compressed = await request({ 'Accept-Encoding': 'gzip' });
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.ok(compressed.body.length < 200);
  assert.deepEqual(JSON.parse(require('node:zlib').gunzipSync(compressed.body)), data);
  const conditional = await request({ 'If-None-Match': compressed.headers.etag, 'Accept-Encoding': 'gzip' });
  assert.equal(conditional.status, 304); assert.equal(conditional.body.length, 0);
  assert.equal(conditional.headers['x-feed-updating'], '1');
  const plain = await request({ 'Accept-Encoding': 'gzip;q=0' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(plain.body), data);
  assert.equal((await request({ 'If-None-Match': plain.headers.etag }, '/failure')).status, 500);
});

test('cold feeds have a deadline, retain late sources, and skip unselected upstreams', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnn-pool-'));
  process.env.FEED_CACHE_DIR = dir;
  const { RSS_FEEDS, fetchTechNews } = require('../server/data-feeds.cjs');
  let release; let slowResponse; let failing = false; const calls = {};
  const server = http.createServer((req, res) => {
    calls[req.url] = (calls[req.url] || 0) + 1;
    if (failing) { res.statusCode = 503; res.end('Unavailable'); return; }
    const body = `<rss><channel><item><title>${req.url} article</title><link>https://example.com${req.url}</link><pubDate>${new Date(Date.now() - 10000).toUTCString()}</pubDate></item></channel></rss>`;
    if (req.url === '/slow') { slowResponse = res; release = () => res.end(body); }
    else res.end(body);
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { release?.(); slowResponse?.destroy(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => originalFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  t.after(() => { globalThis.fetch = originalFetch; });
  const url = 'https://example.com';
  RSS_FEEDS.tech.splice(0, RSS_FEEDS.tech.length, ...['fast', 'slow', 'unselected'].map(name => ({ name, url: `${url}/${name}`, nativeFetch: true, pollIntervalMs: 600000, maxAgeMs: 7 * 86400000 })));
  const selected = new Set(['fast', 'slow']);
  const started = performance.now();
  const partial = await fetchTechNews(selected);
  assert.ok(performance.now() - started < 1800);
  assert.deepEqual(partial.map(x => x.source), ['fast']);
  assert.equal(calls['/unselected'], undefined);
  const warmStarted = performance.now();
  assert.equal((await fetchTechNews(selected)).length, 1);
  assert.ok(performance.now() - warmStarted < 100);
  release();
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await fetchTechNews(selected)).length, 2);
  assert.equal(calls['/fast'], 1); assert.equal(calls['/slow'], 1);
  assert.ok(fs.existsSync(path.join(dir, 'feeds-v1.json')));
  const script = `const f = require('./server/data-feeds.cjs');
    f.RSS_FEEDS.tech.splice(0, f.RSS_FEEDS.tech.length, ...${JSON.stringify(RSS_FEEDS.tech)});
    const started = performance.now();
    f.fetchTechNews(new Set(['fast','slow'])).then(items => console.log(JSON.stringify({count:items.length,ms:performance.now()-started})));`;
  const output = require('node:child_process').execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, FEED_CACHE_DIR: dir }, encoding: 'utf8', timeout: 5000,
  });
  const restarted = JSON.parse(output.trim());
  assert.equal(restarted.count, 2); assert.ok(restarted.ms < 100);
  const realNow = Date.now;
  failing = true;
  try {
    Date.now = () => realNow() + 700000;
    assert.equal((await fetchTechNews(selected)).length, 2); // Failed refresh keeps valid records.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(require('../server/data-feeds.cjs').getSourceHealth().find(x => x.name === 'fast').state, 'unavailable');
    Date.now = () => realNow() + 8 * 86400000;
    assert.equal((await fetchTechNews(selected)).length, 0); // The snapshot never bypasses expiry.
  } finally { Date.now = realNow; }

});
