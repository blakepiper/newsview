const assert = require('node:assert/strict');
const test = require('node:test');
const { SCIENTIST_FEEDS, parseScientistPublications } = require('../server/scientist-publications.cjs');
const { filterRecentItems } = require('../server/rss.cjs');
const { selectScienceItems } = require('../server/data-feeds.cjs');
const scientist = SCIENTIST_FEEDS[0];
const paper = {
  title: 'A new research paper', doi: '10.1234/example', firstPublicationDate: '2026-09-17',
  source: 'MED', id: '12345', authorString: 'Friston KJ, Levin M',
  authorList: { author: [{ authorId: { type: 'ORCID', value: scientist.orcid } }] },
  journalInfo: { journal: { title: 'Research Journal' } }, abstractText: '<p>An abstract.</p>',
};
const parse = papers => parseScientistPublications(JSON.stringify({ resultList: { result: papers } }), scientist);

test('matches verified researcher identities and normalizes publication metadata', () => {
  const [item] = parse([paper]);
  assert.equal(item.source, 'Karl Friston');
  assert.equal(item.pubDate.toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(item.link, 'https://doi.org/10.1234%2Fexample');
  assert.match(item.description, /Research Journal · Friston KJ, Levin M — An abstract\./);
  assert.equal(parse([{ ...paper, authorList: { author: [{ fullName: 'Karl Friston' }] } }]).length, 0);
  assert.equal(parse([{ ...paper, authorList: { author: [{ authorId: { type: 'ORCID', value: 'different' } }] } }]).length, 0);
});

test('rejects missing or invalid dates, empty titles, and records without a link', () => {
  for (const change of [{ firstPublicationDate: undefined }, { firstPublicationDate: '2026-02-30' }, { title: '' }, { doi: '', source: '', id: '' }]) {
    assert.deepEqual(parse([{ ...paper, ...change }]), []);
  }
  assert.throws(() => parseScientistPublications('{}', scientist), /Invalid Europe PMC/);
});

test('deduplicates indexed copies, labels preprints, and falls back to the indexed paper link', () => {
  assert.equal(parse([paper, paper]).length, 1);
  const [preprint] = parse([{ ...paper, source: 'PPR', id: 'PPR12345', doi: undefined }]);
  assert.equal(preprint.link, 'https://europepmc.org/article/PPR/PPR12345');
  assert.match(preprint.description, /^Preprint · /);
});

test('keeps publications within 180 days and rejects stale and future records', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const items = parse([paper, { ...paper, title: 'Old', doi: '10.1234/old', firstPublicationDate: '2025-10-03' }, { ...paper, title: 'Future', doi: '10.1234/future', firstPublicationDate: '2026-10-04' }]);
  const recent = filterRecentItems(items, { now, maxAgeMs: scientist.maxAgeMs });
  assert.deepEqual(recent.map(item => item.title), [paper.title]);
});

test('supports each scientist as an independent source before the science response limit', () => {
  const items = SCIENTIST_FEEDS.map(feed => ({ source: feed.name, title: paper.title }));
  for (const feed of SCIENTIST_FEEDS) {
    const url = new URL(feed.url);
    if (feed.provider === 'arxiv') {
      assert.equal(url.hostname, 'export.arxiv.org');
      assert.equal(url.searchParams.get('sortBy'), 'submittedDate');
      assert.ok(feed.authorNames.every(name => url.searchParams.get('search_query').includes(`au:"${name}"`)));
    } else if (feed.provider === 'crossref') {
      assert.equal(url.hostname, 'api.crossref.org');
      assert.equal(url.searchParams.get('filter'), `orcid:${feed.orcid}`);
    } else {
      assert.equal(url.searchParams.get('query'), `${feed.authorQuery || [feed.orcid, ...(feed.orcidAliases || [])].map(orcid => `AUTHORID:${orcid}`).join(' OR ')} sort_date:y`);
      assert.equal(url.searchParams.get('resultType'), 'core');
    }
    assert.deepEqual(selectScienceItems(items, new Set([feed.name])), items.filter(item => item.source === feed.name));
  }
});

