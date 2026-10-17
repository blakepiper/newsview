const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { parseRSS } = require('../server/rss.cjs');
const { extractMetadata, extractMetadataImages } = require('../server/metadata.cjs');
const { isPublicAddress, parsePublicUrl, resolvePublicHost } = require('../server/public-fetch.cjs');
const { ImageCache } = require('../server/images.cjs');

test('image fetching rejects private, encoded, mapped, credentialed and custom-port targets', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '172.31.1.1', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert.equal(isPublicAddress(address), false, address);
  for (const url of ['http://2130706433/x', 'http://0x7f000001/x', 'http://[::ffff:7f00:1]/x', 'file:///etc/passwd', 'https://user:pass@example.com/x', 'http://example.com:8000/x']) assert.throws(() => parsePublicUrl(url), undefined, url);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(resolvePublicHost(new URL('https://example.com'), async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /Private/);
});

test('RSS media, enclosures, and HTML excerpts retain their article photographs', () => {
  const make = content => `<rss><channel><item><title>A report</title><link>https://example.com/article</link>${content}</item></channel></rss>`;
  assert.equal(parseRSS(make('<media:content url="https://example.com/large.jpg" width="1200" medium="image"/><media:thumbnail url="https://example.com/small.jpg"/>'), 'BBC')[0].image, 'https://example.com/large.jpg');
  assert.equal(parseRSS(make('<enclosure url="https://example.com/photo.png" type="image/png"/>'), 'BBC')[0].image, 'https://example.com/photo.png');
  assert.equal(parseRSS(make('<description><![CDATA[<img src="/photo.jpg"><p>Report</p>]]></description>'), 'BBC')[0].image, 'https://example.com/photo.jpg');
  assert.equal(parseRSS(make('<media:content url="https://example.com/movie.mp4" medium="video"/>'), 'BBC')[0].image, undefined);
});

test('metadata parser resolves relative images and blocks unsafe and empty URLs', () => {
  assert.equal(extractMetadata('<meta name="twitter:image" content="/twitter.jpg"><meta content="/news.jpg?a=1&amp;b=2" property="og:image">', 'https://example.com/story'), 'https://example.com/news.jpg?a=1&b=2');
  assert.equal(extractMetadata('<meta property="og:image" content="http://127.0.0.1/photo"><meta property="og:image" content="">', 'https://example.com/story'), null);
});

test('image cache coalesces, resizes, survives restart and evicts bounded entries', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newsview-images-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#4b6956' } }).png().toBuffer();
  let calls = 0;
  const fetcher = async url => { calls++; return { body: input, type: 'image/png', url }; };
  const cache = new ImageCache(directory, { maxEntries: 2, maxBytes: 30000, fetcher });
  const args = ['https://example.com/story', 'https://example.com/image.png'];
  const [first, second] = await Promise.all([cache.get(...args), cache.get(...args)]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  const metadata = await sharp(first).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 1200); assert.equal(metadata.height, 750);
  const restarted = new ImageCache(directory, { maxEntries: 2, maxBytes: 30000, fetcher });
  assert.deepEqual(await restarted.get(...args), first); assert.equal(calls, 1);
  await restarted.get('https://example.com/second', args[1]);
  await restarted.get('https://example.com/third', args[1]);
  assert.equal(restarted.entries.size, 2);
  assert.equal((await fs.readdir(directory)).filter(x => x.endsWith('.webp')).length, 2);
});

test('SVG disguised as a bitmap is rejected and failed lookups are negatively cached', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newsview-bad-images-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const cache = new ImageCache(directory, { fetcher: async url => { calls++; return { body: Buffer.from('<svg/>'), type: 'image/png', url }; } });
  await assert.rejects(cache.convert('https://example.com/image'), /signature/);
  await assert.rejects(cache.get('https://example.com/article'));
  const previous = calls;
  await assert.rejects(cache.get('https://example.com/article'));
  assert.equal(calls, previous);
});

