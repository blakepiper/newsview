const { XMLParser } = require('fast-xml-parser');

// Researcher identities and author-name variants verified against publication records.
const PUBLICATION_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const SCIENTISTS = [
  { name: 'Karl Friston', orcid: '0000-0001-7984-8909' },
  { name: 'Michael Levin', orcid: '0000-0001-7292-8084' },
  { name: 'Chris Fields', orcid: '0000-0002-4812-0744' },
  { name: 'Geoffrey Hinton', provider: 'arxiv', authorNames: ['Geoffrey Hinton', 'Geoffrey E. Hinton', 'Geoffrey Everest Hinton'] },
  { name: 'Yann LeCun', provider: 'arxiv', authorNames: ['Yann LeCun', 'Yann Le Cun', 'Yann A. LeCun'] },
  { name: 'Percy Liang', provider: 'arxiv', authorNames: ['Percy Liang'] },
  { name: 'Stuart Russell', provider: 'arxiv', authorNames: ['Stuart Russell', 'Stuart J. Russell', 'Stuart Jonathan Russell'] },
  { name: 'Yoshua Bengio', provider: 'arxiv', authorNames: ["Yoshua Bengio"] },
  { name: 'Fei-Fei Li', provider: 'arxiv', authorNames: ["Fei-Fei Li", "Fei Fei Li", "Li Fei-Fei", "Li Fei Fei"] },
  { name: 'Yejin Choi', provider: 'arxiv', authorNames: ["Yejin Choi"] },
  { name: 'Dawn Song', provider: 'arxiv', authorNames: ["Dawn Song"] },
  { name: 'Chris Olah', provider: 'arxiv', authorNames: ["Chris Olah", "Christopher Olah"] },
  { name: 'Neel Nanda', provider: 'arxiv', authorNames: ["Neel Nanda"] },
  { name: 'Paul Christiano', provider: 'arxiv', authorNames: ["Paul Christiano", "Paul F. Christiano"] },
  { name: 'Dan Hendrycks', provider: 'arxiv', authorNames: ["Dan Hendrycks"] },
  { name: 'Myles Allen', provider: 'crossref', orcid: '0000-0002-1721-7172', affiliation: 'University of Oxford' },
  { name: 'Piers Forster', provider: 'crossref', orcid: '0000-0002-6078-0171', affiliation: 'University of Leeds' },
  { name: 'Gavin Schmidt', provider: 'crossref', orcid: '0000-0002-2258-0486', affiliation: 'NASA Goddard Institute for Space Studies' },
  { name: 'Friederike Otto', provider: 'crossref', orcid: '0000-0001-8166-5917', affiliation: 'Imperial College London' },
  { name: 'Richard Alley', provider: 'crossref', orcid: '0000-0003-1833-0115', affiliation: 'Penn State University' },
  { name: 'Corinne Le Quéré', provider: 'crossref', orcid: '0000-0003-2319-0452', affiliation: 'University of East Anglia' },
  { name: 'Marshall Burke', provider: 'crossref', orcid: '0000-0003-4288-5858', affiliation: 'Stanford University' },
  { name: 'Jesse Jenkins', provider: 'crossref', orcid: '0000-0002-9670-7793', affiliation: 'Princeton University' },
  { name: 'Michael Mann', provider: 'crossref', orcid: '0000-0003-3067-296X', affiliation: 'University of Pennsylvania' },
  { name: 'Zeke Hausfather', provider: 'crossref', orcid: '0000-0002-2926-0581', affiliation: 'Berkeley Earth / UC Berkeley affiliate' },
  { name: 'Matt Kaeberlein', orcid: '0000-0002-1311-3421', affiliation: 'University of Washington + Optispan' },
  { name: 'Valter Longo', orcid: '0000-0002-0946-7534', affiliation: 'USC' },
  { name: 'David Sinclair', orcid: '0000-0002-9936-436X', affiliation: 'Harvard Medical School' },
  { name: 'Steve Horvath', orcid: '0000-0002-4110-3589', affiliation: 'UCLA' },
  { name: 'Michael Snyder', orcid: '0000-0003-0784-7987', affiliation: 'Stanford University' },
  { name: 'Herman Pontzer', orcid: '0000-0003-2397-6543', affiliation: 'Duke University' },
  { name: 'Vishwa Deep Dixit', orcid: '0000-0002-5341-6494', affiliation: 'Yale University' },
  { name: 'Rhonda Patrick', affiliation: 'FoundMyFitness', authorQuery: 'AUTH:"Patrick RP"', authorNames: ['Rhonda Patrick', 'Rhonda P Patrick', 'Rhonda Percivalle Patrick'], affiliationPatterns: ['foundmyfitness', "children's hospital oakland", 'st. jude'] },
  { name: 'Peter Attia', affiliation: 'Early Medical', authorQuery: 'AUTH:"Attia P"', authorNames: ['Peter Attia'], affiliationPatterns: ['early medical', 'attia medical', 'national cancer institute'] },
  { name: 'Chris Masterjohn', affiliation: 'Independent / Mitome', authorQuery: 'AUTH:"Masterjohn C"', authorNames: ['Chris Masterjohn', 'Christopher Masterjohn'], affiliationPatterns: ['university of connecticut', 'brooklyn college', 'mitome'] },
  { name: 'Lisa Kaltenegger', provider: 'arxiv', affiliation: 'Cornell University', authorNames: ["Lisa Kaltenegger"] },
  { name: 'Nikku Madhusudhan', provider: 'arxiv', affiliation: 'University of Cambridge', authorNames: ["Nikku Madhusudhan"] },
  { name: 'Sara Seager', provider: 'arxiv', affiliation: 'MIT', authorNames: ["Sara Seager"] },
  { name: 'David Kipping', provider: 'arxiv', affiliation: 'Columbia University', authorNames: ["David Kipping", "David M. Kipping"] },
  { name: 'Victoria Meadows', provider: 'arxiv', affiliation: 'University of Washington', authorNames: ["Victoria Meadows", "Victoria S. Meadows"] },
  { name: 'Ravi Kopparapu', provider: 'arxiv', affiliation: 'NASA Goddard Space Flight Center', authorNames: ["Ravi Kopparapu", "Ravi K. Kopparapu", "Ravi Kumar Kopparapu"] },
  { name: 'Jessie Christiansen', provider: 'arxiv', affiliation: 'Caltech / NASA Exoplanet Science Institute', authorNames: ["Jessie Christiansen", "Jessie L. Christiansen"] },
  { name: 'Kevin Hand', provider: 'arxiv', affiliation: 'NASA Jet Propulsion Laboratory', authorNames: ["Kevin Hand", "Kevin P. Hand"] },
  { name: 'Sara Imari Walker', provider: 'arxiv', affiliation: 'Arizona State University', authorNames: ["Sara Imari Walker", "Sara I. Walker"] },
  { name: 'Jason Wright', provider: 'arxiv', affiliation: 'Penn State University', authorNames: ["Jason T. Wright"] },
  { name: 'Jennifer Doudna', orcid: '0000-0001-9161-999X', affiliation: 'UC Berkeley', researchFocus: 'CRISPR-Cas systems, genome editing and discovery of new programmable genetic tools' },
  { name: 'Feng Zhang', orcid: '0000-0003-0178-7995', affiliation: 'MIT + Broad Institute', researchFocus: 'CRISPR, Cas13, genome engineering, gene delivery and discovery of new programmable biological systems' },
  { name: 'David Liu', orcid: '0000-0002-9943-7557', affiliation: 'Harvard University + Broad Institute', researchFocus: 'Base editing, prime editing, directed protein evolution and precision genome engineering' },
  { name: 'George Church', orcid: '0000-0001-6232-9969', orcidAliases: ['0000-0003-3535-2076'], affiliation: 'Harvard Medical School', researchFocus: 'Synthetic genomes, genome rewriting, sequencing, cell engineering and large-scale genetic engineering' },
  { name: 'Jay Keasling', orcid: '0000-0003-4170-6088', affiliation: 'UC Berkeley + Lawrence Berkeley National Laboratory', researchFocus: 'Metabolic engineering and programming microbes to manufacture chemicals, fuels and medicines' },
  { name: 'James Collins', orcid: '0000-0002-5560-8246', affiliation: 'MIT', researchFocus: 'Synthetic gene circuits, engineered microbes, biological computation, diagnostics and therapeutics' },
  { name: 'Pamela Silver', orcid: '0000-0002-7856-4071', affiliation: 'Harvard Medical School', researchFocus: 'Synthetic cells, biological computers, engineered metabolic pathways and living sensors' },
  { name: 'Drew Endy', orcid: '0000-0001-6952-8098', affiliation: 'Stanford University', researchFocus: 'Foundational synthetic biology, standardized biological components, genome refactoring and engineered organisms' },
  { name: 'Timothy Lu', orcid: '0000-0002-3918-8923', affiliation: 'MIT', researchFocus: 'Synthetic gene circuits, programmable bacteria, engineered therapeutics and microbiome engineering' },
  { name: 'Cameron Myhrvold', orcid: '0000-0002-8971-184X', affiliation: 'Princeton University', researchFocus: 'Next-generation CRISPR systems, Cas13, programmable RNA manipulation and synthetic nucleic-acid technology' },
];

