const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeKalshiMarket, normalizePolymarketMarket, normalizePizzintMarket } = require('../server/data-feeds.cjs');

const NOW = new Date('2026-07-29T16:00:00Z').getTime();

function market(overrides = {}) {
  return {
    id: 'market-1',
    question: 'Will the example happen before 2027?',
    slug: 'will-the-example-happen-before-2027',
    active: true,
    closed: false,
    archived: false,
    endDate: '2026-12-31T23:59:00Z',
    volume24hr: 25_000,
    outcomes: '["No","Yes"]',
    outcomePrices: '["0.64","0.36"]',
    events: [{
      slug: 'example-event',
      active: true,
      closed: false,
      endDate: '2026-12-31T23:59:00Z',
    }],
    ...overrides,
  };
}

test('normalizes current Polymarket data and links through the event slug', () => {
  const result = normalizePolymarketMarket(market(), NOW);

  assert.equal(result.question, 'Will the example happen before 2027?');
  assert.equal(result.yesPrice, 36);
  assert.equal(result.source, 'Polymarket');
  assert.equal(
    result.url,
    'https://polymarket.com/event/example-event?marketSlug=will-the-example-happen-before-2027'
  );
});

test('rejects ended, malformed, and sports markets independently', () => {
  assert.equal(
    normalizePolymarketMarket(market({ endDate: '2026-07-28T00:00:00Z' }), NOW),
    null
  );
  assert.equal(
    normalizePolymarketMarket(market({ outcomePrices: 'not-json' }), NOW),
    null
  );
  assert.equal(
    normalizePolymarketMarket(market({ question: 'Will the Lakers win the NBA championship?' }), NOW),
    null
  );
});

test('normalizes an anonymous Kalshi market without requiring credentials', () => {
  const result = normalizeKalshiMarket({
    ticker: 'KXEXAMPLE-26',
    event_ticker: 'KXEXAMPLE',
    title: 'Will the example happen before 2027?',
    status: 'active',
    volume_24h_fp: '25000',
    last_price_dollars: '0.64',
    close_time: '2026-12-31T23:59:00Z',
  }, NOW);

  assert.equal(result.source, 'Kalshi');
  assert.equal(result.yesPrice, 64);
  assert.equal(result.url, 'https://kalshi.com/markets/KXEXAMPLE/KXEXAMPLE-26');
});

test('rejects sports metadata, spread contracts and country-match titles', () => {
  for (const overrides of [
    { question: 'Spread: Alabama (-5.5)' },
    { question: 'Will Spain win on 2026-10-03?' },
    { question: 'Will England score over 5.5?', tags: [{ label: 'Sports' }] },
  ]) assert.equal(normalizePolymarketMarket(market(overrides), NOW), null);
  assert.equal(normalizeKalshiMarket({ ticker: 'KXUEFATEAMTOTAL-26', title: 'England over 5.5 goals', status: 'active', volume_24h_fp: '25000', last_price_dollars: '0.4' }, NOW), null);
  assert.ok(normalizePolymarketMarket(market({ question: 'Will heat-related demand raise energy prices?' }), NOW));
});

test('keeps full questions so contracts with different horizons remain distinguishable', () => {
  const title = 'Will the state legislature approve a new data-center construction moratorium before December 31, 2027?';
  assert.equal(normalizePolymarketMarket(market({ question: title }), NOW).question, title);
});

test('rejects unidentified or illiquid discovery quotes instead of fabricating prices', () => {
  assert.equal(normalizePizzintMarket({ id: 'one', label: 'Will the example happen?' }, NOW), null);
  assert.equal(normalizePizzintMarket({ id: 'one', label: 'Will the example happen?', eventSlug: 'event', price: 0.4, volume_24h: 0, endDate: '2026-12-31T00:00:00Z' }, NOW), null);
  assert.equal(normalizePizzintMarket({ id: 'one', label: 'Will the example happen?', eventSlug: 'event', volume_24h: 25000, endDate: '2026-12-31T00:00:00Z' }, NOW), null);
});
