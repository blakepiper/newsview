const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RSS_FEEDS, normalizeFinanceItems, selectFinanceItems, parseRequestedFinanceSources,
  fetchFinanceNews, registerRoutes,
} = require('../server/data-feeds.cjs');

test('finance source filters accept configured publishers and reject unknown sources', () => {
  assert.equal(parseRequestedFinanceSources(undefined), null);
  assert.deepEqual([...parseRequestedFinanceSources(['CoinDesk', ' CNBC IPOs,Unknown'])], ['CoinDesk', 'CNBC IPOs']);
  assert.equal(parseRequestedFinanceSources('').size, 0);
  assert.ok(RSS_FEEDS.finance.every(feed => new URL(feed.url).protocol === 'https:'));
  assert.ok(RSS_FEEDS.finance.every(feed => !RSS_FEEDS.headlines.some(other => other.name === feed.name)));
});

test('filters finance sources before limits and reserves space for slower primary reporting', () => {
  const prolific = Array.from({ length: 80 }, (_, id) => ({ id, source: 'Bloomberg' }));
  const slower = [{ id: 'ipo', source: 'CNBC IPOs' }, { id: 'trade', source: 'WTO News' }];
  assert.deepEqual(selectFinanceItems([...prolific, ...slower], new Set(['CNBC IPOs', 'WTO News'])), slower);
  assert.deepEqual(selectFinanceItems(prolific, new Set()), []);
  const diverse = selectFinanceItems([...prolific, ...slower]);
  assert.equal(diverse.length, 80);
  assert.ok(slower.every(item => diverse.includes(item)));
});

test('finance normalization rejects stale, future, undated and malformed entries', () => {
  const now = Date.now();
  const valid = { title: 'Stocks update', source: 'Bloomberg', link: 'https://example.com/report', pubDate: new Date(now - 1000), description: 'Report details' };
  const normalized = normalizeFinanceItems([
    valid,
    { ...valid, title: 'Stale', pubDate: new Date(now - 8 * 86400000) },
    { ...valid, title: 'Future', pubDate: new Date(now + 86400000) },
    { ...valid, title: 'Undated', pubDate: null },
    { ...valid, title: 'Invalid', link: 'javascript:alert(1)' },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].timestamp, valid.pubDate.toISOString());
  assert.equal(normalized[0].description, valid.description);
  assert.match(normalized[0].id, /^headline-/);
});

test('retains corroborating finance reports and deduplicates only within a publisher', () => {
  const report = { title: 'Stocks rise on rate decision', source: 'Bloomberg', link: 'https://example.com/one', pubDate: new Date() };
  const items = normalizeFinanceItems([report, { ...report }, { ...report, source: 'Financial Times', link: 'https://example.com/two' }]);
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
  assert.equal(selectFinanceItems(items, new Set(['Financial Times'])).length, 1);
});

test('an empty finance selection returns without contacting upstream services', async () => {
  assert.deepEqual(await fetchFinanceNews(new Set()), []);
});

test('the finance route honors explicitly disabled and unknown source selections', async () => {
  const routes = new Map();
  registerRoutes({ use: () => {}, get: (path, handler) => routes.set(path, handler) });
  for (const sources of ['', 'Unknown']) {
    let body;
    await routes.get('/api/finance')({ query: { sources } }, { json: data => { body = data; } });
    assert.deepEqual(body, []);
  }
});
