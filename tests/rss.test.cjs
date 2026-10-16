const assert = require('node:assert/strict');
const test = require('node:test');
const { filterRecentItems, inferDateFromUrl, parseAlexandriaNews, parseRSS } = require('../server/rss.cjs');

const NOW = new Date('2026-07-29T12:00:00.000Z').getTime();
const WEEK = 7 * 24 * 60 * 60 * 1000;

test('parses RSS and decodes a valid article', () => {
  const items = parseRSS(`
    <rss><channel><item>
      <title><![CDATA[News &amp; analysis]]></title>
      <link>https://example.com/2026/07/29/story?x=1&amp;y=2</link>
      <pubDate>Wed, 29 Jul 2026 11:30:00 GMT</pubDate>
      <description><![CDATA[<p>A useful summary.</p>]]></description>
    </item></channel></rss>
  `, 'Example');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'News & analysis');
  assert.equal(items[0].link, 'https://example.com/2026/07/29/story?x=1&y=2');
  assert.equal(items[0].description, 'A useful summary.');
  assert.equal(items[0].dateSource, 'feed');
});

test('parses Atom alternate links and updated dates', () => {
  const items = parseRSS(`
    <feed>
      <entry>
        <title>Atom story</title>
        <link rel="alternate" href="https://example.com/atom-story" />
        <updated>2026-07-29T10:00:00Z</updated>
      </entry>
    </feed>
  `, 'Atom');

  assert.equal(items[0].link, 'https://example.com/atom-story');
  assert.equal(items[0].pubDate.toISOString(), '2026-07-29T10:00:00.000Z');
});

test('parses lowercase pubdate elements used by Frontiers journals', () => {
  const items = parseRSS(`
    <rss><channel><item>
      <title>Psychology research</title>
      <link>https://example.com/psychology-research</link>
      <pubdate>2026-07-29T09:00:00Z</pubdate>
    </item></channel></rss>
  `, 'Frontiers in Psychology');

  assert.equal(items[0].pubDate.toISOString(), '2026-07-29T09:00:00.000Z');
  assert.equal(items[0].dateSource, 'feed');
});

test('parses RDF/RSS 1.0 feeds used by international publishers', () => {
  const xml = `
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>World News</title></channel>
      <item rdf:about="https://example.com/world-story">
        <title>International headline</title>
        <link>https://example.com/world-story</link>
        <description>Useful international reporting context.</description>
        <dc:date>2026-07-29T12:00:00Z</dc:date>
      </item>
    </rdf:RDF>`;

  const items = parseRSS(xml, 'RDF Source');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'International headline');
  assert.equal(items[0].link, 'https://example.com/world-story');
  assert.equal(items[0].pubDate.toISOString(), '2026-07-29T12:00:00.000Z');
});

test('never promotes an undated item to the current time', () => {
  const [item] = parseRSS(`
    <rss><channel><item>
      <title>Undated legacy story</title>
      <link>https://example.com/archive/story</link>
    </item></channel></rss>
  `, 'Legacy');

  assert.equal(item.pubDate, null);
  assert.deepEqual(filterRecentItems([item], { maxAgeMs: WEEK, now: NOW }), []);
});

test('infers dates from common article URLs, then applies freshness', () => {
  const date = inferDateFromUrl('https://www.cnn.com/2023/04/18/opinions/old-story');
  assert.equal(date.toISOString(), '2023-04-18T12:00:00.000Z');

  const [item] = parseRSS(`
    <rss><channel><item>
      <title>The 2024 presidential alternative many voters will want</title>
      <link>https://www.cnn.com/2023/04/18/opinions/old-story</link>
    </item></channel></rss>
  `, 'CNN');

  assert.equal(item.dateSource, 'url');
  assert.deepEqual(filterRecentItems([item], { maxAgeMs: WEEK, now: NOW }), []);
});

test('infers a publication date from a dated feed title', () => {
  const [item] = parseRSS(`
    <rss><channel><item>
      <title>Most-Viewed Bills - Week of August 2, 2026</title>
      <link>https://www.congress.gov/most-viewed-bills</link>
    </item></channel></rss>
  `, 'Congress.gov');

  assert.equal(item.pubDate.toISOString(), '2026-08-02T12:00:00.000Z');
  assert.equal(item.dateSource, 'title');
});

test('parses current Alexandria city news rows from the public HTML page', () => {
  const [item] = parseAlexandriaNews(`
    <table><tr>
      <td class="releasedate">2026-08-08</td>
      <td><a href="/news/2026-08-08/example">City update</a></td>
    </tr></table>
  `);

  assert.equal(item.title, 'City update');
  assert.equal(item.link, 'https://www.alexandriava.gov/news/2026-08-08/example');
  assert.equal(item.pubDate.toISOString(), '2026-08-08T12:00:00.000Z');
});

test('drops future timestamps and non-http links', () => {
  const items = [
    { pubDate: new Date(NOW + 60 * 60 * 1000), link: 'https://example.com/future' },
    { pubDate: new Date(NOW), link: 'javascript:alert(1)' },
  ];

  assert.deepEqual(filterRecentItems(items, { maxAgeMs: WEEK, now: NOW }), []);
});
