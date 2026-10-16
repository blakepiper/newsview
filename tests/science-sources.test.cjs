const assert = require('node:assert/strict');
const test = require('node:test');
const { RSS_FEEDS, selectScienceItems } = require('../server/data-feeds.cjs');

const NEWS_OUTLETS = [
  'ScienceDaily',
  'Phys.org',
  'Science News',
  'Live Science',
  'Quanta Magazine',
  'NASA',
  'AAAS Science News',
  'APS Psychology',
  'Neuroscience News Psychology',
];

const JOURNALS = [
  'Nature',
  'Science',
  'PNAS',
  'Cell',
  'Science Advances',
  'eLife',
  'PLOS ONE',
  'The Lancet',
  'NEJM',
  'Frontiers in Psychology',
  'Human Factors',
  'Ergonomics',
  'Carbon Brief',
  'Mongabay',
  'STAT',
  'WHO',
  'KFF Health News',
  'Undark',
];

test('configures a distinct mix of science reporting and primary journals', () => {
  const feeds = RSS_FEEDS.science;
  const names = feeds.map(feed => feed.name);
  const urls = feeds.map(feed => feed.url);

  assert.deepEqual(names, [...NEWS_OUTLETS, ...JOURNALS, 'Karl Friston', 'Michael Levin', 'Chris Fields', 'Geoffrey Hinton', 'Yann LeCun', 'Percy Liang', 'Stuart Russell', 'Yoshua Bengio', 'Fei-Fei Li', 'Yejin Choi', 'Dawn Song', 'Chris Olah', 'Neel Nanda', 'Paul Christiano', 'Dan Hendrycks', 'Myles Allen', 'Piers Forster', 'Gavin Schmidt', 'Friederike Otto', 'Richard Alley', 'Corinne Le Quéré', 'Marshall Burke', 'Jesse Jenkins', 'Michael Mann', 'Zeke Hausfather', 'Matt Kaeberlein', 'Valter Longo', 'David Sinclair', 'Steve Horvath', 'Michael Snyder', 'Herman Pontzer', 'Vishwa Deep Dixit', 'Rhonda Patrick', 'Peter Attia', 'Chris Masterjohn', 'Lisa Kaltenegger', 'Nikku Madhusudhan', 'Sara Seager', 'David Kipping', 'Victoria Meadows', 'Ravi Kopparapu', 'Jessie Christiansen', 'Kevin Hand', 'Sara Imari Walker', 'Jason Wright', 'Jennifer Doudna', 'Feng Zhang', 'David Liu', 'George Church', 'Jay Keasling', 'James Collins', 'Pamela Silver', 'Drew Endy', 'Timothy Lu', 'Cameron Myhrvold']);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every(url => new URL(url).protocol === 'https:'));
});

test('applies science source selection before response limits', () => {
  const otherItems = Array.from({ length: 60 }, (_, index) => ({
    id: `other-${index}`,
    title: `Other article ${index}`,
    source: 'ScienceDaily',
  }));
  const selectedItems = Array.from({ length: 3 }, (_, index) => ({
    id: `nature-${index}`,
    title: `Nature article ${index}`,
    source: 'Nature',
  }));

  const result = selectScienceItems(
    [...otherItems, ...selectedItems],
    new Set(['Nature'])
  );

  assert.deepEqual(result, selectedItems);
  assert.deepEqual(selectScienceItems([...otherItems], new Set()), []);
});

test('reserves room for slower journal feeds in the default science mix', () => {
  const prolificOutlet = Array.from({ length: 60 }, (_, index) => ({
    id: `daily-${index}`,
    title: `Daily article ${index}`,
    source: 'ScienceDaily',
  }));
  const journalItems = JOURNALS.map((source, index) => ({
    id: `journal-${index}`,
    title: `${source} research article`,
    source,
  }));

  const result = selectScienceItems([...prolificOutlet, ...journalItems]);
  const resultSources = new Set(result.map(item => item.source));

  assert.equal(result.length, Math.min(prolificOutlet.length + journalItems.length, Math.max(60, RSS_FEEDS.science.length)));
  assert.ok(JOURNALS.every(source => resultSources.has(source)));
});

test('filters journal housekeeping notices while retaining research articles', () => {
  const nature = RSS_FEEDS.science.find(feed => feed.name === 'Nature');
  const pnas = RSS_FEEDS.science.find(feed => feed.name === 'PNAS');
  const plos = RSS_FEEDS.science.find(feed => feed.name === 'PLOS ONE');

  assert.equal(nature.filter({ title: 'Publisher Correction: an article' }), false);
  assert.equal(nature.filter({ title: 'A new result in quantum sensing' }), true);
  assert.equal(pnas.filter({ title: 'In This Issue' }), false);
  assert.equal(pnas.filter({ title: 'An ecological research article' }), true);
  assert.equal(plos.filter({ title: 'Retraction: an article' }), false);
  assert.equal(plos.filter({ title: 'A genomics research article' }), true);
});

test('retains slower researchers when every configured science source has publications', () => {
  const items = RSS_FEEDS.science.map((feed, index) => ({
    id: `source-${index}`, source: feed.name, title: `Publication ${index}`,
  }));
  const result = selectScienceItems(items);
  assert.equal(result.length, items.length);
  assert.ok(result.some(item => item.source === 'Dan Hendrycks'));
  assert.ok(result.some(item => item.source === 'Jason Wright'));
});
