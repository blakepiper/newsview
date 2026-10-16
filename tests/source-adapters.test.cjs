const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfiguredSource, socialProvenance } = require('../server/source-adapters.cjs');
const { normalizeCategoryItems, getSourceHealth, sourceBreaker, registerRoutes, selectTechItems, selectDiverseItems, normalizeFinanceItems } = require('../server/data-feeds.cjs');

test('parses WHO API publication dates and resolves original article URLs', () => {
  const items = parseConfiguredSource(JSON.stringify({ value: [{ Title: 'Health update', ItemDefaultUrl: '/02-10-2026-health-update', PublicationDateAndTime: '2026-10-02T10:00:00Z' }] }), { name: 'WHO', parser: 'who-json' });
  assert.equal(items[0].link, 'https://www.who.int/news/item/02-10-2026-health-update');
  assert.equal(items[0].pubDate.toISOString(), '2026-10-02T10:00:00.000Z');
  assert.throws(() => parseConfiguredSource('{}', { name: 'WHO', parser: 'who-json' }));
});

test('parses dated USTR releases without turning archive links into articles', () => {
  const items = parseConfiguredSource('<ul><li><a href="/press-releases/2026">2026</a></li><li>2026-10-02<br><a href="/press-releases/2026/october/trade">Trade update</a></li></ul>', { name: 'USTR', url: 'https://ustr.gov', parser: 'ustr-html' });
  assert.equal(items.length, 1);
  assert.equal(items[0].pubDate.toISOString(), '2026-10-02T00:00:00.000Z');
});

test('preserves Federal Register original documents and excludes future publication dates', () => {
  const items = parseConfiguredSource(JSON.stringify({ results: [
    { title: 'Trade duties', publication_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), html_url: 'https://www.federalregister.gov/documents/one', pdf_url: 'https://www.govinfo.gov/doc.pdf' },
    { title: 'Future duties', publication_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), html_url: 'https://www.federalregister.gov/documents/two' },
  ] }), { name: 'Federal Register Trade', parser: 'federal-register' });
  const normalized = normalizeCategoryItems(items, 'headline');
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].documentUrl, 'https://www.govinfo.gov/doc.pdf');
});

test('council agenda publication dates stay separate from future meeting dates', () => {
  const rows = [{ EventBodyName: 'City Council Public Hearing', EventDate: '2026-10-10T00:00:00', EventAgendaLastPublishedUTC: '2026-10-02T15:00:00', EventInSiteURL: 'https://alexandria.legistar.com/MeetingDetail.aspx?ID=one' }];
  const items = parseConfiguredSource(JSON.stringify(rows), { name: 'Alexandria Council', parser: 'legistar' });
  assert.equal(items[0].pubDate.toISOString(), '2026-10-02T15:00:00.000Z');
  assert.equal(items[0].scheduledAt, '2026-10-10T00:00:00');
  assert.equal(items[0].timestampKind, 'updated');
});

test('transit alerts use effective times, skip expired alerts and never invent a date', () => {
  const now = Date.now();
  const base = { alertHeaderText: 'Orange Line delays', effectiveStartDate: (now - 60000) / 1000, effectiveEndDate: (now + 60000) / 1000 };
  const items = parseConfiguredSource(JSON.stringify({ alertResults: [base, { ...base, effectiveEndDate: (now - 1) / 1000 }, { ...base, effectiveStartDate: null }], advisoryResults: [] }), { name: 'WMATA Alerts', parser: 'wmata' });
  assert.equal(items.length, 1);
  assert.equal(items[0].timestampKind, 'effective');
});

test('social provenance keeps activity time and identifies old URL-dated articles', () => {
  const post = socialProvenance({ url: 'https://example.org/blog/2026/09/03/old-article/', timestamp: '2026-10-03T10:00:00Z' });
  assert.equal(post.timestampKind, 'posted');
  assert.equal(post.activityAt, '2026-10-03T10:00:00Z');
  assert.equal(post.publishedAt, '2026-09-03T12:00:00.000Z');
});

test('preserves corroborating publisher reports until after source selection', () => {
  const first = { title: 'Stocks rise on new policy', source: 'BBC', link: 'https://bbc.com/one', pubDate: new Date() };
  const normalized = normalizeCategoryItems([first, { ...first }, { ...first, source: 'Guardian', link: 'https://guardian.com/one' }], 'headline');
  assert.equal(normalized.length, 2);
  assert.deepEqual(selectTechItems(normalized, new Set(['Guardian'])).map(x => x.source), ['Guardian']);
  assert.equal(normalizeFinanceItems([{ ...first, source: 'Financial Times', title: 'Museum opens exhibition' }]).length, 0);
});

test('reserves source diversity even when a response fills before slower sources', () => {
  const prolific = Array.from({ length: 200 }, (_, id) => ({ source: 'A', id }));
  const sources = ['B', 'C', 'D', 'E'].map(source => ({ source, id: source }));
  assert.deepEqual([...new Set(selectDiverseItems([...prolific, ...sources], 5, 5).map(x => x.source))], ['A', 'B', 'C', 'D', 'E']);
});

test('health retains successful history when a source fails later', () => {
  sourceBreaker.reset();
  sourceBreaker.recordSuccess('BLS');
  sourceBreaker.recordFailure('BLS', new Error('HTTP 403: long private body'));
  const health = getSourceHealth().find(x => x.name === 'BLS');
  assert.equal(health.state, 'unavailable');
  assert.ok(health.lastSuccess);
  assert.equal(health.error, 'HTTP 403');
  sourceBreaker.reset();
});

test('empty tech and social selections return without network calls', async () => {
  const routes = new Map();
  registerRoutes({ use: () => {}, get: (path, handler) => routes.set(path, handler) });
  for (const path of ['/api/tech', '/api/lemmy', '/api/open-social', '/api/hackernews', '/api/4chan']) {
    let response;
    await routes.get(path)({ query: { sources: '' } }, { json: data => response = data });
    assert.deepEqual(response, [], path);
  }
});
