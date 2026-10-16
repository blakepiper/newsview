// Shared by the browser and Node; publication dates and freshness have one policy.
export const SCIENTIST_SOURCES = ['Karl Friston', 'Michael Levin', 'Chris Fields', 'Geoffrey Hinton', 'Yann LeCun', 'Percy Liang', 'Stuart Russell',
  'Yoshua Bengio', 'Fei-Fei Li', 'Yejin Choi', 'Dawn Song', 'Chris Olah', 'Neel Nanda', 'Paul Christiano', 'Dan Hendrycks',
  'Myles Allen', 'Piers Forster', 'Gavin Schmidt', 'Friederike Otto', 'Richard Alley', 'Corinne Le Quéré', 'Marshall Burke', 'Jesse Jenkins', 'Michael Mann', 'Zeke Hausfather',
  'Matt Kaeberlein', 'Valter Longo', 'David Sinclair', 'Steve Horvath', 'Michael Snyder', 'Herman Pontzer', 'Vishwa Deep Dixit', 'Rhonda Patrick', 'Peter Attia', 'Chris Masterjohn',
  'Lisa Kaltenegger', 'Nikku Madhusudhan', 'Sara Seager', 'David Kipping', 'Victoria Meadows', 'Ravi Kopparapu', 'Jessie Christiansen', 'Kevin Hand', 'Sara Imari Walker', 'Jason Wright',
  'Jennifer Doudna', 'Feng Zhang', 'David Liu', 'George Church', 'Jay Keasling', 'James Collins', 'Pamela Silver', 'Drew Endy', 'Timothy Lu', 'Cameron Myhrvold',
];
export const FINANCE_PATTERNS = {
  stocks: /\b(?:stocks?|equities|equity markets?|stock markets?|share prices?|shares (?:rise|fall|surge|slide|jump|drop|gain|sink)|earnings|revenues?|quarterly (?:results|profits?|sales)|dividends?|buybacks?|market capitali[sz]ation|s&p(?:\s*500)?|nasdaq|dow jones|wall street|ftse|nikkei|hang seng|dax)\b/i,
  ipos: /\b(?:ipos?|initial public offerings?|direct listings?|public (?:offerings?|listings?|debuts?)|going public|go(?:es)? public|spacs?|s-1 filings?)\b/i,
  crypto: /\b(?:crypto(?:currenc(?:y|ies))?|bitcoin|ethereum|ether|stablecoins?|blockchain|defi|tokenization|digital assets?|altcoins?|coinbase|binance|solana)\b/i,
  trade: /\b(?:tariffs?|trade wars?|trade (?:deals?|talks|agreements?|policy|policies|disputes?|barriers?|deficits?|surpluses?)|(?:import|customs) dut(?:y|ies)|anti[- ]dumping|export (?:controls?|bans?|restrictions?)|(?:goods|chemical|oil|diesel|chip|semiconductor|steel|energy) (?:imports?|exports?)|protectionism|sanctions?|world trade organization|wto)\b/i,
  macro: /\b(?:macroeconom(?:ics?|y)|global econom(?:y|ic)|econom(?:y|ies|ic)|inflation|deflation|recession|gdp|interest rates?|central banks?|federal reserve|the fed|ecb|bank of (?:england|japan)|monetary policy|fiscal policy|unemployment|jobs report|payrolls?|treasur(?:y|ies)|bond (?:yields?|markets?|trade)|sovereign debt|currenc(?:y|ies)|exchange rates?|(?:oil|diesel|petrol) prices?|crude oil|oil and diesel|opec|commodit(?:y|ies)|bullion|gold market|housing (?:market|crisis)|energy (?:costs|prices|bills)|cost of living)\b/i,
};
export const FINANCE_SOURCE_TOPICS = {
  'SEC': 'stocks',
  'CoinDesk': 'crypto',
  'CNBC IPOs': 'ipos',
  'WTO News': 'trade',
  'Federal Reserve': 'macro',
  'ECB': 'macro',
  'BLS': 'macro',
  'EIA': 'macro',
  'CNBC Economy': 'macro',
};
const BROADER_FINANCE = /\b(?:financ(?:e|ial)|invest(?:ing|ments?|ors?)|banking|bankruptcy|mergers?|acquisitions?|hedge funds?|private equity|venture capital|mortgages?|credit|insurance|derivatives|liquidity|prediction markets?)\b/i;
export function financeTopics(item) {
  const text = item.title + ' ' + (item.description || '');
  const topics = Object.keys(FINANCE_PATTERNS).filter(topic => FINANCE_PATTERNS[topic].test(text));
  const sourceTopic = FINANCE_SOURCE_TOPICS[item.source];
  if (sourceTopic && !topics.includes(sourceTopic)) topics.push(sourceTopic);
  return topics;
}
export function isFinanceEntry(item) {
  return financeTopics(item).length > 0 || BROADER_FINANCE.test(item.title + ' ' + (item.description || ''));
}

Object.assign(FINANCE_SOURCE_TOPICS, {
  'BEA': 'macro', 'Bank of Japan': 'macro', 'USTR': 'trade',
  'Federal Register Trade': 'trade', 'SEC IPO Filings': 'ipos', 'SEC Foreign IPO Filings': 'ipos',
  'CFTC': 'crypto', 'Ethereum Foundation': 'crypto',
});