test('image processing stays within two active jobs and rejects an oversized queue', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newsview-image-queue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#456' } }).png().toBuffer();
  let active = 0, peak = 0;
  const cache = new ImageCache(directory, { fetcher: async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 30));
    active--;
    return { body: input, type: 'image/png', url };
  } });
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => cache.get(`https://example.com/${index}`, 'https://example.com/photo.png')));
  assert.equal(peak, 2);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 10);
  assert.equal(outcomes.filter(x => x.status === 'rejected' && /queue busy/.test(x.reason.message)).length, 2);
});

const bitmap = (width, height) => sharp({
  create: { width, height, channels: 3, background: '#456' },
}).png().toBuffer();

async function testCache(t, fetcher) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newsview-image-quality-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cache = new ImageCache(directory, { fetcher });
  await cache.ready;
  return cache;
}

test('small feed photographs are upgraded from article metadata and the result is cached', async t => {
  const thumbnail = await bitmap(240, 135);
  const large = await bitmap(1600, 900);
  const calls = [];
  const cache = await testCache(t, async (url, options) => {
    calls.push(url);
    if (url.endsWith('/story')) {
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 6000);
      return { type: 'text/html', url: 'https://example.com/redirected/story', body: Buffer.from('<meta property="og:image" content="large.png">') };
    }
    return { type: 'image/png', url, body: url.endsWith('/thumbnail.png') ? thumbnail : large };
  });
  const args = ['https://example.com/story', 'https://example.com/thumbnail.png'];
  const result = await cache.get(...args);
  const { width, height } = await sharp(result).metadata();
  assert.deepEqual([width, height], [1200, 675]);
  assert.deepEqual(calls, [...args.slice(1), args[0], 'https://example.com/redirected/large.png']);
  assert.deepEqual(await cache.get(...args), result);
  assert.equal(calls.length, 3);
});

test('unavailable or smaller alternatives preserve a usable feed image without enlargement', async t => {
  const thumbnail = await bitmap(320, 180);
  const smaller = await bitmap(150, 100);
  for (const failure of ['offline', 'no-metadata', 'same-image', 'broken-image', 'smaller-image', 'unsafe-image']) {
    await t.test(failure, async t => {
      const calls = [];
      const cache = await testCache(t, async url => {
        calls.push(url);
        if (url.endsWith('/thumbnail.png')) return { type: 'image/png', url, body: thumbnail };
        if (failure === 'offline') throw new Error('Offline');
        if (url.endsWith('/story')) {
          const target = failure === 'same-image' ? '/thumbnail.png' : failure === 'unsafe-image' ? 'http://127.0.0.1/private' : '/alternative.png';
          const html = failure === 'no-metadata' ? '<p>No photo</p>' : `<meta property="og:image" content="${target}">`;
          return { type: 'text/html', url, body: Buffer.from(html) };
        }
        if (failure === 'broken-image') throw new Error('Upstream HTTP 404');
        return { type: 'image/png', url, body: smaller };
      });
      const result = await cache.get('https://example.com/story', 'https://example.com/thumbnail.png');
      const { width, height } = await sharp(result).metadata();
      assert.deepEqual([width, height], [320, 180]);
      assert.equal(calls.filter(url => url.endsWith('/thumbnail.png')).length, 1);
      assert.ok(calls.every(url => url.startsWith('https://example.com/')));
      const count = calls.length;
      await cache.get('https://example.com/story', 'https://example.com/thumbnail.png');
      assert.equal(calls.length, count);
    });
  }
});

test('metadata alternatives are deduplicated, bounded and isolated from failed downloads', async t => {
  const html = '<meta name="twitter:image" content="/large.png">'
    + '<meta property="og:image" content="/broken.png">'
    + '<meta property="og:image:secure_url" content="/broken.png">'
    + '<meta property="og:image" content="/small.png">'
    + '<meta property="og:image" content="http://127.0.0.1/private">'
    + '<meta name="twitter:image" content="/unused.png"><img src="/unrelated.png">';
  const article = 'https://example.com/story';
  assert.deepEqual(extractMetadataImages(html, article), [
    'https://example.com/broken.png', 'https://example.com/small.png', 'https://example.com/large.png',
  ]);
  const small = await bitmap(240, 135);
  const large = await bitmap(1200, 675);
  const calls = [];
  const cache = await testCache(t, async url => {
    calls.push(url);
    if (url === article) return { type: 'text/html', url, body: Buffer.from(html) };
    if (url.endsWith('/broken.png')) throw new Error('Upstream HTTP 404');
    return { type: 'image/png', url, body: url.endsWith('/small.png') ? small : large };
  });
  const result = await cache.get(article);
  assert.equal((await sharp(result).metadata()).width, 1200);
  assert.equal(calls.length, 4);
});

