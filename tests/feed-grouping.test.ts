import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFeedItems, isCurrentFeedItem, isBriefingReport } from '../src/utils/feedGrouping.ts';
import type { FeedItem } from '../src/types.ts';
import { sourceWindowDays, canonicalArticleLink, isPromotionalEntry } from '../shared/source-policy.js';
import { createRequire } from 'node:module';
const { RSS_FEEDS } = createRequire(import.meta.url)('../server/data-feeds.cjs');
const NOW = Date.parse('2026-10-03T16:00:00Z');
const day = 86400000;
function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return { id: 'one', title: 'Central bank revises policy after new inflation data', source: 'BBC', sourceType: 'news', category: 'BBC', timestamp: new Date(NOW - 3600000).toISOString(), link: 'https://example.org/article', ...overrides };
}

test('server and client agree on every configured source freshness window', () => {
  for (const feed of Object.values(RSS_FEEDS).flat() as { name: string; maxAgeMs: number }[]) {
    assert.equal(feed.maxAgeMs, sourceWindowDays(feed.name) * day, feed.name);
  }
  assert.equal(isCurrentFeedItem(item({ source: 'PNAS', timestamp: new Date(NOW - 8 * day).toISOString() }), NOW), true);
  assert.equal(isCurrentFeedItem(item({ source: 'NPR', timestamp: new Date(NOW - 8 * day).toISOString() }), NOW), false);
  assert.equal(isCurrentFeedItem(item({ source: 'The Markup', timestamp: new Date(NOW - 91 * day).toISOString() }), NOW), false);
});

test('old articles cannot become fresh through a new social submission', () => {
  assert.equal(isCurrentFeedItem(item({ source: 'c/news', timestampKind: 'posted', publishedAt: new Date(NOW - 30 * day).toISOString() }), NOW), false);
  assert.equal(isBriefingReport(item({ source: 'Hacker News', sourceType: 'tech' })), false);
  assert.equal(isBriefingReport(item({ source: 'Mastodon Trending' })), false);
  assert.equal(isBriefingReport(item({ source: 'GDELT', timestampKind: 'indexed' })), false);
});

test('groups canonical article links, preserving the publisher and social context', () => {
  const grouped = groupFeedItems([
    item({ source: 'Hacker News', id: 'social', timestamp: new Date(NOW).toISOString(), link: 'http://www.example.org/article?utm_source=hn&at_campaign=rss#comments' }),
    item(),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].source, 'BBC');
  assert.deepEqual(grouped[0].discoverySources, ['Hacker News']);
  assert.equal(grouped[0].relatedReports?.length, 2);
  assert.equal(canonicalArticleLink('https://bbc.com/x?at_medium=RSS&at_campaign=feed&utm_source=test'), 'https://bbc.com/x');
});

test('a burst from The Hindu ranks below recent alternatives without removing reports or changing dates', () => {
  const hindu = Array.from({ length: 12 }, (_, index) => item({
    id: `hindu-${index}`, source: 'The Hindu', title: `Distinct regional report number ${index}`,
    link: `https://thehindu.com/article-${index}`, timestamp: new Date(NOW - index * 60000).toISOString(),
  }));
  const bbc = item({ id: 'bbc', title: 'Scientists discover ancient fossil remains in desert', link: 'https://bbc.com/fossils' });
  const npr = item({ id: 'npr', source: 'NPR', title: 'Rail operator expands overnight passenger services',
    link: 'https://npr.org/rail', timestamp: new Date(NOW - 2 * 3600000).toISOString() });
  const grouped = groupFeedItems([...hindu, npr, bbc]);
  assert.deepEqual(grouped.slice(0, 2).map(entry => entry.id), ['bbc', 'npr']);
  assert.equal(grouped.length, 14);
  assert.deepEqual(grouped.slice(2).map(entry => entry.timestamp), hindu.map(entry => entry.timestamp));
  assert.deepEqual(groupFeedItems(hindu).map(entry => entry.id), hindu.map(entry => entry.id));
});

test('downweighting prefers another publisher for a shared article and preserves The Hindu association', () => {
  const grouped = groupFeedItems([
    item({ id: 'hindu', source: 'The Hindu', timestamp: new Date(NOW).toISOString() }),
    item(),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].source, 'BBC');
  assert.deepEqual(new Set(grouped[0].sources), new Set(['The Hindu', 'BBC']));
  assert.equal(grouped[0].relatedReports?.length, 2);
});

test('coauthored publications appear once with every followed author', () => {
  const grouped = groupFeedItems([
    item({ source: 'Dawn Song', link: 'https://arxiv.org/abs/2608.14611v2', publisher: 'arXiv' }),
    item({ source: 'Yoshua Bengio', link: 'https://arxiv.org/pdf/2608.14611v1.pdf', publisher: 'arXiv' }),
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].monitoredAuthors, ['Dawn Song', 'Yoshua Bengio']);
});

test('merges existing article groups when a later report bridges their URL and title', () => {
  const grouped = groupFeedItems([
    item({ source: 'BBC', title: 'Central bank releases its monetary policy decision', link: 'https://example.org/first' }),
    item({ source: 'Guardian', title: 'Central bank cuts interest rates after inflation falls', link: 'https://example.org/second' }),
    item({ source: 'NPR', title: 'Central bank cuts interest rates after inflation falls', link: 'https://example.org/first?utm_source=rss' }),
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(new Set(grouped[0].sources), new Set(['BBC', 'Guardian', 'NPR']));
});

test('similar events and distinct alerts remain separate while exact duplicates group', () => {
  const first = item({ title: 'Senate debates an energy bill amid economic concerns', link: 'https://example.org/a' });
  const second = item({ title: 'Senate debates a privacy bill amid economic concerns', link: 'https://example.org/b' });
  assert.equal(groupFeedItems([first, second]).length, 2);
  assert.equal(groupFeedItems([
    item({ source: 'WMATA Alerts', title: 'P12 - Reduced Service', link: 'https://www.wmata.com/ride/alerts-and-advisories.html' }),
    item({ source: 'WMATA Alerts', title: 'Orange Line - Delays', link: 'https://www.wmata.com/ride/alerts-and-advisories.html' }),
  ]).length, 2);
});

test('filters paid entries without deleting news about state-sponsored violence', () => {
  assert.equal(isPromotionalEntry({ title: 'Build your AI factory', source: 'The Register', description: 'SPONSORED FEATURE: HPE and NVIDIA' }), true);
  assert.equal(isPromotionalEntry({ title: 'Report documents state-sponsored violence', source: 'BBC' }), false);
});