const WINDOWS = { 'PNAS': 30, 'The Markup': 90, 'Bellingcat': 30, 'Congress.gov': 90,
  'Alexandria City': 30, 'Alexandria Council': 30, 'GitHub Engineering': 30 };
export function sourceWindowDays(source) {
  return SCIENTIST_SOURCES.includes(source) ? 180 : WINDOWS[source] || 7;
}

const OFFICIAL = new Set(['White House', 'Defense.gov', 'Congress.gov', 'CISA', 'NOAA',
  'SEC', 'SEC IPO Filings', 'SEC Foreign IPO Filings', 'Federal Reserve', 'BLS', 'BEA',
  'EIA', 'ECB', 'WTO News', 'Bank of Japan', 'USTR', 'Federal Register Trade', 'CFTC',
  'FDA Press Releases', 'FDA Recalls', 'CDC Travel Notices', 'NASA', 'WHO',
  'Alexandria City', 'Alexandria Council', 'WMATA Alerts']);
const VENDORS = new Set(['OpenAI News', 'Google AI', 'AWS News', 'Cloudflare',
  'GitHub Engineering', 'GitHub Security', 'Ethereum Foundation']);
const JOURNALS = new Set(['Nature', 'Science', 'PNAS', 'Cell', 'Science Advances', 'eLife',
  'PLOS ONE', 'The Lancet', 'NEJM', 'Frontiers in Psychology', 'Human Factors', 'Ergonomics']);
const SUMMARIES = new Set(['ScienceDaily', 'Phys.org', 'Neuroscience News Psychology']);
export function sourceKind(source) {
  if (SCIENTIST_SOURCES.includes(source)) return 'author';
  if (OFFICIAL.has(source)) return 'official';
  if (VENDORS.has(source)) return 'vendor';
  if (JOURNALS.has(source)) return 'journal';
  if (SUMMARIES.has(source)) return 'summary';
  if (source === 'GDELT' || source === 'Lobsters' || source === 'Hacker News'
    || source.startsWith('c/') || source.startsWith('Lemmy ')
    || ['Mastodon Trending', 'Bluesky Discover'].includes(source)) return 'discovery';
  if (/^(?:4chan )?\/\w+\/$/.test(source)) return 'discussion';
  return 'reporting';
}

export function publisherIdentity(source) {
  const publishers = { 'BBC Business': 'BBC', 'Guardian Business': 'Guardian',
    'AAAS Science News': 'AAAS', 'Science': 'AAAS', 'Science Advances': 'AAAS',
    'CNBC Economy': 'CNBC', 'CNBC IPOs': 'CNBC', 'SEC IPO Filings': 'SEC',
    'SEC Foreign IPO Filings': 'SEC', 'GitHub Engineering': 'GitHub', 'GitHub Security': 'GitHub' };
  return publishers[source] || source;
}

export function canonicalArticleLink(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|at_)/i.test(key) || /^(?:fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    // A revision of the same arXiv paper remains one publication.
    if (url.hostname === 'arxiv.org' || url.hostname === 'export.arxiv.org') {
      url.hostname = 'arxiv.org';
      url.pathname = url.pathname.replace(/^\/pdf\//, '/abs/').replace(/(?:v\d+)?(?:\.pdf)?$/, '');
    }
    return url.toString().replace(/^http:/, 'https:');
  } catch { return value.trim(); }
}

// Explicit advertising markers, not incidental phrases such as state-sponsored violence.
export function isPromotionalEntry(item) {
  const title = String(item.title || '');
  const text = title + ' ' + (item.description || '');
  return /\b(?:sponsored (?:content|feature|post)|paid (?:content|post|partnership)|advertorial|promo(?:tion)? codes?|coupon codes?|discount codes?|products from our advertisers)\b/i.test(text)
    || /^(?:sponsored|advertisement|partner content)\s*[:—-]/i.test(title)
    || /\/(?:coupons?|sponsored|deals)(?:\/|[-?])/i.test(item.link || '')
    || /\b(?:newsletter|best deals|deals for|best .+ to buy|best e-readers|how to collect cds)\b/i.test(title);
}

export function entryContentType(item) {
  const kind = sourceKind(item.source);
  const text = item.title + ' ' + (item.description || '');
  if (/\b(?:preprint|arxiv\.org)\b/i.test(text + ' ' + item.link)) return 'preprint';
  if (/^(?:opinion|editorial|commentary|perspective)\s*[:—-]/i.test(item.title) || /\/(?:opinion|opinionista|editorials?)\//i.test(item.link) || /\b(?:opinion|editorial|commentary)\b/i.test(item.entryCategory || '')) return 'opinion';
  if (/\b(?:book review|books? and arts|interview)\b/i.test(text)) return 'review / interview';
  if (kind === 'journal') return 'journal content'; // Not an assertion of peer review.
  if (kind === 'summary') return 'research summary';
  if (kind === 'author') return 'publication';
  if (kind === 'official') return 'official';
  if (kind === 'vendor') return 'company announcement';
  if (kind === 'discussion') return 'discussion';
  if (kind === 'discovery') return 'discovery';
  if (/\/(?:reviews|buying-guides|shopping)\//i.test(item.link)) return 'buying guide';
  return 'reporting';
}