test('optional image upgrades share a deadline and keep the thumbnail when time runs out', async t => {
  const thumbnail = await bitmap(240, 135);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const calls = [];
  const cache = await testCache(t, async (url, options) => {
    calls.push(url);
    if (url.endsWith('/thumbnail.png')) return { type: 'image/png', url, body: thumbnail };
    if (url.endsWith('/story')) {
      assert.equal(options.timeoutMs, 6000);
      t.mock.timers.tick(4000);
      return { type: 'text/html', url, body: Buffer.from('<meta property="og:image" content="/slow.png"><meta name="twitter:image" content="/unused.png">') };
    }
    assert.equal(options.timeoutMs, 2000);
    t.mock.timers.tick(2000);
    throw new Error('Fetch timed out');
  });
  const result = await cache.get('https://example.com/story', 'https://example.com/thumbnail.png');
  assert.equal((await sharp(result).metadata()).width, 240);
  assert.equal(calls.length, 3);
});

test('legacy thumbnail caches upgrade lazily and survive offline migration', async t => {
  const args = ['https://example.com/story', 'https://example.com/thumbnail.png'];
  const legacyName = `${createHash('sha256').update(JSON.stringify(args)).digest('hex')}.webp`;
  const thumbnail = await bitmap(240, 135);
  const original = await sharp(thumbnail).webp().toBuffer();
  const large = await bitmap(1200, 675);
  let online = false;
  let calls = 0;
  const fetcher = async url => {
    calls++;
    if (!online) throw new Error('Offline');
    if (url.endsWith('/story')) return { type: 'text/html', url, body: Buffer.from('<meta property="og:image" content="/large.png">') };
    return { type: 'image/png', url, body: url.endsWith('/thumbnail.png') ? thumbnail : large };
  };
  const seed = await testCache(t, fetcher);
  await fs.writeFile(path.join(seed.directory, legacyName), original);
  const offline = new ImageCache(seed.directory, { fetcher });
  assert.deepEqual(await offline.get(...args), original);
  const failures = calls;
  assert.deepEqual(await offline.get(...args), original);
  assert.equal(calls, failures);
  online = true;
  const restarted = new ImageCache(seed.directory, { fetcher });
  const upgraded = await restarted.get(...args);
  assert.equal((await sharp(upgraded).metadata()).width, 1200);
  assert.equal(restarted.entries.size, 1);
  const files = await fs.readdir(seed.directory);
  assert.equal(files.length, 1);
  assert.equal(files.includes(legacyName), false);
  online = false;
  const restored = new ImageCache(seed.directory, { fetcher });
  const previousCalls = calls;
  assert.deepEqual(await restored.get(...args), upgraded);
  assert.equal(calls, previousCalls);
});

test('an expired high-resolution cache is not downgraded when only the thumbnail is reachable', async t => {
  const thumbnail = await bitmap(240, 135);
  const large = await bitmap(1200, 675);
  let online = true;
  const cache = await testCache(t, async url => {
    if (url.endsWith('/thumbnail.png')) return { type: 'image/png', url, body: thumbnail };
    if (!online) throw new Error('Article unavailable');
    if (url.endsWith('/story')) return { type: 'text/html', url, body: Buffer.from('<meta property="og:image" content="/large.png">') };
    return { type: 'image/png', url, body: large };
  });
  const args = ['https://example.com/story', 'https://example.com/thumbnail.png'];
  const original = await cache.get(...args);
  for (const entry of cache.entries.values()) entry.at -= 86400001;
  online = false;
  assert.deepEqual(await cache.get(...args), original);
});
