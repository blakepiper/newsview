const assert = require('node:assert/strict');
const test = require('node:test');
const { isLocalAdOrPromotion, RSS_FEEDS, selectLocalItems } = require('../server/data-feeds.cjs');

test('configures free DC and Alexandria local sources', () => {
  const feeds = RSS_FEEDS.local;
  assert.ok(feeds.some(feed => feed.name === 'Alexandria City'));
  assert.ok(feeds.some(feed => feed.name === 'Alexandria Times'));
  assert.ok(feeds.some(feed => feed.name === 'WTOP'));
  assert.ok(feeds.some(feed => feed.name === 'WAMU'));
  assert.ok(feeds.every(feed => new URL(feed.url).protocol === 'https:'));
  assert.ok(feeds.every(feed => typeof feed.filter === 'function'));
});

test('applies local source selection before the response limit', () => {
  const items = [
    ...Array.from({ length: 50 }, (_, index) => ({ source: 'WTOP', id: `wtop-${index}` })),
    { source: 'Alexandria Times', id: 'alexandria-1' },
  ];
  assert.deepEqual(
    selectLocalItems(items, new Set(['Alexandria Times'])),
    [{ source: 'Alexandria Times', id: 'alexandria-1' }]
  );
});

test('filters betting, prediction-market, adult, and sponsored local promotions', () => {
  assert.equal(isLocalAdOrPromotion({
    title: 'Kalshi Promo Code WTOP Gets Up To $500 In Bonuses',
    description: 'This article contains references to products from our advertisers or partners.',
  }), true);
  assert.equal(isLocalAdOrPromotion({
    title: '10 Best Cam Sites for Hot Live Camgirl Shows',
    description: 'This guide reviews the most popular platforms.',
  }), true);
  assert.equal(isLocalAdOrPromotion({
    title: 'Sponsored Content: Late Summer Pest Pressure Around the Home',
    description: 'A guide for homeowners.',
  }), true);
  assert.equal(isLocalAdOrPromotion({
    title: 'Virginia lawmakers debate sports betting regulations',
    description: 'The proposal would change how licensed operators report revenue.',
  }), false);
  assert.equal(isLocalAdOrPromotion({
    title: 'DC prediction market policy draws scrutiny',
    description: 'Officials are reviewing the legal questions around the market.',
  }), false);
  assert.equal(isLocalAdOrPromotion({
    title: 'Ex-Del Ray restaurant worker sentenced in hidden camera case',
    description: 'A local court announced the sentence Friday.',
  }), false);
});