const arxivFeed = SCIENTIST_FEEDS.find(feed => feed.name === 'Geoffrey Hinton');
function atomEntry({ author = 'Geoffrey E. Hinton', id = 'https://arxiv.org/abs/2609.12345v2', published = '2026-09-10T12:00:00Z', updated = '2026-10-01T12:00:00Z', journal = '' } = {}) {
  return `<entry><id>${id}</id><title>A research\n paper</title><published>${published}</published><updated>${updated}</updated><author><name>${author}</name></author><summary>An abstract.</summary>${journal ? `<arxiv:journal_ref>${journal}</arxiv:journal_ref>` : ''}</entry>`;
}
function parseAtom(entries) {
  return parseScientistPublications(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">${entries.join('')}</feed>`, arxivFeed);
}

test('matches arXiv full author names and rejects partial names or mentions', () => {
  const [item] = parseAtom([atomEntry()]);
  assert.equal(item.source, 'Geoffrey Hinton');
  assert.equal(item.title, 'A research paper');
  assert.equal(item.link, 'https://arxiv.org/abs/2609.12345');
  assert.match(item.description, /^Preprint · arXiv · Geoffrey E\. Hinton/);
  for (const author of ['G. Hinton', 'Another Hinton', 'Geoffrey Hinton Jr.']) {
    assert.deepEqual(parseAtom([atomEntry({ author })]), []);
  }
});

test('uses original submission date, deduplicates versions, and labels journal references', () => {
  const [item] = parseAtom([atomEntry({ journal: 'AI Journal 2026' }), atomEntry({ id: 'http://arxiv.org/abs/2609.12345v1' })]);
  assert.equal(item.pubDate.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.match(item.description, /^arXiv · Published in AI Journal 2026/);
  assert.equal(parseAtom([atomEntry(), atomEntry()]).length, 1);
});

test('rejects malformed arXiv links, undated papers, and non-feed responses', () => {
  assert.deepEqual(parseAtom([atomEntry({ id: 'https://example.com/abs/2609.12345' })]), []);
  assert.deepEqual(parseAtom([atomEntry({ published: '' })]), []);
  assert.throws(() => parseScientistPublications('<html>Unavailable</html>', arxivFeed), /Invalid arXiv/);
  assert.deepEqual(parseAtom([]), []);
});

const climateFeed = SCIENTIST_FEEDS.find(feed => feed.name === 'Michael Mann');
const climatePaper = {
  type: 'journal-article', title: ['A climate study'], DOI: '10.1234/climate',
  published: { 'date-parts': [[2026, 9, 20]] },
  'published-online': { 'date-parts': [[2026, 9, 10]] },
  'published-print': { 'date-parts': [[2026, 11, 1]] },
  author: [{ given: 'Michael E.', family: 'Mann', ORCID: `https://orcid.org/${climateFeed.orcid}` }],
  'container-title': ['Climate Journal'], abstract: '<jats:p>Verified abstract.</jats:p>',
};
const parseClimate = papers => parseScientistPublications(JSON.stringify({ message: { items: papers } }), climateFeed);

test('matches climate researchers by ORCID rather than common names', () => {
  const [item] = parseClimate([climatePaper]);
  assert.equal(item.source, 'Michael Mann');
  assert.equal(item.link, 'https://doi.org/10.1234%2Fclimate');
  assert.match(item.description, /Climate Journal · University of Pennsylvania · Michael E\. Mann — Verified abstract\./);
  assert.deepEqual(parseClimate([{ ...climatePaper, author: [{ given: 'Michael', family: 'Mann', ORCID: 'https://orcid.org/0000-0002-5690-4776' }] }]), []);
  assert.deepEqual(parseClimate([{ ...climatePaper, author: [{ given: 'Michael', family: 'Mann' }] }]), []);
});

test('uses earliest actual publication date rather than future print or indexing dates', () => {
  const [item] = parseClimate([climatePaper]);
  assert.equal(item.pubDate.toISOString(), '2026-09-10T00:00:00.000Z');
  assert.deepEqual(parseClimate([{ ...climatePaper, published: { 'date-parts': [[2026]] }, 'published-online': undefined, 'published-print': undefined, created: { 'date-parts': [[2026, 9, 20]] } }]), []);
  assert.deepEqual(parseClimate([{ ...climatePaper, published: { 'date-parts': [[2026, 2, 30]] }, 'published-online': undefined, 'published-print': undefined }]), []);
});

test('rejects malformed climate metadata and deduplicates DOI records', () => {
  assert.equal(parseClimate([climatePaper, climatePaper]).length, 1);
  for (const change of [{ type: 'grant' }, { title: [] }, { DOI: 'not-a-doi' }, { author: undefined }]) {
    assert.deepEqual(parseClimate([{ ...climatePaper, ...change }]), []);
  }
  assert.throws(() => parseScientistPublications('{}', climateFeed), /Invalid Crossref/);
  assert.deepEqual(parseClimate([]), []);
  assert.match(parseClimate([{ ...climatePaper, type: 'posted-content' }])[0].description, /^Preprint · /);
});

test('preserves accented climate names and supplied affiliations', () => {
  const climate = SCIENTIST_FEEDS.filter(feed => feed.provider === 'crossref');
  assert.equal(climate.length, 10);
  assert.equal(new Set(climate.map(feed => feed.orcid)).size, 10);
  assert.ok(climate.every(feed => feed.affiliation && feed.maxAgeMs === 180 * 86400000));
  assert.equal(climate.find(feed => feed.name === 'Corinne Le Quéré').affiliation, 'University of East Anglia');
  assert.equal(climate.find(feed => feed.name === 'Jesse Jenkins').affiliation, 'Princeton University');
});

test('uses name and same-author affiliation for researchers without verified ORCIDs', () => {
  const cases = [
    ['Rhonda Patrick', 'Rhonda P', 'Patrick', 'FoundMyFitness, LLC, San Diego, CA'],
    ['Peter Attia', 'Peter', 'Attia', 'Surgery Branch, National Cancer Institute, Bethesda'],
    ['Chris Masterjohn', 'Christopher', 'Masterjohn', 'University of Connecticut, Storrs'],
  ];
  for (const [name, firstName, lastName, affiliation] of cases) {
    const feed = SCIENTIST_FEEDS.find(feed => feed.name === name);
    const entry = { ...paper, authorList: { author: [{ firstName, lastName, authorAffiliationDetailsList: { authorAffiliation: [{ affiliation }] } }] } };
    const parse = entry => parseScientistPublications(JSON.stringify({ resultList: { result: [entry] } }), feed);
    assert.equal(parse(entry)[0].source, name);
    assert.match(parse(entry)[0].description, new RegExp(feed.affiliation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(parse({ ...entry, authorList: { author: [{ firstName, lastName }] } }), []);
    assert.deepEqual(parse({ ...entry, authorList: { author: [{ firstName, lastName, authorAffiliationDetailsList: { authorAffiliation: [{ affiliation: 'Unrelated institute' }] } }] } }), []);
  }
});

test('rejects Peter Attia namesakes even when another coauthor has a matching affiliation', () => {
  const feed = SCIENTIST_FEEDS.find(feed => feed.name === 'Peter Attia');
  for (const firstName of ['Peter J', 'Peter M', 'Peter']) {
    const entry = { ...paper, authorList: { author: [
      { firstName, lastName: 'Attia', authorAffiliationDetailsList: { authorAffiliation: [{ affiliation: 'Rutgers New Jersey Medical School' }] } },
      { firstName: 'Someone', lastName: 'Else', authorAffiliationDetailsList: { authorAffiliation: [{ affiliation: 'Early Medical' }] } },
    ] } };
    assert.deepEqual(parseScientistPublications(JSON.stringify({ resultList: { result: [entry] } }), feed), []);
  }
});

test('matches astronomy author variants and includes the supplied institution', () => {
  const cases = [
    ['David Kipping', 'David M. Kipping', 'Columbia University'],
    ['Ravi Kopparapu', 'Ravi kumar Kopparapu', 'NASA Goddard Space Flight Center'],
    ['Sara Imari Walker', 'Sara I. Walker', 'Arizona State University'],
    ['Jessie Christiansen', 'Jessie L. Christiansen', 'Caltech / NASA Exoplanet Science Institute'],
  ];
  for (const [name, author, affiliation] of cases) {
    const feed = SCIENTIST_FEEDS.find(feed => feed.name === name);
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">${atomEntry({ author })}</feed>`;
    const [item] = parseScientistPublications(xml, feed);
    assert.equal(item.source, name);
    assert.ok(item.description.includes(affiliation));
    assert.equal(feed.maxAgeMs, 180 * 86400000);
  }
});

test('distinguishes the Penn State astronomer Jason T. Wright from namesakes', () => {
  const feed = SCIENTIST_FEEDS.find(feed => feed.name === 'Jason Wright');
  const parse = author => parseScientistPublications(`<feed>${atomEntry({ author })}</feed>`, feed);
  assert.equal(parse('Jason T. Wright')[0].source, 'Jason Wright');
  assert.deepEqual(parse('Jason Wright'), []);
  assert.deepEqual(parse('Jason A. Wright'), []);
  assert.equal(feed.affiliation, 'Penn State University');
});

test('recognizes Chris Olah and Christopher Olah while rejecting author mentions', () => {
  const feed = SCIENTIST_FEEDS.find(feed => feed.name === 'Chris Olah');
  for (const author of ['Chris Olah', 'Christopher Olah']) {
    const xml = `<feed>${atomEntry({ author })}</feed>`;
    assert.equal(parseScientistPublications(xml, feed)[0].source, 'Chris Olah');
  }
  const xml = `<feed>${atomEntry({ author: 'Another Researcher' }).replace('An abstract.', 'A paper discussing Chris Olah.')}</feed>`;
  assert.deepEqual(parseScientistPublications(xml, feed), []);
});

test('recognizes both publication name orders used by Fei-Fei Li', () => {
  const feed = SCIENTIST_FEEDS.find(feed => feed.name === 'Fei-Fei Li');
  for (const author of ['Fei-Fei Li', 'Li Fei-Fei']) {
    assert.equal(parseScientistPublications(`<feed>${atomEntry({ author })}</feed>`, feed)[0].source, 'Fei-Fei Li');
  }
});

test('matches both verified George Church ORCIDs and retains synthetic biology metadata', () => {
  const feed = SCIENTIST_FEEDS.find(feed => feed.name === 'George Church');
  for (const orcid of [feed.orcid, ...feed.orcidAliases]) {
    const data = JSON.stringify({ resultList: { result: [{ ...paper, authorList: { author: [{ authorId: { type: 'ORCID', value: orcid } }] } }] } });
    const [item] = parseScientistPublications(data, feed);
    assert.equal(item.source, 'George Church');
    assert.ok(item.description.includes(feed.affiliation));
    assert.ok(item.description.includes(feed.researchFocus));
  }
  const unrelated = JSON.stringify({ resultList: { result: [paper] } });
  assert.deepEqual(parseScientistPublications(unrelated, feed), []);
});