const SCIENTIST_FEEDS = SCIENTISTS.map(scientist => {
  if (scientist.provider === 'crossref') {
    const url = new URL('https://api.crossref.org/works');
    url.search = new URLSearchParams({
      filter: `orcid:${scientist.orcid}`, sort: 'published', order: 'desc', rows: '100',
    }).toString();
    return { ...scientist, url: url.href, parser: 'scientist-publications', maxAgeMs: PUBLICATION_MAX_AGE_MS,
      headers: { 'User-Agent': 'BlakeNewsNow/0.4 (climate publication monitor)' } };
  }
  if (scientist.provider === 'arxiv') {
    const url = new URL('https://export.arxiv.org/api/query');
    url.search = new URLSearchParams({
      search_query: scientist.authorNames.map(name => `au:"${name}"`).join(' OR '),
      sortBy: 'submittedDate', sortOrder: 'descending', max_results: '100',
    }).toString();
    return { ...scientist, url: url.href, parser: 'scientist-publications', maxAgeMs: PUBLICATION_MAX_AGE_MS };
  }
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.search = new URLSearchParams({
    query: `${scientist.authorQuery || [scientist.orcid, ...(scientist.orcidAliases || [])].map(orcid => `AUTHORID:${orcid}`).join(' OR ')} sort_date:y`,
    format: 'json',
    resultType: 'core',
    pageSize: '100',
  }).toString();
  return { ...scientist, url: url.href, parser: 'scientist-publications', maxAgeMs: PUBLICATION_MAX_AGE_MS };
});

