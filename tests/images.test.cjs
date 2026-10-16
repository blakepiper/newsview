const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { parseRSS } = require('../server/rss.cjs');
const { extractMetadata } = require('../server/metadata.cjs');
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