function parseScientistPublications(data, scientist) {
  if (scientist.provider === 'crossref') return parseCrossrefPublications(data, scientist);
  if (scientist.provider === 'arxiv') return parseArxivPublications(data, scientist);
  const document = JSON.parse(data);
  if (!Array.isArray(document.resultList?.result)) throw new Error('Invalid Europe PMC publication response');
  const seen = new Set();
  return document.resultList.result.flatMap(paper => {
    const authors = paper.authorList?.author;
    if (!Array.isArray(authors) || !authors.some(author => matchesEuropePmcAuthor(author, scientist))) return [];
    const title = String(paper.title || '').replace(/<[^>]*>/g, '').trim();
    const rawDate = paper.firstPublicationDate;
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate || '')) return [];
    const pubDate = new Date(`${rawDate}T00:00:00Z`);
    if (!Number.isFinite(pubDate.getTime()) || pubDate.toISOString().slice(0, 10) !== rawDate) return [];
    const doi = typeof paper.doi === 'string' ? paper.doi.trim() : '';
    const link = /^10\.\d{4,9}\/\S+$/i.test(doi)
      ? `https://doi.org/${encodeURIComponent(doi)}`
      : paper.source && paper.id
        ? `https://europepmc.org/article/${encodeURIComponent(paper.source)}/${encodeURIComponent(paper.id)}`
        : '';
    const key = doi.toLowerCase() || title.toLowerCase();
    if (!link || seen.has(key)) return [];
    seen.add(key);
    const journal = paper.journalInfo?.journal?.title || 'Europe PMC';
    const preprint = paper.source === 'PPR' ? 'Preprint · ' : '';
    const abstract = String(paper.abstractText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return [{
      title, source: scientist.name, pubDate, link, publisher: journal,
      contentType: preprint ? 'preprint' : 'publication',
      description: `${preprint}${journal}${scientist.affiliation ? ` · ${scientist.affiliation}` : ''}${scientist.researchFocus ? ` · Research focus: ${scientist.researchFocus}` : ''} · ${paper.authorString || scientist.name}${abstract ? ` — ${abstract}` : ''}`,
    }];
  });
}

const atomParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });
const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
const normalizeName = name => String(name || '').normalize('NFKC').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function matchesEuropePmcAuthor(author, scientist) {
  if (scientist.orcid) return author.authorId?.type === 'ORCID' && [scientist.orcid, ...(scientist.orcidAliases || [])].includes(author.authorId.value);
  // Full given name plus the same author's affiliation prevents namesake matches.
  const fullName = normalizeName(`${author.firstName || ''} ${author.lastName || ''}`);
  if (!scientist.authorNames.some(name => normalizeName(name) === fullName)) return false;
  const affiliations = asArray(author.authorAffiliationDetailsList?.authorAffiliation)
    .map(entry => cleanText(entry.affiliation).toLowerCase());
  return affiliations.some(affiliation => scientist.affiliationPatterns.some(pattern => affiliation.includes(pattern)));
}

function parseArxivPublications(data, scientist) {
  const document = atomParser.parse(data);
  if (!Object.hasOwn(document, 'feed')) throw new Error('Invalid arXiv publication response');
  const names = new Set(scientist.authorNames.map(normalizeName));
  const seen = new Set();
  return asArray(document.feed.entry).flatMap(paper => {
    const authors = asArray(paper.author).map(author => cleanText(author.name));
    if (!authors.some(author => names.has(normalizeName(author)))) return [];
    const title = cleanText(paper.title);
    const pubDate = new Date(paper.published || '');
    const idMatch = String(paper.id || '').match(/^https?:\/\/arxiv\.org\/abs\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?$/);
    if (!title || !Number.isFinite(pubDate.getTime()) || !idMatch || seen.has(idMatch[1])) return [];
    seen.add(idMatch[1]);
    const journal = cleanText(paper.journal_ref);
    const summary = cleanText(paper.summary);
    return [{
      title, source: scientist.name, pubDate, publisher: 'arXiv', contentType: 'preprint',
      link: `https://arxiv.org/abs/${idMatch[1]}`,
      description: `${journal ? `arXiv · Published in ${journal}` : 'Preprint · arXiv'}${scientist.affiliation ? ` · ${scientist.affiliation}` : ''} · ${authors.join(', ')}${summary ? ` — ${summary}` : ''}`,
    }];
  });
}

function crossrefDate(value) {
  const parts = value?.['date-parts']?.[0];
  // Never substitute deposit/indexing time or invent a day for a year-only date.
  if (!Array.isArray(parts) || parts.length !== 3 || !parts.every(Number.isInteger)) return null;
  const [year, month, day] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function parseCrossrefPublications(data, scientist) {
  const document = JSON.parse(data);
  if (!Array.isArray(document.message?.items)) throw new Error('Invalid Crossref publication response');
  const seen = new Set();
  const allowedTypes = new Set(['journal-article', 'proceedings-article', 'posted-content', 'report', 'book-chapter']);
  return document.message.items.flatMap(paper => {
    if (!allowedTypes.has(paper.type) || !Array.isArray(paper.author)) return [];
    const matches = paper.author.some(author =>
      String(author.ORCID || '').replace(/^https?:\/\/orcid\.org\//i, '').toUpperCase() === scientist.orcid.toUpperCase()
    );
    if (!matches) return [];
    const title = cleanText(asArray(paper.title)[0]);
    const doi = String(paper.DOI || '').trim();
    const dates = [paper['published-online'], paper['published-print'], paper.published]
      .map(crossrefDate).filter(Boolean).sort((a, b) => a - b);
    const pubDate = dates[0];
    if (!title || !pubDate || !/^10\.\d{4,9}\/\S+$/i.test(doi) || seen.has(doi.toLowerCase())) return [];
    seen.add(doi.toLowerCase());
    const authors = paper.author.map(author => cleanText(`${author.given || ''} ${author.family || ''}`)).filter(Boolean);
    const journal = cleanText(asArray(paper['container-title'])[0]) || 'Crossref';
    const abstract = cleanText(paper.abstract);
    const label = paper.type === 'posted-content' ? 'Preprint · ' : '';
    return [{
      title, source: scientist.name, pubDate, publisher: cleanText(paper.publisher) || journal,
      contentType: label ? 'preprint' : 'publication',
      link: `https://doi.org/${encodeURIComponent(doi)}`,
      description: `${label}${journal} · ${scientist.affiliation} · ${authors.join(', ')}${abstract ? ` — ${abstract}` : ''}`,
    }];
  });
}

module.exports = { SCIENTIST_FEEDS, parseScientistPublications };
