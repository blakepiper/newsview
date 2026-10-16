/**
 * BlakeNewsNow Data Feeds
 * Fetches headlines from RSS and financial data from Yahoo/CoinGecko
 */

const crypto = require('crypto');
const path = require('node:path');
const { FeedSnapshots } = require('./feed-snapshots.cjs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const { filterRecentItems, parseRSS, isHttpUrl } = require('./rss.cjs');
const { SCIENTIST_FEEDS } = require('./scientist-publications.cjs');
const { parseConfiguredSource, socialProvenance } = require('./source-adapters.cjs');
const { sourceWindowDays, sourceKind, publisherIdentity, canonicalArticleLink, isPromotionalEntry, isFinanceEntry, entryContentType } = require('../shared/source-policy.js');

function stableId(prefix, title, source) {
  const hash = crypto.createHash('md5').update(`${source}:${title}`).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function selectDiverseItems(items, limit, perSourceCap) {
  const selected = new Set();
  const sourceCounts = new Map();
  // Reserve one item for every active source before prolific publishers fill slots.
  for (const item of items) {
    if (!sourceCounts.has(item.source) && selected.size < limit) {
      selected.add(item);
      sourceCounts.set(item.source, 1);
    }
  }
  for (const item of items) {
    if (selected.has(item)) continue;
    const count = sourceCounts.get(item.source) || 0;
    if (count < perSourceCap && selected.size < limit) {
      selected.add(item);
      sourceCounts.set(item.source, count + 1);
    }
  }
  for (const item of items) {
    if (selected.size >= limit) break;
    selected.add(item);
  }
  return items.filter(item => selected.has(item));
}

const LOCAL_BETTING_TERMS = /\b(?:betmgm|prophetx|kalshi|polymarket|draftkings|fanduel|bet365|caesars(?: sportsbook)?|fanatics sportsbook|sportsbook|sports betting|prediction markets?|betting odds|parlay|wager|jackpot)\b/i;
const LOCAL_ADULT_TERMS = /\b(?:cam sites?|camgirls?|webcam models?|adult (?:sites?|content|entertainment)|porn(?:ographic)?|onlyfans|xxx sites?|live sex|trans cams?)\b/i;
const LOCAL_PROMOTION_MARKERS = /\b(?:promo(?:tion)? code|bonus code|bonus bets?|promo bets?|sign[- ]?up bonus|exclusive offer|advertis(?:er|ing)|sponsored(?: content)?|affiliate|products from our advertisers|partners?|coupon|discount code|free spins|claim(?:ing)? \$?[\d,]+|get \$?[\d,]+)\b/i;
const LOCAL_COMMERCIAL_LISTICLE = /\b(?:top|best)\s+\d+\b[\s\S]{0,80}\b(?:sites?|platforms?|services?|apps?|products?)\b/i;

function isLocalAdOrPromotion(item) {
  const title = String(item?.title || '');
  const description = String(item?.description || '');
  const text = `${title} ${description}`;

  if (LOCAL_ADULT_TERMS.test(text) || LOCAL_COMMERCIAL_LISTICLE.test(title)) return true;
  if (/\b(?:sponsored(?: content)?|affiliate|advertiser(?:s)?|products from our advertisers|our partners?)\b/i.test(text)) return true;
  if (LOCAL_PROMOTION_MARKERS.test(text)) return true;
  return LOCAL_BETTING_TERMS.test(title) && /\b(?:code|bonus|offer|promo|claim|get)\b/i.test(title);
}

const localFeedFilter = item => !isLocalAdOrPromotion(item);

function isLocalCoverage(item) {
  return /\b(?:washington|d\.?c\.?|alexandria|virginia|maryland|arlington|fairfax|loudoun|prince (?:william|george)|montgomery|wmata|metro|beltway|chesapeake|potomac)\b/i
    .test(`${item.title} ${item.description || ''} ${item.link || ''}`.replace(/https?:\/\/wtop\.com/, ''));
}

// Some federal sites (sec.gov, bls.gov) reject the generic browser agent and want a
// self-identifying client instead.
const DECLARED_USER_AGENT = 'BlakeNewsNow/0.4 RSS reader';

// ============================================
// RSS Feed Configuration
// ============================================
const RSS_FEEDS = {
  headlines: [
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'CBC News', url: 'https://www.cbc.ca/cmlink/rss-world' },
    { name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-top' },
    { name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'Haaretz', url: 'https://www.haaretz.com/srv/haaretz-latest-headlines' },
    { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories' },
    { name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main' },
    { name: 'NY Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
    { name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
    { name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
    { name: 'Axios', url: 'https://api.axios.com/feed/' },
    { name: 'The Hill', url: 'https://thehill.com/feed/' },
    { name: 'Vox', url: 'https://www.vox.com/rss/index.xml' },
    { name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/us.xml' },
    { name: 'Politico', url: 'https://rss.politico.com/congress.xml' },
    { name: 'Semafor', url: 'https://www.semafor.com/rss.xml' },
    { name: 'The Intercept', url: 'https://theintercept.com/feed/' },
    { name: 'ProPublica', url: 'https://feeds.propublica.org/propublica/main' },
    { name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/' },
    { name: 'Breitbart', url: 'https://feeds.feedburner.com/breitbart' },
    // Free international and regional reporting
    { name: 'RFI', url: 'https://www.rfi.fr/en/rss' },
    { name: 'The Hindu', url: 'https://www.thehindu.com/feeder/default.rss' },
    { name: 'Indian Express', url: 'https://indianexpress.com/feed/' },
    { name: 'SCMP', url: 'https://www.scmp.com/rss/91/feed' },
    { name: 'El Pais', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada' },
    { name: 'Euronews', url: 'https://feeds.feedburner.com/euronews/en/news' },
    { name: 'The New Humanitarian', url: 'https://www.thenewhumanitarian.org/rss/all.xml' },
    { name: 'Daily Maverick', url: 'https://www.dailymaverick.co.za/dmrss/' },
    { name: 'Global Voices', url: 'https://globalvoices.org/feed/' },
    { name: 'African Arguments', url: 'https://africanarguments.org/feed/' },
    { name: 'The Conversation', url: 'https://theconversation.com/us/articles.atom' },
    // Free official and primary reporting
    { name: 'White House', url: 'https://www.whitehouse.gov/news/feed/' },
    { name: 'Defense.gov', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945' },
    { name: 'Congress.gov', url: 'https://www.congress.gov/rss/most-viewed-bills.xml', maxAgeMs: 90 * 24 * 60 * 60 * 1000 },
    { name: 'CISA', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml' },
    { name: 'NOAA', url: 'https://www.noaa.gov/rss.xml' },
    {
      name: 'FDA Press Releases',
      url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml',
    },
    {
      name: 'FDA Recalls',
      url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml',
    },
    { name: 'CDC Travel Notices', url: 'https://wwwnc.cdc.gov/travel/rss/notices.xml' },
    // Free verification and investigative reporting
    { name: 'FactCheck.org', url: 'https://www.factcheck.org/feed/' },
    { name: 'Snopes', url: 'https://www.snopes.com/feed/' },
    { name: 'ICIJ', url: 'https://www.icij.org/feed/' },
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/', maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  ],
  finance: [
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
    { name: 'Wall Street Journal', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain' },
    {
      // sec.gov 403s the generic default agent and redirects the legacy /rss path.
      name: 'SEC',
      url: 'https://www.sec.gov/news/pressreleases.rss',
      headers: { 'User-Agent': DECLARED_USER_AGENT },
    },
    { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
    {
      // bls.gov 403s the generic default agent.
      name: 'BLS',
      url: 'https://www.bls.gov/feed/bls_latest.rss',
      headers: { 'User-Agent': DECLARED_USER_AGENT },
    },
    { name: 'EIA', url: 'https://www.eia.gov/rss/todayinenergy.xml' },
    { name: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
    { name: 'CNBC IPOs', url: 'https://www.cnbc.com/id/10000666/device/rss/rss.html' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'Guardian Business', url: 'https://www.theguardian.com/business/rss' },
    { name: 'ECB', url: 'https://www.ecb.europa.eu/rss/press.html' },
    { name: 'WTO News', url: 'https://www.wto.org/library/rss/latest_news_e.xml' },
    { name: 'BEA', url: 'https://apps.bea.gov/rss/rss.xml' },
    { name: 'USTR', url: 'https://ustr.gov/about-us/policy-offices/press-office/press-releases', parser: 'ustr-html' },
    { name: 'Federal Register Trade', url: 'https://www.federalregister.gov/api/v1/documents.json?per_page=50&order=newest&conditions[term]=tariff', parser: 'federal-register' },
    { name: 'SEC IPO Filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&company=&dateb=&owner=include&start=0&count=40&output=atom', headers: { 'User-Agent': DECLARED_USER_AGENT }, nativeFetch: true },
    { name: 'SEC Foreign IPO Filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=F-1&company=&dateb=&owner=include&start=0&count=40&output=atom', headers: { 'User-Agent': DECLARED_USER_AGENT }, nativeFetch: true },
    { name: 'Bank of Japan', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml' },
    { name: 'CFTC', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', nativeFetch: true },
    { name: 'Ethereum Foundation', url: 'https://blog.ethereum.org/en/feed.xml' },
  ],
  tech: [
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/creators/index.xml' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    {
      name: 'Wired',
      url: 'https://www.wired.com/feed/rss',
      filter: item => !/(promo codes?|coupons?|discount codes?|deals? for)/i.test(item.title),
    },
    { name: 'Lobsters', url: 'https://lobste.rs/rss' },
    { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    {
      name: 'BleepingComputer',
      url: 'https://www.bleepingcomputer.com/feed/',
      headers: { 'User-Agent': 'BlakeNewsNow/0.4 (RSS reader)' },
    },
    { name: 'Rest of World', url: 'https://restofworld.org/feed/latest/' },
    { name: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
    {
      name: '404 Media',
      url: 'https://www.404media.co/rss/',
      filter: item => !/^podcast:/i.test(item.title),
    },
    { name: 'KrebsOnSecurity', url: 'https://krebsonsecurity.com/feed/' },
    { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
    { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss' },
    { name: 'The Markup', url: 'https://themarkup.org/feeds/rss.xml', maxAgeMs: 90 * 24 * 60 * 60 * 1000 },
    { name: 'GitHub Engineering', url: 'https://github.blog/engineering/feed/' },
    { name: 'GitHub Security', url: 'https://github.blog/security/feed/' },
    { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
    { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
    { name: 'AWS News', url: 'https://aws.amazon.com/blogs/aws/feed/' },
    { name: 'Cloudflare', url: 'https://blog.cloudflare.com/rss/' },
  ],
  science: [
    // Science news and explanatory reporting
    { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
    { name: 'Phys.org', url: 'https://phys.org/rss-feed/' },
    { name: 'Science News', url: 'https://www.sciencenews.org/feed' },
    { name: 'Live Science', url: 'https://www.livescience.com/feeds/all' },
    { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
    { name: 'NASA', url: 'https://www.nasa.gov/feed/' },
    { name: 'AAAS Science News', url: 'https://www.science.org/rss/news_current.xml' },
    { name: 'APS Psychology', url: 'https://www.psychologicalscience.org/feed' },
    {
      name: 'Neuroscience News Psychology',
      url: 'https://neurosciencenews.com/neuroscience-topics/psychology/feed/',
    },
    // Primary journals and journal publishers
    {
      name: 'Nature',
      url: 'https://www.nature.com/nature.rss',
      filter: item => !/^(author |publisher )?correction:|^retraction note:/i.test(item.title),
    },
    { name: 'Science', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science' },
    {
      name: 'PNAS',
      url: 'https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas',
      filter: item => !/^in this issue$/i.test(item.title),
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    },
    { name: 'Cell', url: 'https://www.cell.com/cell/current.rss' },
    { name: 'Science Advances', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=sciadv' },
    {
      name: 'eLife',
      url: 'https://elifesciences.org/rss/recent.xml',
      headers: { 'User-Agent': 'BlakeNewsNow/0.4 (RSS reader)' },
    },
    {
      name: 'PLOS ONE',
      url: 'https://journals.plos.org/plosone/feed/atom',
      filter: item => !/^(correction|retraction|expression of concern):/i.test(item.title),
    },
    { name: 'The Lancet', url: 'https://www.thelancet.com/rssfeed/lancet_current.xml' },
    { name: 'NEJM', url: 'https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm' },
    {
      name: 'Frontiers in Psychology',
      url: 'https://www.frontiersin.org/journals/psychology/rss',
      filter: item => !/^(corrigendum|retraction|expression of concern):/i.test(item.title),
    },
    {
      name: 'Human Factors',
      url: 'https://journals.sagepub.com/action/showFeed?feed=rss&jc=hfs&type=etoc',
      filter: item => !/^(correction|retraction):/i.test(item.title),
    },
    {
      name: 'Ergonomics',
      url: 'https://www.tandfonline.com/feed/rss/terg20',
      filter: item => !/^(correction|retraction):/i.test(item.title),
    },
    // Climate, health, and earth-system reporting
    {
      name: 'Carbon Brief',
      url: 'https://www.carbonbrief.org/feed/',
      headers: { 'User-Agent': 'BlakeNewsNow/0.4 (RSS reader)' },
    },
    {
      name: 'Mongabay',
      url: 'https://news.mongabay.com/feed/',
      headers: { 'User-Agent': 'BlakeNewsNow/0.4 (RSS reader)' },
    },
    { name: 'STAT', url: 'https://www.statnews.com/feed/' },
    { name: 'WHO', url: 'https://www.who.int/api/news/newsitems?$orderby=PublicationDateAndTime%20desc&$top=30', parser: 'who-json' },
    { name: 'KFF Health News', url: 'https://kffhealthnews.org/feed/' },
    { name: 'Undark', url: 'https://undark.org/feed/' },
    ...SCIENTIST_FEEDS,
  ],
  local: [
    { name: 'WMATA Alerts', url: 'https://www.wmata.com/ride/alerts-and-advisories/_jcr_content/root/container/row-container/main-container/main-editable/alerts_advisories_li.results.json', parser: 'wmata', filter: localFeedFilter },
    { name: 'Alexandria Council', url: 'https://webapi.legistar.com/v1/alexandria/events?$orderby=EventDate%20desc&$top=100', parser: 'legistar', filter: localFeedFilter },
    { name: 'WTOP', url: 'https://wtop.com/local/feed/', filter: item => localFeedFilter(item) && isLocalCoverage(item) },
    { name: 'WAMU', url: 'https://wamu.org/feed/', filter: localFeedFilter },
    { name: 'Alexandria City', url: 'https://www.alexandriava.gov/News', parser: 'alexandria-html', maxAgeMs: 30 * 24 * 60 * 60 * 1000, filter: localFeedFilter },
    { name: 'Alexandria Times', url: 'https://alextimes.com/feed/', filter: localFeedFilter },
    { name: 'ALXnow', url: 'https://www.alxnow.com/feed/', filter: localFeedFilter },
    { name: 'Virginia Mercury', url: 'https://www.virginiamercury.com/feed/', filter: localFeedFilter },
    // feeds.washingtonpost.com routinely needs 8-10s to answer.
    { name: 'Washington Post Local', url: 'https://feeds.washingtonpost.com/rss/local', filter: localFeedFilter, timeout: 20000 },
    { name: 'DC News Now', url: 'https://www.dcnewsnow.com/feed/', filter: localFeedFilter },
    { name: 'Washington City Paper', url: 'https://washingtoncitypaper.com/feed/', filter: localFeedFilter },
    { name: 'Washington Blade', url: 'https://www.washingtonblade.com/feed/', filter: localFeedFilter },
  ],
  ticker: [
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Google Trends', url: 'https://trends.google.com/trending/rss?geo=US' },
    { name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
  ],
};

// Server and client share freshness, rather than silently overriding source windows.
for (const feeds of Object.values(RSS_FEEDS)) for (const feed of feeds) {
  feed.maxAgeMs = sourceWindowDays(feed.name) * 86400000;
  const kind = sourceKind(feed.name);
  feed.pollIntervalMs = kind === 'author' ? 6 * 60 * 60 * 1000
    : ['The Markup', 'Bellingcat', 'GitHub Engineering'].includes(feed.name) ? 30 * 60 * 1000
      : kind === 'official' ? 10 * 60 * 1000 : 60 * 1000;
}

const LEMMY_COMMUNITIES = ['news', 'world', 'technology', 'politics', 'science'];
const BLUESKY_DISCOVER_FEED = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

// Hacker News API base
const HN_API = 'https://hacker-news.firebaseio.com/v0';


// ============================================
// Simple in-memory cache
// ============================================
const cache = {
  headlines: { data: null, timestamp: 0 },
  tech: { data: null, timestamp: 0 },
  finance: { data: null, timestamp: 0 },
  science: { data: null, timestamp: 0 },
  local: { data: null, timestamp: 0 },
  gdelt: { data: null, timestamp: 0 },
  macro: { data: null, timestamp: 0 },
  ticker: { data: null, timestamp: 0 },
  markets: { data: null, timestamp: 0 },
  crypto: { data: null, timestamp: 0 },
  weather: { data: null, timestamp: 0 },
  radar: { data: null, timestamp: 0 },
  predictions: { data: null, timestamp: 0 },
  polymarket: { data: null, timestamp: 0 },
  kalshi: { data: null, timestamp: 0 },
  pizzint: { data: null, timestamp: 0 },
  lemmy: { data: null, timestamp: 0 },
  openSocial: { data: null, timestamp: 0 },
  hackernews: { data: null, timestamp: 0 },
  fourchan: { data: null, timestamp: 0 },
  geocode: {},  // zip -> {lat, lon} cache
};

const CACHE_TTL = {
  headlines: 60 * 1000,  // 1 minute
  finance: 60 * 1000,    // 1 minute
  tech: 60 * 1000,       // 1 minute
  science: 60 * 1000,    // 1 minute
  local: 60 * 1000,       // 1 minute
  gdelt: 5 * 60 * 1000,   // Public GDELT endpoint asks clients to poll slowly
  macro: 5 * 60 * 1000,
  ticker: 60 * 1000,     // 1 minute
  markets: 30 * 1000,    // 30 seconds
  crypto: 60 * 1000,     // 1 minute
  weather: 5 * 60 * 1000, // 5 minutes
  radar: 2 * 60 * 1000,   // 2 minutes
  predictions: 60 * 1000, // 1 minute
  polymarket: 5 * 60 * 1000,
  kalshi: 5 * 60 * 1000,
  pizzint: 5 * 60 * 1000,
  lemmy: 2 * 60 * 1000,
  openSocial: 2 * 60 * 1000,
  hackernews: 2 * 60 * 1000, // 2 minutes
  fourchan: 2 * 60 * 1000,   // 2 minutes
};

const CONTENT_MAX_AGE = {
  headlines: 7 * 24 * 60 * 60 * 1000,
  finance: 7 * 24 * 60 * 60 * 1000,
  tech: 7 * 24 * 60 * 60 * 1000,
  science: 7 * 24 * 60 * 60 * 1000,
  ticker: 2 * 24 * 60 * 60 * 1000,
};

const inFlightRequests = new Map();
let gdeltBackoffUntil = 0;

function dedupeRequest(key, loader) {
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);
  const request = Promise.resolve()
    .then(loader)
    .finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, request);
  return request;
}

// Default location (Alexandria, VA - zip 22314)
const DEFAULT_ZIP = '22314';

function isCacheValid(key) {
  const entry = cache[key];
  if (!entry) return false;
  if (!entry.data || (Date.now() - entry.timestamp) >= CACHE_TTL[key]) return false;
  return true;
}

const feedDiagnostics = new Map();

function normalizedFeedItem(item, prefix) {
  return {
    id: stableId(prefix, item.title, item.source), title: item.title, source: item.source,
    timestamp: item.pubDate.toISOString(), link: item.link, description: item.description?.slice(0, 4000),
    ...(item.image ? { image: item.image } : {}),
    publisher: item.publisher || publisherIdentity(item.source), sourceKind: sourceKind(item.source),
    contentType: item.contentType || entryContentType(item),
    timestampKind: item.timestampKind || 'published',
    maxAgeDays: sourceWindowDays(item.source),
    ...(item.documentUrl ? { documentUrl: item.documentUrl } : {}),
    ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
  };
}

function normalizeCategoryItems(items, prefix) {
  const seen = new Set();
  return items.filter(item => filterRecentItems([item], { maxAgeMs: sourceWindowDays(item.source) * 86400000 }).length)
    .sort((a, b) => b.pubDate - a.pubDate).filter(item => {
      // Keep different publishers/coauthors for selection and briefing provenance.
      const key = `${item.source}:${canonicalArticleLink(item.link)}:${item.title.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => normalizedFeedItem(item, prefix));
}

function parseRequestedSources(value, feeds) {
  if (value === undefined) return null;
  const allowed = new Set(feeds.map(feed => feed.name));
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return new Set(raw.split(',').map(x => x.trim()).filter(x => allowed.has(x)));
}

function selectCategoryItems(items, requested, limit, cap) {
  return selectDiverseItems(requested === null ? items : items.filter(x => requested.has(x.source)), limit, cap);
}

const snapshots = new FeedSnapshots(process.env.FEED_CACHE_DIR || path.join(__dirname, '../.newsview-cache/feeds'));
const feedAttempts = new Map();
const providerQueues = new Map();
const POOL_BUDGET_MS = 1000;
const snapshotKeys = new WeakMap();
function snapshotKey(category, feed) {
  // Invalidate when configuration or editorial policies change.
  if (snapshotKeys.get(feed)?.[category]) return snapshotKeys.get(feed)[category];
  const key = crypto.createHash('sha256').update(JSON.stringify([category, feed, String(feed.filter),
    String(isPromotionalEntry), String(isFinanceEntry), String(sourceWindowDays)])).digest('hex');
  snapshotKeys.set(feed, { ...snapshotKeys.get(feed), [category]: key });
  return key;
}
function currentSnapshotItems(category, feed, maxAgeMs = feed.maxAgeMs, now = Date.now()) {
  return (snapshots.get(snapshotKey(category, feed))?.items || []).filter(item => {
    if (!item || item.source !== feed.name || typeof item.title !== 'string' || !isHttpUrl(item.link)) return false;
    const time = Date.parse(item.timestamp);
    return Number.isFinite(time) && time <= now && now - time <= maxAgeMs
      && (!item.expiresAt || Date.parse(item.expiresAt) > now);
  });
}
function currentCategoryItems(category) {
  const now = Date.now();
  return RSS_FEEDS[category].flatMap(feed => currentSnapshotItems(category, feed, feed.maxAgeMs, now))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function scheduleFeed(feed, task) {
  const delay = feed.provider === 'arxiv' ? 3100 : feed.provider === 'crossref' ? 1500 : 0;
  if (!delay) return task();
  const request = (providerQueues.get(feed.provider) || Promise.resolve()).then(task);
  providerQueues.set(feed.provider, request.catch(() => {}).then(() => new Promise(resolve => {
    const timer = setTimeout(resolve, delay); timer.unref();
  })));
  return request;
}
async function loadCategoryPool(category, prefix, requested = null) {
  const feeds = RSS_FEEDS[category].filter(feed => requested === null || requested.has(feed.name));
  const pending = [];
  for (const feed of feeds) {
    const key = snapshotKey(category, feed);
    const existing = snapshots.get(key);
    if (existing && Date.now() - existing.at < feed.pollIntervalMs) continue;
    const requestKey = `parsed:${key}`;
    if (!inFlightRequests.has(requestKey) && Date.now() - (feedAttempts.get(key) || 0) < 60000) continue;
    pending.push(dedupeRequest(requestKey, () => scheduleFeed(feed, async () => {
      feedAttempts.set(key, Date.now());
      try {
        const options = { accept: feed.parser && !['alexandria-html', 'ustr-html'].includes(feed.parser)
          ? feed.provider === 'arxiv' ? 'application/atom+xml' : 'application/json'
          : 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html' };
        const { data } = await fetchConfiguredFeed(feed, options);
        const parsed = parseConfiguredSource(data, feed);
        if (!parsed.length && !['scientist-publications', 'legistar', 'wmata'].includes(feed.parser)) {
          throw new Error('Response contains no parseable entries');
        }
        const dated = filterRecentItems(parsed, { maxAgeMs: feed.maxAgeMs });
        const eligible = dated.filter(item => !isPromotionalEntry(item) && (!feed.filter || feed.filter(item))
          && (category !== 'finance' || isFinanceEntry(item)));
        const newest = parsed.filter(x => x.pubDate && Number.isFinite(+x.pubDate) && +x.pubDate <= Date.now()).sort((a, b) => b.pubDate - a.pubDate)[0];
        feedDiagnostics.set(feed.name, { checkedAt: new Date().toISOString(), parsed: parsed.length,
          itemCount: eligible.length, filtered: dated.length - eligible.length, newestDate: newest?.pubDate.toISOString() || null,
          state: !eligible.length ? sourceKind(feed.name) === 'author' ? 'no-recent-publications' : 'no-recent-items' : 'ok' });
        snapshots.set(key, normalizeCategoryItems(eligible, prefix));
      } catch (err) {
        feedDiagnostics.set(feed.name, { ...feedDiagnostics.get(feed.name), checkedAt: new Date().toISOString(), state: 'unavailable', error: describeError(err).slice(0, 160) });
        console.error(`[DATA] ${feed.name}:`, describeError(err));
      }
    })));
  }
  // On a warm start the validated snapshot is immediate. Cold requests have a
  // bounded wait while slow providers continue filling their individual caches.
  if (!currentCategoryItems(category).some(item => requested === null || requested.has(item.source))) {
    await withBudget(Promise.all(pending), POOL_BUDGET_MS, null);
  }
  const result = currentCategoryItems(category);
  cache[category] = { data: result, timestamp: Date.now() };
  return result;
}

function getSourceHealth() {
  const feeds = [...new Map(Object.values(RSS_FEEDS).flat().map(feed => [feed.name, feed])).values(),
    ...['GDELT', 'Hacker News', 'Bluesky Discover', 'Mastodon Trending', ...LEMMY_COMMUNITIES.map(name => 'c/' + name), '/news/', '/pol/', '/lit/', '/his/', '/g/'].map(name => ({ name }))];
  return feeds.map(feed => {
    const transport = sourceHealth.get(feed.name) || {};
    const category = Object.keys(RSS_FEEDS).find(key => RSS_FEEDS[key].includes(feed));
    const stored = category && snapshots.get(snapshotKey(category, feed));
    const content = feedDiagnostics.get(feed.name) || (stored ? { state: 'cached', checkedAt: new Date(stored.at).toISOString(), itemCount: stored.items.length, newestDate: stored.items[0]?.timestamp } : {});
    return { name: feed.name, kind: sourceKind(feed.name), windowDays: sourceWindowDays(feed.name),
      lastAttempt: transport.lastAttempt || content.checkedAt || null, lastSuccess: transport.lastSuccess || null,
      retryAt: transport.until > Date.now() ? new Date(transport.until).toISOString() : null,
      state: transport.failures ? 'unavailable' : content.state || (transport.lastSuccess ? 'retrieved' : 'not-checked'),
      itemCount: content.itemCount ?? null, newestDate: content.newestDate || null,
      error: transport.failures ? transport.error : content.state === 'unavailable' ? content.error?.replace(/HTTP (\d+):[\s\S]*/, 'HTTP $1') : undefined };
  });
}

// ============================================
// HTTP Fetch Helper
// ============================================

// One process serves every feed category, so an unbounded `Promise.all` over the
// feed lists opens ~110 TLS connections at once. Home routers and consumer links
// drop most of them, which surfaces as ETIMEDOUT on sources that respond fine on
// their own. Cap outbound requests instead and let the rest queue.
const OUTBOUND_CONCURRENCY = Math.max(1, Number(process.env.FEED_CONCURRENCY) || 12);
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

// Node abandons each Happy Eyeballs connection attempt after 250ms by default. On a
// host with no global IPv6 route every AAAA attempt fails instantly and the A attempt
// has to complete a TCP handshake inside that window, so ordinary latency to a distant
// CDN surfaces as `AggregateError: ETIMEDOUT`. Give each attempt room to finish.
const CONNECT_ATTEMPT_TIMEOUT_MS = Math.max(
  250,
  Number(process.env.FEED_CONNECT_ATTEMPT_TIMEOUT_MS) || 5000
);

const agentOptions = {
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: OUTBOUND_CONCURRENCY,
  autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT_MS,
};
const httpsAgent = new https.Agent(agentOptions);
const httpAgent = new http.Agent(agentOptions);

let activeRequests = 0;
const pendingRequests = [];

function acquireRequestSlot() {
  if (activeRequests < OUTBOUND_CONCURRENCY) {
    activeRequests += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => pendingRequests.push(resolve));
}

function releaseRequestSlot() {
  const next = pendingRequests.shift();
  if (next) next();
  else activeRequests -= 1;
}

async function withRequestSlot(task) {
  await acquireRequestSlot();
  try {
    return await task();
  } finally {
    releaseRequestSlot();
  }
}

// `AggregateError` from happy-eyeballs connects and undici's `TypeError: fetch failed`
// both carry an empty or useless `message`, which logged as bare "SourceName failed:".
function describeError(error, depth = 0) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (depth > 2) return error.message || error.code || 'unknown error';

  if (Array.isArray(error.errors) && error.errors.length) {
    const causes = [...new Set(error.errors.map(inner => inner?.code || inner?.message).filter(Boolean))];
    return `${error.code || error.name || 'AggregateError'} (${causes.slice(0, 3).join(', ')})`;
  }

  const name = error.name === 'Error' || error.name === 'TypeError' ? '' : error.name;
  const label = error.message || error.code || name || 'unknown error';
  if (error.cause) return `${label}: ${describeError(error.cause, depth + 1)}`;
  return error.code && !label.includes(error.code) ? `${label} (${error.code})` : label;
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.name === 'TimeoutError') return true;
  if (RETRYABLE_CODES.has(error.code)) return true;
  if (error.message === 'Request timeout') return true;
  if (Array.isArray(error.errors) && error.errors.some(isRetryableError)) return true;
  return error.cause ? isRetryableError(error.cause) : false;
}

async function withRetry(task, { attempts = 2, label = '' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableError(error)) break;
      if (label) console.warn(`[DATA] ${label}: ${describeError(error)} — retrying`);
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError;
}

function decompressResponse(res) {
  switch ((res.headers['content-encoding'] || '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return res.pipe(zlib.createGunzip());
    case 'deflate':
      return res.pipe(zlib.createInflate());
    case 'br':
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

// Performs a single round trip. Returns `{ redirect }` instead of following it so the
// caller can release its concurrency slot between hops.
function sendRequest(url, options) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reject(new Error('Invalid URL'));
    }
    if (!isSafePublicUrl(parsedUrl)) {
      return reject(new Error('URL must point to a public HTTP(S) host'));
    }
    const isHttps = parsedUrl.protocol === 'https:';
    const protocol = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      agent: isHttps ? httpsAgent : httpAgent,
      autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': options.accept || '*/*',
        // Feed XML compresses roughly ten to one; without this the pool moves several
        // megabytes per refresh and slow transfers start tripping the request timeout.
        'Accept-Encoding': 'gzip, deflate, br',
        ...options.headers,
      },
      timeout: options.timeout || DEFAULT_REQUEST_TIMEOUT_MS,
    };

    const req = protocol.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let redirect;
        try {
          redirect = new URL(res.headers.location, parsedUrl).href;
        } catch {
          return reject(new Error(`Invalid redirect target from ${parsedUrl.host}`));
        }
        return resolve({ redirect });
      }

      let body;
      try {
        body = decompressResponse(res);
      } catch (err) {
        res.resume();
        return reject(err);
      }

      let data = '';
      body.setEncoding('utf8');
      body.on('error', err => {
        req.destroy();
        reject(err);
      });
      let bytes = 0;
      body.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 8 * 1024 * 1024) { body.destroy(new Error('Feed exceeds 8 MiB')); req.destroy(); return; }
        data += chunk;
      });
      body.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data, status: res.statusCode });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 100)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });

    req.end();
  });
}

// A source that is down (or has blocked us) otherwise burns its full timeout budget on
// every refresh, which both slows the response and keeps hammering the origin. Park it
// after repeated failures and try again after a growing cooldown.
const BREAKER_THRESHOLD = 3;
const BREAKER_BASE_COOLDOWN_MS = 5 * 60 * 1000;
const BREAKER_MAX_COOLDOWN_MS = 60 * 60 * 1000;
const sourceHealth = new Map();

function breakerKey(url, label) {
  if (label) return label;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function breakerCooldownRemaining(key) {
  const health = sourceHealth.get(key);
  if (!health || !health.until) return 0;
  return Math.max(0, health.until - Date.now());
}

function recordSourceSuccess(key) {
  sourceHealth.set(key, { ...sourceHealth.get(key), failures: 0, until: 0,
    lastSuccess: new Date().toISOString(), lastAttempt: new Date().toISOString() });
}

function recordSourceFailure(key, error) {
  const health = sourceHealth.get(key) || { failures: 0, until: 0 };
  health.failures += 1;
  health.lastAttempt = new Date().toISOString();
  health.error = error ? describeError(error).replace(/HTTP (\d+):[\s\S]*/, 'HTTP $1').slice(0, 120) : 'Request failed';
  if (health.failures >= BREAKER_THRESHOLD) {
    const backoff = BREAKER_BASE_COOLDOWN_MS * 2 ** Math.min(20, health.failures - BREAKER_THRESHOLD);
    health.until = Date.now() + Math.min(backoff, BREAKER_MAX_COOLDOWN_MS);
  }
  sourceHealth.set(key, health);
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

// Runs `task` under the breaker for `key`: refuses immediately while the source is
// parked, and records the outcome so repeated failures widen the cooldown.
async function withBreaker(key, task) {
  const cooldown = breakerCooldownRemaining(key);
  if (cooldown > 0) {
    const { failures } = sourceHealth.get(key);
    throw new Error(
      `skipped after ${failures} consecutive failures, retrying in ${formatDuration(cooldown)}`
    );
  }

  try {
    const result = await task();
    recordSourceSuccess(key);
    return result;
  } catch (error) {
    recordSourceFailure(key, error);
    throw error;
  }
}

function fetch(url, options = {}) {
  return withBreaker(breakerKey(url, options.label), () => withRetry(async () => {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const result = await withRequestSlot(() => sendRequest(currentUrl, options));
      if (!result.redirect) return result;
      currentUrl = result.redirect;
    }
    throw new Error('Too many redirects');
  }, { attempts: options.retries ?? 2, label: options.label }));
}

async function fetchConfiguredFeed(feed, options = {}) {
  return dedupeRequest(`feed:${feed.url}:${JSON.stringify(feed.headers || {})}`, () => requestConfiguredFeed(feed, options));
}

async function requestConfiguredFeed(feed, options = {}) {
  const requestOptions = {
    ...options,
    timeout: feed.timeout || options.timeout,
    headers: { ...feed.headers, ...options.headers },
    label: feed.name,
  };

  if (!feed.nativeFetch) {
    return fetch(feed.url, requestOptions);
  }

  return withBreaker(feed.name, () => withRetry(() => withRequestSlot(async () => {
    const response = await globalThis.fetch(feed.url, {
      headers: {
        Accept: options.accept || '*/*',
        'User-Agent': 'Mozilla/5.0',
        ...requestOptions.headers,
      },
      signal: AbortSignal.timeout(requestOptions.timeout || DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Feed exceeds 8 MiB'); }
      chunks.push(value);
    }
    return { data: Buffer.concat(chunks).toString('utf8'), status: response.status };
  }), { attempts: options.retries ?? 2, label: feed.name }));
}

function isSafePublicUrl(value) {
  const parsed = value instanceof URL ? value : new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const isPrivateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(hostname);
  const isPrivateIpv6 = hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:');
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port.match(/^(?!80$|443$)\d+$/) &&
    hostname !== 'localhost' &&
    !hostname.endsWith('.local') &&
    !hostname.endsWith('.internal') &&
    hostname !== 'metadata.google.internal' &&
    !isPrivateIpv4 &&
    !isPrivateIpv6
  );
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num));
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, '').trim();
}

function parseGdeltDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second)
  ));
  return Number.isFinite(date.getTime()) ? date : null;
}

// Resolves with `fallback` if `promise` has not settled within `budgetMs`. The original
// promise keeps running so a slow source can still warm its own cache.

function withBudget(promise, budgetMs, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), budgetMs);
    timer.unref?.();
    const settle = value => {
      clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(fallback));
  });
}

async function fetchGdeltArticles() {
  if (isCacheValid('gdelt')) return cache.gdelt.data;
  if (Date.now() < gdeltBackoffUntil) return cache.gdelt.data || [];

  try {
    const query = new URLSearchParams({
      query: 'sourcelang:english',
      mode: 'artlist',
      format: 'json',
      maxrecords: '30',
      sort: 'datedesc',
    });
    const { data } = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${query}`, {
      accept: 'application/json',
      timeout: 12000,
      // GDELT only supplements the pool, and headlines wait on it, so fail fast
      // instead of spending a second full timeout on a retry.
      retries: 1,
      label: 'GDELT',
    });
    const document = JSON.parse(data);
    const result = (document.articles || []).flatMap(article => {
      const title = typeof article.title === 'string' ? article.title.trim() : '';
      const link = typeof article.url === 'string' ? article.url : '';
      const pubDate = parseGdeltDate(article.seendate);
      let safeLink = false;
      try {
        safeLink = isSafePublicUrl(link);
      } catch {
        safeLink = false;
      }
      if (!title || !safeLink || !pubDate) return [];
      return [{
        title,
        link,
        pubDate,
        description: article.domain ? `Indexed from ${article.domain}` : '',
        source: 'GDELT', publisher: article.domain || new URL(link).hostname, timestampKind: 'indexed',
      }];
    });
    if (result.length > 0) cache.gdelt = { data: result, timestamp: Date.now() };
    return result.length > 0 ? result : cache.gdelt.data || [];
  } catch (err) {
    console.error('[GDELT]', describeError(err));
    // A failed fetch leaves the cache empty, so without a real backoff every headline
    // refresh re-queries GDELT and earns another 429 from an endpoint that asks for one
    // request every five seconds. Rest for a full cache period instead.
    if (/HTTP 429/.test(err.message)) gdeltBackoffUntil = Date.now() + CACHE_TTL.gdelt;
    return cache.gdelt.data || [];
  }
}

// ============================================
// Fetch Headlines
// ============================================
async function loadHeadlinePool(requested = null) {
  const rss = await loadCategoryPool('headlines', 'headline', requested);
  if (requested !== null && !requested.has('GDELT')) return rss;
  const gdeltRequest = dedupeRequest('gdelt-pool', fetchGdeltArticles);
  const gdelt = cache.gdelt.data || (rss.length ? [] : await withBudget(gdeltRequest, POOL_BUDGET_MS, []));
  return [...rss, ...gdelt.map(item => normalizedFeedItem(item, 'headline'))]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function selectHeadlineItems(items, requestedSources = null) {
  const eligible = requestedSources === null
    ? items
    : items.filter(item => requestedSources.has(item.source));
  return selectDiverseItems(eligible, 80, 5);
}

async function fetchHeadlines(requestedSources = null) {
  if (requestedSources?.size === 0) return [];
  const pool = await loadHeadlinePool(requestedSources);
  return selectHeadlineItems(pool, requestedSources);
}

function parseRequestedHeadlineSources(value) {
  if (value === undefined) return null;
  const allowedSources = new Set([...RSS_FEEDS.headlines.map(feed => feed.name), 'GDELT']);
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return new Set(
    raw
      .split(',')
      .map(source => source.trim())
      .filter(source => allowedSources.has(source))
  );
}

// ============================================
// Fetch Ticker Items
// ============================================
async function fetchTicker() {
  if (isCacheValid('ticker')) {
    return cache.ticker.data;
  }

  console.log('[DATA] Fetching ticker...');

  // Fetch all feeds in parallel for speed
  const feedResults = await Promise.all(
    RSS_FEEDS.ticker.map(async (feed) => {
      try {
        const { data } = await fetchConfiguredFeed(feed, {
          accept: 'application/rss+xml, application/xml, text/xml',
        });
        return filterRecentItems(parseRSS(data, feed.name), { maxAgeMs: CONTENT_MAX_AGE.ticker });
      } catch (err) {
        console.error(`[DATA] Ticker ${feed.name} failed:`, describeError(err));
        return [];
      }
    })
  );

  const allItems = feedResults.flat();

  // Sort by date and take recent items
  allItems.sort((a, b) => b.pubDate - a.pubDate);

  const seen = new Set();
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const result = selectDiverseItems(unique, 30, 8).map((item, idx) => ({
    id: `ticker-${idx}`,
    text: item.title,
    source: item.source,
    category: categorizeHeadline(item.title, item.source),
  }));

  cache.ticker = { data: result, timestamp: Date.now() };
  return result;
}

function categorizeHeadline(title, source) {
  const lower = title.toLowerCase();

  // Google Trends items are always trending
  if (source === 'Google Trends') {
    return 'trending';
  }

  if (lower.includes('breaking') || lower.includes('just in') || lower.includes('urgent')) {
    return 'breaking';
  }
  if (lower.includes('stock') || lower.includes('market') || lower.includes('dow') ||
      lower.includes('nasdaq') || lower.includes('s&p') || lower.includes('bitcoin') ||
      lower.includes('crypto') || lower.includes('fed ') || lower.includes('inflation')) {
    return 'markets';
  }
  if (lower.includes('trending') || lower.includes('viral')) {
    return 'trending';
  }
  return 'general';
}

// ============================================
// Fetch Market Data (Yahoo Finance)
// ============================================
async function fetchMarkets() {
  if (isCacheValid('markets')) {
    return cache.markets.data;
  }

  console.log('[DATA] Fetching markets...');

  const symbols = [
    { symbol: '^GSPC', name: 'S&P 500', display: 'SPX' },
    { symbol: '^DJI', name: 'Dow Jones', display: 'DJI' },
    { symbol: '^IXIC', name: 'NASDAQ', display: 'IXIC' },
    { symbol: '^RUT', name: 'Russell 2000', display: 'RUT' },
    { symbol: '^FTSE', name: 'FTSE 100 · UK', display: 'FTSE' },
    { symbol: '^GDAXI', name: 'DAX · Germany', display: 'DAX' },
    { symbol: '^N225', name: 'Nikkei 225 · Japan', display: 'N225' },
    { symbol: '^HSI', name: 'Hang Seng · Hong Kong', display: 'HSI' },
  ];

  const movers = [
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'META', name: 'Meta' },
    { symbol: 'AMD', name: 'AMD' },
    { symbol: 'NFLX', name: 'Netflix' },
    { symbol: 'CRM', name: 'Salesforce' },
  ];

  const results = {
    indices: [],
    movers: [],
  };

  // Fetch all quotes in parallel for speed
  const allQuotes = await Promise.all([
    ...symbols.map(async ({ symbol, name, display }) => {
      try {
        const data = await fetchYahooQuote(symbol);
        return data ? { type: 'index', symbol: display, quoteSymbol: symbol, name, ...data } : null;
      } catch (err) {
        console.error(`[DATA] ${symbol} failed:`, describeError(err));
        return null;
      }
    }),
    ...movers.map(async ({ symbol, name }) => {
      try {
        const data = await fetchYahooQuote(symbol);
        return data ? { type: 'mover', symbol, name, ...data } : null;
      } catch (err) {
        console.error(`[DATA] ${symbol} failed:`, describeError(err));
        return null;
      }
    }),
  ]);

  // Separate indices and movers from results
  for (const quote of allQuotes) {
    if (!quote) continue;
    if (quote.type === 'index') {
      results.indices.push({
        symbol: quote.symbol,
        quoteSymbol: quote.quoteSymbol || quote.symbol, asOf: quote.asOf, fetchedAt: quote.fetchedAt, currency: quote.currency,
        name: quote.name,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      });
    } else {
      results.movers.push({
        symbol: quote.symbol,
        asOf: quote.asOf, fetchedAt: quote.fetchedAt, currency: quote.currency,
        name: quote.name,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      });
    }
  }

  // Sort movers by absolute change percent
  results.movers.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  cache.markets = { data: results, timestamp: Date.now() };
  return results;
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  try {
    const { data } = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    const json = JSON.parse(data);
    const result = json.chart?.result?.[0];

    if (!result) return null;

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) return null;
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;

    return {
      asOf: Number.isFinite(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      fetchedAt: new Date().toISOString(), currency: meta.currency || null,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    };
  } catch (err) {
    console.error(`[YAHOO] ${symbol}:`, describeError(err));
    return null;
  }
}

// ============================================
// Fetch Crypto Data (CoinGecko)
// ============================================
async function fetchCrypto() {
  if (isCacheValid('crypto')) {
    return cache.crypto.data;
  }

  console.log('[DATA] Fetching crypto...');

  const coins = ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'cardano', 'ripple'];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;

  try {
    const { data } = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const json = JSON.parse(data);

    const result = [
      { symbol: 'BTC', name: 'Bitcoin', ...formatCoinGecko(json.bitcoin) },
      { symbol: 'ETH', name: 'Ethereum', ...formatCoinGecko(json.ethereum) },
      { symbol: 'SOL', name: 'Solana', ...formatCoinGecko(json.solana) },
      { symbol: 'DOGE', name: 'Dogecoin', ...formatCoinGecko(json.dogecoin) },
      { symbol: 'ADA', name: 'Cardano', ...formatCoinGecko(json.cardano) },
      { symbol: 'XRP', name: 'Ripple', ...formatCoinGecko(json.ripple) },
    ].filter(c => c.price);

    cache.crypto = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.error('[COINGECKO]', describeError(err));
    return cache.crypto.data || [];
  }
}

function formatCoinGecko(data) {
  if (!data) return { price: null };
  const price = data.usd;
  if (!Number.isFinite(data.usd) || data.usd <= 0) return { price: null };
  const changePercent = data.usd_24h_change || 0;
  const change = price * (changePercent / 100);
  return {
    asOf: Number.isFinite(data.last_updated_at) ? new Date(data.last_updated_at * 1000).toISOString() : null,
    fetchedAt: new Date().toISOString(), currency: 'USD',
    price,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
  };
}

// ============================================
// Fetch free macroeconomic data (FRED)
// ============================================
async function fetchFredSeries(series) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series.id)}&cosd=2025-01-01`;
  // FRED's CSV endpoint intermittently stalls when accessed through the
  // generic RSS request helper, so use Node's native fetch for this fixed,
  // public endpoint.
  const response = await globalThis.fetch(url, {
    headers: {
      Accept: 'text/csv',
      'User-Agent': 'BlakeNewsNow/0.4 (macro reader)',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.text();
  const rows = data
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(line => {
      const [date, rawValue] = line.split(',');
      const value = Number(rawValue);
      return { date, value, rawValue };
    })
    .filter(row => row.date && row.rawValue?.trim() && row.rawValue !== '.' && Number.isFinite(row.value));
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  if (!latest) return null;
  return {
    id: series.id,
    name: series.name,
    unit: series.unit,
    value: latest.value,
    previousValue: previous?.value ?? null,
    change: previous ? latest.value - previous.value : null,
    date: latest.date,
    url: `https://fred.stlouisfed.org/series/${encodeURIComponent(series.id)}`,
    source: 'FRED',
  };
}

async function fetchMacroData() {
  if (isCacheValid('macro')) return cache.macro.data;

  const series = [
    { id: 'CPIAUCSL', name: 'US CPI (index)', unit: 'index' },
    { id: 'UNRATE', name: 'Unemployment', unit: '%' },
    { id: 'FEDFUNDS', name: 'Fed funds', unit: '%' },
    { id: 'DGS10', name: 'US 10Y Treasury', unit: '%' },
    { id: 'DEXUSEU', name: 'Euro', unit: 'USD/EUR' },
    { id: 'DEXJPUS', name: 'Japanese yen', unit: 'JPY/USD' },
    { id: 'CP0000EZ19M086NEST', name: 'Euro area CPI (index)', unit: 'index' },
  ];
  const results = await Promise.all(series.map(async item => {
    try {
      return await fetchFredSeries(item);
    } catch (err) {
      console.error(`[FRED] ${item.id} failed:`, describeError(err));
      return null;
    }
  }));
  const data = results.filter(Boolean);
  if (data.length > 0) cache.macro = { data, timestamp: Date.now() };
  return data.length > 0 ? data : cache.macro.data || [];
}

// ============================================
// Geocoding (Zip to Lat/Lon)
// ============================================

// Hardcoded zip codes for reliability
const KNOWN_ZIPS = {
  '22314': { lat: 38.8048, lon: -77.0469, display: 'Alexandria, VA' },
  '22301': { lat: 38.8206, lon: -77.0588, display: 'Alexandria, VA' },
  '22302': { lat: 38.8340, lon: -77.0742, display: 'Alexandria, VA' },
};

async function geocodeZip(zip) {
  // Check cache
  if (cache.geocode[zip]) {
    return cache.geocode[zip];
  }

  // Check hardcoded zips first (more reliable)
  if (KNOWN_ZIPS[zip]) {
    console.log(`[GEO] Using hardcoded: ${zip} -> ${KNOWN_ZIPS[zip].display}`);
    cache.geocode[zip] = KNOWN_ZIPS[zip];
    return KNOWN_ZIPS[zip];
  }

  console.log(`[GEO] Geocoding zip: ${zip}`);

  // Use Nominatim (OpenStreetMap) for geocoding
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`;

  try {
    const { data } = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const results = JSON.parse(data);
    if (results && results.length > 0) {
      const result = {
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon),
        display: results[0].display_name?.split(',')[0] || zip,
      };
      cache.geocode[zip] = result;
      console.log(`[GEO] ${zip} -> ${result.lat}, ${result.lon} (${result.display})`);
      return result;
    }
  } catch (err) {
    console.error('[GEO] Nominatim failed:', describeError(err));
  }

  return null;
}

// ============================================
// NWS API (National Weather Service)
// ============================================
async function fetchNWSWeather(lat, lon) {
  // Step 1: Get the grid point for this location
  const pointUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;

  try {
    const { data: pointData } = await fetch(pointUrl, {
      headers: {
        'Accept': 'application/geo+json',
        'User-Agent': 'BlakeNewsNow Weather Display (github.com/blakenewsnow)',
      },
    });

    const point = JSON.parse(pointData);
    const forecastUrl = point.properties?.forecast;
    const forecastHourlyUrl = point.properties?.forecastHourly;
    const observationStationsUrl = point.properties?.observationStations;
    const city = point.properties?.relativeLocation?.properties?.city || '';
    const state = point.properties?.relativeLocation?.properties?.state || '';

    if (!forecastUrl) {
      throw new Error('No forecast URL in NWS response');
    }

    // Step 2: Get current observations from nearest station
    let currentTemp = null;
    let currentCondition = null;
    let humidity = null;
    let windSpeed = null;

    if (observationStationsUrl) {
      try {
        const { data: stationsData } = await fetch(observationStationsUrl, {
          headers: {
            'Accept': 'application/geo+json',
            'User-Agent': 'BlakeNewsNow Weather Display (github.com/blakenewsnow)',
          },
        });
        const stations = JSON.parse(stationsData);
        const stationId = stations.features?.[0]?.properties?.stationIdentifier;

        if (stationId) {
          const obsUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`;
          const { data: obsData } = await fetch(obsUrl, {
            headers: {
              'Accept': 'application/geo+json',
              'User-Agent': 'BlakeNewsNow Weather Display (github.com/blakenewsnow)',
            },
          });
          const obs = JSON.parse(obsData);
          const props = obs.properties;

          // Temperature (convert C to F)
          if (props?.temperature?.value != null) {
            currentTemp = Math.round(props.temperature.value * 9/5 + 32);
          }
          currentCondition = props?.textDescription || null;
          if (props?.relativeHumidity?.value != null) {
            humidity = Math.round(props.relativeHumidity.value);
          }
          if (props?.windSpeed?.value != null) {
            // Convert m/s to mph
            windSpeed = Math.round(props.windSpeed.value * 0.621371);
          }
        }
      } catch (err) {
        console.error('[NWS] Observation fetch failed:', describeError(err));
      }
    }

    // Step 3: Get forecast
    const { data: forecastData } = await fetch(forecastUrl, {
      headers: {
        'Accept': 'application/geo+json',
        'User-Agent': 'BlakeNewsNow Weather Display (github.com/blakenewsnow)',
      },
    });
    const forecast = JSON.parse(forecastData);
    const periods = forecast.properties?.periods || [];

    // Current period for conditions if we don't have observations
    const currentPeriod = periods[0];
    if (!currentTemp && currentPeriod) {
      currentTemp = currentPeriod.temperature;
    }
    if (!currentCondition && currentPeriod) {
      currentCondition = currentPeriod.shortForecast;
    }

    // Build 5-day forecast (get day periods only)
    const dailyForecast = [];
    for (const period of periods) {
      if (period.isDaytime && dailyForecast.length < 5) {
        dailyForecast.push({
          day: period.name.substring(0, 3).toUpperCase(),
          high: period.temperature,
          low: null, // Will be filled from night period
          condition: period.shortForecast,
          icon: mapNWSIcon(period.icon),
        });
      } else if (!period.isDaytime && dailyForecast.length > 0) {
        // Fill in the low temp from night period
        const lastDay = dailyForecast[dailyForecast.length - 1];
        if (lastDay && lastDay.low === null) {
          lastDay.low = period.temperature;
        }
      }
    }

    return {
      temperature: currentTemp,
      condition: currentCondition,
      humidity: humidity,
      windSpeed: windSpeed,
      location: city && state ? `${city}, ${state}` : 'Unknown',
      high: dailyForecast[0]?.high || currentTemp,
      low: dailyForecast[0]?.low || currentTemp - 10,
      feelsLike: currentTemp, // NWS doesn't provide feels-like in observations
      forecast: dailyForecast,
    };
  } catch (err) {
    console.error('[NWS] Weather fetch failed:', describeError(err));
    return null;
  }
}

function mapNWSIcon(iconUrl) {
  // Map NWS icon URLs to our icon names
  if (!iconUrl) return 'cloudy';
  const url = iconUrl.toLowerCase();
  if (url.includes('skc') || url.includes('few') || url.includes('hot')) return 'sunny';
  if (url.includes('rain') || url.includes('showers') || url.includes('tsra')) return 'rainy';
  if (url.includes('snow') || url.includes('blizzard') || url.includes('cold')) return 'snowy';
  if (url.includes('ovc') || url.includes('bkn')) return 'cloudy';
  if (url.includes('sct') || url.includes('wind')) return 'partlyCloudy';
  return 'partlyCloudy';
}

// ============================================
// RainViewer API (Radar)
// ============================================
async function fetchRadarData() {
  // Get available radar timestamps
  const url = 'https://api.rainviewer.com/public/weather-maps.json';

  try {
    const { data } = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const json = JSON.parse(data);
    const radar = json.radar;

    if (!radar || !radar.past) {
      throw new Error('No radar data available');
    }

    // Get the most recent radar frames
    const frames = radar.past.map(frame => ({
      time: frame.time,
      path: frame.path,
    }));

    // Add nowcast (future predictions) if available
    if (radar.nowcast) {
      frames.push(...radar.nowcast.map(frame => ({
        time: frame.time,
        path: frame.path,
        isNowcast: true,
      })));
    }

    return {
      host: json.host,
      frames,
      generated: json.generated,
    };
  } catch (err) {
    console.error('[RADAR] Failed to fetch radar data:', describeError(err));
    return null;
  }
}

// ============================================
// Fetch Weather (Combined)
// ============================================
async function fetchWeather(zip = DEFAULT_ZIP) {
  const cacheKey = `weather_${zip}`;
  if (cache.weather[cacheKey] && (Date.now() - cache.weather[cacheKey].timestamp) < CACHE_TTL.weather) {
    return cache.weather[cacheKey].data;
  }

  console.log(`[WEATHER] Fetching weather for zip: ${zip}`);

  // Geocode zip to lat/lon
  const coords = await geocodeZip(zip);
  if (!coords) {
    console.error('[WEATHER] Could not geocode zip:', zip);
    return null;
  }

  // Fetch NWS weather
  const weather = await fetchNWSWeather(coords.lat, coords.lon);
  if (!weather) {
    return null;
  }

  // Add coordinates for radar
  weather.lat = coords.lat;
  weather.lon = coords.lon;

  // Override location with geocoded display name (more accurate than NWS relativeLocation)
  if (coords.display) {
    weather.location = coords.display;
  }

  // Cache result
  if (!cache.weather[cacheKey]) cache.weather[cacheKey] = {};
  cache.weather[cacheKey] = { data: weather, timestamp: Date.now() };

  return weather;
}

// ============================================
// Polymarket Predictions
// ============================================
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isSportsMarket(question) {
  return /\b(?:nba|nfl|mlb|nhl|ncaa|ufc|tennis|golf|soccer|football|basketball|baseball|hockey|boxing|mma|olympics|formula 1|nascar|pga|lakers|celtics|super bowl|world series|stanley cup|march madness|playoffs)\b|\s+vs\.?\s+/i.test(question);
}

function hasSportsMetadata(market) {
  const text = [market.question, market.title, market.slug, market.category,
    ...(market.tags || []).map(t => typeof t === 'string' ? t : t.label || t.slug),
    ...(market.events || []).flatMap(e => [e.title, e.slug, e.category, ...(e.tags || []).map(t => t.label || t.slug)]),
  ].filter(Boolean).join(' ');
  return /\b(?:sports?|nba|nfl|mlb|nhl|ncaa\w*|ufc|uefa|premier league|la liga|tennis|golf|soccer|football|basketball|baseball|hockey|cricket|boxing|olympics|touchdowns?|goals scored|world cup|super bowl)\b/i.test(text)
    || /^(?:spread|total|over\/under):/i.test(market.question || market.title || '')
    || /^Will .+ win on \d{4}-\d{2}-\d{2}\??$/i.test(market.question || '')
    || /^KX(?:MVE|NFL|NBA|MLB|NHL|NCAA|UEFA|EPL|ATP|WTA|FIFA|PGA|UFC|LALIGA|BUNDES|SOCCER|TENNIS|GOLF|CRICKET)/i.test(market.ticker || '')
    || Array.isArray(market.mve_selected_legs) && market.mve_selected_legs.length > 0;
}

function normalizePolymarketMarket(market, now = Date.now()) {
  const question = typeof market?.question === 'string' ? market.question.trim() : '';
  const volume24h = Number(market?.volume24hr);
  if (
    !market?.id ||
    !question ||
    market.closed ||
    market.archived ||
    market.active === false ||
    hasSportsMetadata(market) || isSportsMarket(question) ||
    !Number.isFinite(volume24h) ||
    volume24h < 5000
  ) {
    return null;
  }

  const marketEnd = new Date(market.endDate).getTime();
  if (Number.isFinite(marketEnd) && marketEnd <= now) return null;

  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices);
  const yesIndex = outcomes.findIndex(outcome => String(outcome).toLowerCase() === 'yes');
  const yesPrice = Number(prices[yesIndex >= 0 ? yesIndex : 0]);
  if (!Number.isFinite(yesPrice) || yesPrice < 0.02 || yesPrice > 0.98) return null;

  const events = Array.isArray(market.events) ? market.events : [];
  const currentEvent = events.find(event => {
    const end = new Date(event.endDate).getTime();
    return !event.closed && event.active !== false && (!Number.isFinite(end) || end > now);
  }) || events.find(event => event?.slug);
  const eventSlug = currentEvent?.slug || market.slug;
  if (!eventSlug) return null;

  const marketSlug = market.slug && market.slug !== eventSlug
    ? `?marketSlug=${encodeURIComponent(market.slug)}`
    : '';

  return {
    id: String(market.id),
    question,
    yesPrice: Math.round(yesPrice * 100),
    volume24h,
    volumeDisplay: formatVolume(volume24h),
    slug: market.slug,
    eventSlug,
    url: `https://polymarket.com/event/${encodeURIComponent(eventSlug)}${marketSlug}`,
    endDate: Number.isFinite(marketEnd) ? new Date(marketEnd).toISOString() : null,
    category: categorizeMarket(question),
    source: 'Polymarket',
    asOf: new Date(now).toISOString(),
  };
}

function normalizeKalshiMarket(market, now = Date.now()) {
  const question = typeof market?.title === 'string' ? market.title.trim() : '';
  const volume24h = Number(market?.volume_24h_fp);
  const yesPrice = Number(market?.last_price_dollars || market?.yes_bid_dollars);
  const marketEnd = new Date(market?.close_time || market?.expiration_time).getTime();
  if (
    !market?.ticker ||
    !question ||
    market.status !== 'active' ||
    hasSportsMetadata(market) || isSportsMarket(question) ||
    !Number.isFinite(volume24h) ||
    volume24h < 1000 ||
    !Number.isFinite(yesPrice) ||
    yesPrice < 0.02 ||
    yesPrice > 0.98 ||
    (Number.isFinite(marketEnd) && marketEnd <= now)
  ) {
    return null;
  }

  return {
    id: `kalshi-${market.ticker}`,
    question,
    yesPrice: Math.round(yesPrice * 100),
    volume24h,
    volumeDisplay: `${volume24h >= 1000 ? (volume24h / 1000).toFixed(1) + 'K' : Math.round(volume24h)} contracts`,
    slug: market.ticker,
    eventSlug: market.event_ticker || market.ticker,
    url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}/${encodeURIComponent(market.ticker)}`,
    endDate: Number.isFinite(marketEnd) ? new Date(marketEnd).toISOString() : null,
    category: categorizeMarket(question),
    source: 'Kalshi',
    volumeUnit: 'contracts',
    asOf: new Date(now).toISOString(),
  };
}

async function fetchKalshiDirect() {
  if (isCacheValid('kalshi')) return cache.kalshi.data;
  const eligible = [];
  let cursor = '';
  try {
    for (let page = 0; page < 6; page += 1) {
      const params = new URLSearchParams({ limit: '1000', status: 'open', mve_filter: 'exclude' });
      if (cursor) params.set('cursor', cursor);
      const { data } = await fetch('https://api.elections.kalshi.com/trade-api/v2/markets?' + params,
        { accept: 'application/json', timeout: 12000, label: 'Kalshi' });
      const doc = JSON.parse(data);
      eligible.push(...(doc.markets || []).map(market => normalizeKalshiMarket(market)).filter(Boolean));
      if (!doc.cursor || doc.cursor === cursor || eligible.length >= 25) break;
      cursor = doc.cursor;
    }
    const result = eligible.sort((a, b) => b.volume24h - a.volume24h).slice(0, 25);
    cache.kalshi = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.error('[KALSHI]', describeError(err));
    return eligible.length ? eligible : cache.kalshi.data || [];
  }
}

async function fetchPolymarketDirect() {
  console.log('[DATA] Fetching predictions from Polymarket...');

  const url = 'https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false&order=volume24hr&ascending=false';

  try {
    const { data } = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const markets = JSON.parse(data);

    const result = markets
      .map(market => normalizePolymarketMarket(market))
      .filter(Boolean)
      .slice(0, 25);

    if (result.length > 0) {
      cache.polymarket = { data: result, timestamp: Date.now() };
    }
    return result.length > 0 ? result : cache.polymarket.data || [];
  } catch (err) {
    console.error('[POLYMARKET]', describeError(err));
    return cache.polymarket.data || [];
  }
}

async function fetchPizzintWatch() {
  console.log('[DATA] Fetching pizzint.watch geopolitical predictions...');

  try {
    const { data } = await fetch('https://pizzint.watch', { timeout: 10000 });

    // Extract initialDoomsdayData from Next.js RSC payload
    // In the HTML the JSON is double-escaped: initialDoomsdayData\\\":{\\\"markets\\\":[...]}
    const idx = data.indexOf('initialDoomsdayData');
    if (idx < 0) {
      console.log('[PIZZINT] Could not find initialDoomsdayData in page');
      return [];
    }

    // Extract from the opening { after initialDoomsdayData\\\":
    // Find the markets array by looking for the pattern and matching brackets
    const dataSlice = data.substring(idx);
    const marketsStart = dataSlice.indexOf('markets');
    if (marketsStart < 0) {
      console.log('[PIZZINT] Could not find markets array');
      return [];
    }

    // Find the opening [ after "markets\\":
    const arrStart = dataSlice.indexOf('[', marketsStart);
    if (arrStart < 0) {
      console.log('[PIZZINT] Could not find markets array start');
      return [];
    }

    // Match brackets to find the end of the array
    let depth = 0;
    let arrEnd = -1;
    for (let i = arrStart; i < dataSlice.length; i++) {
      if (dataSlice[i] === '[') depth++;
      else if (dataSlice[i] === ']') {
        depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
    }
    if (arrEnd < 0) {
      console.log('[PIZZINT] Could not find markets array end');
      return [];
    }

    // Unescape the JSON-escaped string
    const rawArray = dataSlice.substring(arrStart, arrEnd).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    let markets;
    try {
      markets = JSON.parse(rawArray);
    } catch (parseErr) {
      console.error('[PIZZINT] JSON parse failed:', parseErr.message);
      return [];
    }
    const result = markets.map(market => normalizePizzintMarket(market)).filter(Boolean);

    if (result.length > 0) {
      cache.pizzint = { data: result, timestamp: Date.now() };
    }
    return result.length > 0 ? result : cache.pizzint.data || [];
  } catch (err) {
    console.error('[PIZZINT]', describeError(err));
    return cache.pizzint.data || [];
  }
}

async function fetchPredictions() {
  if (isCacheValid('predictions')) {
    return cache.predictions.data;
  }

  const [polymarket, kalshi, pizzint] = await Promise.all([
    fetchPolymarketDirect(),
    fetchKalshiDirect(),
    fetchPizzintWatch(),
  ]);

  // Deduplicate by slug (pizzint items may overlap with Polymarket)
  const seenSlugs = new Set();
  const merged = [];

  for (const item of polymarket) {
    if (item.slug) seenSlugs.add(item.slug);
    merged.push(item);
  }

  for (const item of kalshi) {
    if (item.slug && seenSlugs.has(item.slug)) continue;
    if (item.slug) seenSlugs.add(item.slug);
    merged.push(item);
  }

  for (const item of pizzint) {
    if (item.slug && seenSlugs.has(item.slug)) continue;
    merged.push(item);
  }

  const result = selectDiverseItems(merged, 30, 15);

  if (result.length > 0) {
    cache.predictions = { data: result, timestamp: Date.now() };
  }
  return result;
}

function normalizePizzintMarket(market, now = Date.now()) {
  // A discovery page must identify a real exchange contract; never invent a probability.
  const probability = market.price ?? market.probability;
  if (!market.eventSlug || probability == null || !market.endDate) return null;
  return normalizePolymarketMarket({ id: market.id || market.slug, question: market.label || market.question || market.title,
    slug: market.slug, active: true, closed: false, endDate: market.endDate,
    volume24hr: market.volume_24h ?? market.volume24hr,
    outcomes: ['Yes', 'No'], outcomePrices: [probability, 1 - Number(probability)],
    events: [{ slug: market.eventSlug, active: true }],
  }, now);
}

function formatVolume(vol) {
  if (!vol) return '$0';
  if (vol >= 1000000) {
    return '$' + (vol / 1000000).toFixed(1) + 'M';
  }
  if (vol >= 1000) {
    return '$' + (vol / 1000).toFixed(0) + 'K';
  }
  return '$' + Math.round(vol);
}

function categorizeMarket(question) {
  const q = (question || '').toLowerCase();
  if (q.includes('trump') || q.includes('biden') || q.includes('election') ||
      q.includes('president') || q.includes('congress') || q.includes('senate')) {
    return 'politics';
  }
  if (q.includes('fed') || q.includes('interest rate') || q.includes('inflation') ||
      q.includes('bitcoin') || q.includes('crypto') || q.includes('stock')) {
    return 'finance';
  }
  if (q.includes('war') || q.includes('strike') || q.includes('military') ||
      q.includes('attack') || q.includes('iran') || q.includes('russia') ||
      q.includes('china') || q.includes('ukraine')) {
    return 'world';
  }
  return 'general';
}

// ============================================
// Fetch Tech News (RSS)
// ============================================
function parseRequestedTechSources(value) { return parseRequestedSources(value, RSS_FEEDS.tech); }
function selectTechItems(items, requestedSources = null) { return selectCategoryItems(items, requestedSources, 60, 5); }
async function fetchTechNews(requestedSources = null) {
  if (requestedSources?.size === 0) return [];
  const pool = await loadCategoryPool('tech', 'tech', requestedSources);
  return selectTechItems(pool, requestedSources);
}

// ============================================
// Fetch Science News and Journals (RSS/Atom)
// ============================================

function selectScienceItems(items, requestedSources = null) {
  const eligible = requestedSources === null
    ? items
    : items.filter(item => requestedSources.has(item.source));
  // Reserve at least one slot per configured source as the researcher list grows.
  const limit = Math.max(60, RSS_FEEDS.science.length);
  const perSourceCap = Math.max(1, Math.floor(limit / RSS_FEEDS.science.length));
  return selectDiverseItems(eligible, limit, perSourceCap);
}

async function fetchScienceNews(requestedSources = null) {
  if (requestedSources?.size === 0) return [];
  const pool = await loadCategoryPool('science', 'science', requestedSources);
  return selectScienceItems(pool, requestedSources);
}

function parseRequestedScienceSources(value) {
  if (value === undefined) return null;
  const allowedSources = new Set(RSS_FEEDS.science.map(feed => feed.name));
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return new Set(
    raw
      .split(',')
      .map(source => source.trim())
      .filter(source => allowedSources.has(source))
  );
}

// ============================================
// Fetch Finance News and Primary Economic Releases
// ============================================
function normalizeFinanceItems(items) {
  return normalizeCategoryItems(items.filter(item => !isPromotionalEntry(item) && isFinanceEntry(item)), 'headline');
}

function selectFinanceItems(items, requestedSources = null) {
  const eligible = requestedSources === null
    ? items
    : items.filter(item => requestedSources.has(item.source));
  return selectDiverseItems(eligible, 80, 5);
}

async function fetchFinanceNews(requestedSources = null) {
  if (requestedSources?.size === 0) return [];
  const pool = await loadCategoryPool('finance', 'headline', requestedSources);
  return selectFinanceItems(pool, requestedSources);
}

function parseRequestedFinanceSources(value) {
  if (value === undefined) return null;
  const allowedSources = new Set(RSS_FEEDS.finance.map(feed => feed.name));
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return new Set(raw.split(',').map(source => source.trim())
    .filter(source => allowedSources.has(source)));
}

// ============================================
// Fetch Local News (DC and Alexandria)
// ============================================

function selectLocalItems(items, requestedSources = null) {
  const eligible = requestedSources === null
    ? items
    : items.filter(item => requestedSources.has(item.source));
  return selectDiverseItems(eligible, 50, 8);
}

async function fetchLocalNews(requestedSources = null) {
  if (requestedSources?.size === 0) return [];
  const pool = await loadCategoryPool('local', 'local', requestedSources);
  return selectLocalItems(pool, requestedSources);
}

function parseRequestedLocalSources(value) {
  if (value === undefined) return null;
  const allowedSources = new Set(RSS_FEEDS.local.map(feed => feed.name));
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return new Set(
    raw
      .split(',')
      .map(source => source.trim())
      .filter(source => allowedSources.has(source))
  );
}

// ============================================
// Fetch user-provided public RSS/Atom feeds
// ============================================
function normalizeCustomFeedDefinitions(value) {
  let definitions;
  try {
    definitions = JSON.parse(String(value || '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(definitions)) return [];

  return definitions
    .slice(0, 20)
    .flatMap(definition => {
      const name = typeof definition?.name === 'string' ? definition.name.trim().slice(0, 100) : '';
      const url = typeof definition?.url === 'string' ? definition.url.trim() : '';
      if (!name || !url) return [];
      try {
        if (!isSafePublicUrl(url)) return [];
      } catch {
        return [];
      }
      return [{ name, url }];
    });
}

async function fetchCustomFeeds(definitions) {
  const current = () => definitions.flatMap(feed => currentSnapshotItems('custom', feed, CONTENT_MAX_AGE.headlines));
  const pending = definitions.flatMap(feed => {
    const key = snapshotKey('custom', feed);
    const existing = snapshots.get(key);
    if (existing && Date.now() - existing.at < 60000) return [];
    if (!inFlightRequests.has(`custom:${key}`) && Date.now() - (feedAttempts.get(key) || 0) < 60000) return [];
    return [dedupeRequest(`custom:${key}`, async () => {
      feedAttempts.set(key, Date.now());
      try {
        const { data } = await fetch(feed.url, {
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          headers: { 'User-Agent': 'BlakeNewsNow/0.4 (user RSS feed)' }, label: `Custom ${feed.name}`,
        });
        const parsed = parseRSS(data, feed.name);
        if (!parsed.length) throw new Error('Response contains no parseable entries');
        const items = filterRecentItems(parsed, { maxAgeMs: CONTENT_MAX_AGE.headlines });
        snapshots.set(key, normalizeCategoryItems(items, 'custom'));
      } catch (err) { console.error(`[DATA] Custom ${feed.name} failed:`, describeError(err)); }
    })];
  });
  if (!current().length) await withBudget(Promise.all(pending), POOL_BUDGET_MS, null);
  const allItems = current().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const seen = new Set();
  return selectDiverseItems(allItems.filter(item => {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }), 50, 8);
}

// ============================================
// Fetch Lemmy Posts
// ============================================
async function fetchLemmy() {
  if (isCacheValid('lemmy')) {
    return cache.lemmy.data;
  }

  console.log('[DATA] Fetching Lemmy...');

  const communityResults = await Promise.all(
    LEMMY_COMMUNITIES.map(async community => {
      try {
        const url = `https://lemmy.world/api/v3/post/list?community_name=${encodeURIComponent(community)}&sort=Hot&limit=25`;
        const { data } = await fetch(url, {
          accept: 'application/json', timeout: 10000, label: `c/${community}`,
        });
        const document = JSON.parse(data);
        const now = Date.now();
        const posts = (document.posts || []).flatMap(view => {
          const post = view.post || {};
          const counts = view.counts || {};
          const timestamp = new Date(post.published);
          const timestampMs = timestamp.getTime();
          if (
            !post.id ||
            !post.name ||
            post.deleted ||
            post.removed ||
            post.nsfw ||
            !Number.isFinite(timestampMs) ||
            timestampMs > now + 15 * 60 * 1000 ||
            timestampMs < now - CONTENT_MAX_AGE.headlines
          ) {
            return [];
          }

          const discussionUrl = post.ap_id || `https://lemmy.world/post/${post.id}`;
          const score = Number(counts.score) || 0;
          const comments = Number(counts.comments) || 0;
          const ageHours = Math.max(0, (now - timestampMs) / (60 * 60 * 1000));

          return [{
            id: stableId('lemmy', String(post.id), community),
            title: stripHtml(decodeEntities(post.name)),
            source: `c/${community}`,
            community,
            score,
            comments,
            url: post.url || discussionUrl,
            permalink: discussionUrl,
            timestamp: timestamp.toISOString(),
            description: stripHtml(decodeEntities(post.embed_description || post.body || '')).slice(0, 1200),
            rank: (score + (comments * 0.5) + 1) * Math.exp(-ageHours / 36),
          }];
        });
        console.log(`[LEMMY] c/${community}: ${posts.length} current posts`);
        return posts;
      } catch (err) {
        console.error(`[LEMMY] c/${community} failed:`, describeError(err));
        return [];
      }
    })
  );

  const allPosts = communityResults.flat().sort((a, b) => b.rank - a.rank);
  const seen = new Set();
  const unique = allPosts.filter(post => {
    const key = `${post.source}|${post.url || ''}|${post.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const result = unique.map(({ rank, ...post }) => socialProvenance(post));

  if (result.length > 0) {
    cache.lemmy = { data: result, timestamp: Date.now() };
    return result;
  }

  if (cache.lemmy.data) {
    console.warn('[LEMMY] All communities failed; returning the last successful response');
    return cache.lemmy.data;
  }
  return [];
}

// ============================================
// Fetch credential-free social signals
// ============================================
function normalizeBlueskyPost(view, now = Date.now()) {
  const post = view?.post || {};
  const record = post.record || {};
  const author = post.author || {};
  const timestamp = new Date(record.createdAt);
  const timestampMs = timestamp.getTime();
  const title = stripHtml(decodeEntities(record.text || '')).replace(/\s+/g, ' ').trim();
  const contentLabels = [
    ...(post.labels || []).map(label => label?.val),
    ...(record.labels?.values || []),
  ].filter(Boolean);

  if (
    !post.uri ||
    !author.handle ||
    !title ||
    contentLabels.some(label => ['porn', 'sexual', 'nudity', 'graphic-media'].includes(label)) ||
    !Number.isFinite(timestampMs) ||
    timestampMs > now + 15 * 60 * 1000 ||
    timestampMs < now - CONTENT_MAX_AGE.headlines
  ) {
    return null;
  }

  const postKey = post.uri.split('/').pop();
  if (!postKey) return null;
  const likes = Number(post.likeCount) || 0;
  const reposts = Number(post.repostCount) || 0;
  const replies = Number(post.replyCount) || 0;
  const external = post.embed?.external;

  return {
    id: stableId('bluesky', post.uri, author.handle),
    title: title.slice(0, 280),
    source: 'Bluesky Discover',
    community: 'discover',
    score: likes + reposts,
    comments: replies,
    url: `https://bsky.app/profile/${encodeURIComponent(author.handle)}/post/${encodeURIComponent(postKey)}`,
    permalink: `https://bsky.app/profile/${encodeURIComponent(author.handle)}/post/${encodeURIComponent(postKey)}`,
    timestamp: timestamp.toISOString(),
    description: stripHtml(decodeEntities(external?.description || '')).slice(0, 1200),
    rank: likes + (reposts * 2) + replies + 1,
  };
}

function normalizeMastodonLink(link, now = Date.now()) {
  const title = stripHtml(decodeEntities(link?.title || '')).replace(/\s+/g, ' ').trim();
  const history = Array.isArray(link?.history) ? link.history : [];
  const activeHistory = history
    .map(entry => ({
      timestamp: Number(entry?.day) * 1000,
      uses: Number(entry?.uses) || 0,
      accounts: Number(entry?.accounts) || 0,
    }))
    .filter(entry => Number.isFinite(entry.timestamp) && entry.timestamp > 0 && entry.uses > 0);
  const timestampMs = Math.max(0, ...activeHistory.map(entry => entry.timestamp));

  let url;
  try {
    url = new URL(link?.url || '');
  } catch {
    return null;
  }

  if (
    !title ||
    !['http:', 'https:'].includes(url.protocol) ||
    !timestampMs ||
    timestampMs > now + 15 * 60 * 1000 ||
    timestampMs < now - CONTENT_MAX_AGE.headlines
  ) {
    return null;
  }

  const uses = activeHistory.reduce((sum, entry) => sum + entry.uses, 0);
  const accounts = activeHistory.reduce((sum, entry) => sum + entry.accounts, 0);

  return {
    id: stableId('mastodon', url.href, link.provider_name || ''),
    title: title.slice(0, 280),
    source: 'Mastodon Trending',
    community: 'trending-links',
    score: uses,
    url: url.href,
    permalink: url.href,
    timestamp: new Date(timestampMs).toISOString(),
    description: stripHtml(decodeEntities(link.description || '')).slice(0, 1200),
    rank: uses + accounts + 1,
  };
}

async function fetchOpenSocial() {
  if (isCacheValid('openSocial')) {
    return cache.openSocial.data;
  }

  console.log('[DATA] Fetching open social signals...');
  const [blueskyPosts, mastodonLinks] = await Promise.all([
    (async () => {
      try {
        const query = new URLSearchParams({
          feed: BLUESKY_DISCOVER_FEED,
          limit: '40',
        });
        const { data } = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?${query}`, {
          accept: 'application/json',
          headers: { 'Accept-Language': 'en' }, label: 'Bluesky Discover',
          timeout: 10000,
        });
        const document = JSON.parse(data);
        const posts = (document.feed || [])
          .map(view => normalizeBlueskyPost(view))
          .filter(Boolean);
        console.log(`[SOCIAL] Bluesky Discover: ${posts.length} current posts`);
        return posts;
      } catch (err) {
        console.error('[SOCIAL] Bluesky Discover failed:', describeError(err));
        return [];
      }
    })(),
    (async () => {
      try {
        const { data } = await fetch('https://mastodon.social/api/v1/trends/links?limit=20', {
          accept: 'application/json', label: 'Mastodon Trending',
          timeout: 10000,
        });
        const links = JSON.parse(data)
          .map(link => normalizeMastodonLink(link))
          .filter(Boolean);
        console.log(`[SOCIAL] Mastodon Trending: ${links.length} current links`);
        return links;
      } catch (err) {
        console.error('[SOCIAL] Mastodon Trending failed:', describeError(err));
        return [];
      }
    })(),
  ]);

  const result = [...blueskyPosts, ...mastodonLinks].sort((a, b) => b.rank - a.rank)
    .map(({ rank, ...item }) => socialProvenance(item, item.source === 'Mastodon Trending' ? 'trending' : 'posted'));

  if (result.length > 0) {
    cache.openSocial = { data: result, timestamp: Date.now() };
    return result;
  }
  return cache.openSocial.data || [];
}

// ============================================
// Fetch Hacker News
// ============================================
async function fetchHackerNews() {
  if (isCacheValid('hackernews')) {
    return cache.hackernews.data;
  }

  console.log('[DATA] Fetching Hacker News...');

  try {
    // Get top story IDs
    const { data: idsData } = await fetch(`${HN_API}/topstories.json`, { label: 'Hacker News',
      headers: { 'Accept': 'application/json' },
    });
    const storyIds = JSON.parse(idsData).slice(0, 30);

    // Fetch stories in parallel (batch of 10 at a time)
    const stories = [];
    for (let i = 0; i < storyIds.length; i += 10) {
      const batch = storyIds.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const { data } = await fetch(`${HN_API}/item/${id}.json`, {
              headers: { 'Accept': 'application/json' },
            });
            return JSON.parse(data);
          } catch (err) {
            return null;
          }
        })
      );
      stories.push(...batchResults.filter(Boolean));
    }

    const result = stories.map(story => ({
      id: `hn-${story.id}`,
      title: story.title,
      source: 'Hacker News',
      score: story.score,
      comments: story.descendants || 0,
      url: story.url,
      permalink: `https://news.ycombinator.com/item?id=${story.id}`,
      timestamp: new Date(story.time * 1000).toISOString(),
      by: story.by,
      type: story.type,
    })).map(story => socialProvenance(story));

    cache.hackernews = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.error('[HN]', describeError(err));
    return cache.hackernews.data || [];
  }
}

// ============================================
// Fetch 4chan Threads
// ============================================
async function fetchFourChan() {
  if (isCacheValid('fourchan')) {
    return cache.fourchan.data;
  }

  console.log('[DATA] Fetching 4chan...');

  const boards = ['news', 'pol', 'lit', 'his', 'g'];
  const allThreads = [];

  // Fetch boards sequentially to respect 4chan rate limit (1 req/sec)
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i];
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    try {
      const { data } = await fetch(`https://a.4cdn.org/${board}/catalog.json`, { label: `/${board}/`,
        headers: { 'Accept': 'application/json' },
        timeout: 8000,
      });
      const pages = JSON.parse(data);

      for (const page of pages) {
        for (const thread of (page.threads || [])) {
          if ((thread.replies || 0) < 5) continue;

          let title = thread.sub
            ? decodeEntities(stripHtml(thread.sub))
            : thread.com
              ? decodeEntities(stripHtml(thread.com)).substring(0, 80)
              : null;

          if (!title) continue;

          allThreads.push({
            id: stableId('4ch', String(thread.no), board),
            title,
            board: `/${board}/`,
            source: `/${board}/`,
            replies: thread.replies || 0,
            images: thread.images || 0,
            timestamp: new Date((thread.time || 0) * 1000).toISOString(),
            url: `https://boards.4chan.org/${board}/thread/${thread.no}`,
          });
        }
      }
      console.log(`[4CHAN] /${board}/: ${allThreads.length} threads (filtered)`);
    } catch (err) {
      console.error(`[4CHAN] /${board}/ failed:`, describeError(err));
    }
  }

  // Sort by reply count, while preventing a single board from consuming the list.
  allThreads.sort((a, b) => b.replies - a.replies);
  const result = allThreads.filter(item => {
    const t = Date.parse(item.timestamp);
    return Number.isFinite(t) && t <= Date.now() + 900000 && t >= Date.now() - 7 * 86400000;
  }).map(item => ({ ...item, timestampKind: 'posted', sourceKind: 'discussion', contentType: 'discussion' }));

  if (result.length > 0) {
    cache.fourchan = { data: result, timestamp: Date.now() };
  }
  return result;
}

// ============================================
// Express Route Handlers
// ============================================
function registerRoutes(app) {
  app.use('/api', (req, res, next) => {
    const category = req.path.slice(1);
    const original = res.json.bind(res);
    res.json = data => {
      if (RSS_FEEDS[category]) {
        const requested = parseRequestedSources(req.query.sources, RSS_FEEDS[category]);
        const pending = RSS_FEEDS[category].some(feed => (requested === null || requested.has(feed.name))
          && inFlightRequests.has(`parsed:${snapshotKey(category, feed)}`));
        res.set('X-Feed-Updating', pending || (category === 'headlines' && inFlightRequests.has('gdelt-pool')) ? '1' : '0');
      }
      if (category === 'custom') {
        const definitions = normalizeCustomFeedDefinitions(req.query.feeds);
        res.set('X-Feed-Updating', definitions.some(feed => inFlightRequests.has(`custom:${snapshotKey('custom', feed)}`)) ? '1' : '0');
      }
      return original(data);
    };
    next();
  });
  app.get('/api/source-health', (_req, res) => res.json(getSourceHealth()));
  app.get('/api/finance', async (req, res) => {
    try {
      const requestedSources = parseRequestedFinanceSources(req.query.sources);
      const data = await fetchFinanceNews(requestedSources);
      res.json(data);
    } catch (err) {
      console.error('[API] Finance error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/headlines', async (req, res) => {
    try {
      const requestedSources = parseRequestedHeadlineSources(req.query.sources);
      const data = await fetchHeadlines(requestedSources);
      res.json(data);
    } catch (err) {
      console.error('[API] Headlines error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/local', async (req, res) => {
    try {
      const requestedSources = parseRequestedLocalSources(req.query.sources);
      const data = await fetchLocalNews(requestedSources);
      res.json(data);
    } catch (err) {
      console.error('[API] Local news error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/custom', async (req, res) => {
    try {
      const definitions = normalizeCustomFeedDefinitions(req.query.feeds);
      const data = await dedupeRequest(
        `custom:${JSON.stringify(definitions)}`,
        () => fetchCustomFeeds(definitions)
      );
      res.json(data);
    } catch (err) {
      console.error('[API] Custom feeds error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ticker', async (req, res) => {
    try {
      const data = await dedupeRequest('ticker', fetchTicker);
      res.json(data);
    } catch (err) {
      console.error('[API] Ticker error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/markets', async (req, res) => {
    try {
      const data = await dedupeRequest('markets', fetchMarkets);
      res.json(data);
    } catch (err) {
      console.error('[API] Markets error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/crypto', async (req, res) => {
    try {
      const data = await dedupeRequest('crypto', fetchCrypto);
      res.json(data);
    } catch (err) {
      console.error('[API] Crypto error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/macro', async (_req, res) => {
    try {
      const data = await dedupeRequest('macro', fetchMacroData);
      res.json(data);
    } catch (err) {
      console.error('[API] Macro data error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/weather', async (req, res) => {
    try {
      const zip = req.query.zip || DEFAULT_ZIP;
      if (typeof zip !== 'string' || !/^\d{5}$/.test(zip)) {
        return res.status(400).json({ error: 'ZIP code must contain five digits' });
      }
      const data = await dedupeRequest(`weather:${zip}`, () => fetchWeather(zip));
      if (!data) {
        return res.status(503).json({ error: 'Weather data unavailable' });
      }
      res.json(data);
    } catch (err) {
      console.error('[API] Weather error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/radar', async (req, res) => {
    try {
      const data = await dedupeRequest('radar', fetchRadarData);
      if (!data) {
        return res.status(503).json({ error: 'Radar data unavailable' });
      }
      res.json(data);
    } catch (err) {
      console.error('[API] Radar error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/predictions', async (req, res) => {
    try {
      const data = await dedupeRequest('predictions', fetchPredictions);
      res.json(data);
    } catch (err) {
      console.error('[API] Predictions error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/lemmy', async (req, res) => {
    try {
      const requested = parseRequestedSources(req.query.sources, (LEMMY_COMMUNITIES.map(name => 'c/' + name)).map(name => ({ name })));
      if (requested?.size === 0) return res.json([]);
      const pool = await dedupeRequest('lemmy', fetchLemmy);
      const data = selectCategoryItems(pool, requested, 45, 15);
      res.json(data);
    } catch (err) {
      console.error('[API] Lemmy error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/open-social', async (req, res) => {
    try {
      const requested = parseRequestedSources(req.query.sources, (['Bluesky Discover', 'Mastodon Trending']).map(name => ({ name })));
      if (requested?.size === 0) return res.json([]);
      const pool = await dedupeRequest('openSocial', fetchOpenSocial);
      const data = selectCategoryItems(pool, requested, 30, 15);
      res.json(data);
    } catch (err) {
      console.error('[API] Open social error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/hackernews', async (req, res) => {
    try {
      const requested = parseRequestedSources(req.query.sources, (['Hacker News']).map(name => ({ name })));
      if (requested?.size === 0) return res.json([]);
      const pool = await dedupeRequest('hackernews', fetchHackerNews);
      const data = selectCategoryItems(pool, requested, 30, 30);
      res.json(data);
    } catch (err) {
      console.error('[API] Hacker News error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/4chan', async (req, res) => {
    try {
      const requested = parseRequestedSources(req.query.sources, (['/news/', '/pol/', '/lit/', '/his/', '/g/']).map(name => ({ name })));
      if (requested?.size === 0) return res.json([]);
      const pool = await dedupeRequest('fourchan', fetchFourChan);
      const data = selectCategoryItems(pool, requested, 40, 14);
      res.json(data);
    } catch (err) {
      console.error('[API] 4chan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tech', async (req, res) => {
    try {
      const data = await fetchTechNews(parseRequestedTechSources(req.query.sources));
      res.json(data);
    } catch (err) {
      console.error('[API] Tech news error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/science', async (req, res) => {
    try {
      const requestedSources = parseRequestedScienceSources(req.query.sources);
      const data = await fetchScienceNews(requestedSources);
      res.json(data);
    } catch (err) {
      console.error('[API] Science news error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[DATA] API routes registered: /api/headlines, /api/finance, /api/local, /api/custom, /api/ticker, /api/markets, /api/crypto, /api/macro, /api/weather, /api/radar, /api/predictions, /api/lemmy, /api/open-social, /api/hackernews, /api/4chan, /api/tech, /api/science, /api/source-health');
}

module.exports = {
  RSS_FEEDS,
  describeError,
  isRetryableError,
  // Exposed so the breaker state machine can be exercised without live network calls.
  sourceBreaker: {
    cooldownRemaining: breakerCooldownRemaining,
    recordFailure: recordSourceFailure,
    recordSuccess: recordSourceSuccess,
    reset: () => sourceHealth.clear(),
    BREAKER_THRESHOLD,
    BREAKER_BASE_COOLDOWN_MS,
    BREAKER_MAX_COOLDOWN_MS,
  },
  normalizePolymarketMarket,
  normalizeKalshiMarket,
  normalizePizzintMarket,
  hasSportsMetadata,
  selectDiverseItems,
  selectHeadlineItems,
  selectScienceItems,
  selectTechItems,
  parseRequestedTechSources,
  normalizeCategoryItems,
  fetchConfiguredFeed,
  getSourceHealth,
  selectLocalItems,
  selectFinanceItems,
  parseRequestedFinanceSources,
  normalizeFinanceItems,
  normalizeBlueskyPost,
  normalizeMastodonLink,
  registerRoutes,
  fetchHeadlines,
  fetchLocalNews,
  fetchFinanceNews,
  fetchCustomFeeds,
  fetchTicker,
  fetchMarkets,
  fetchCrypto,
  fetchMacroData,
  fetchWeather,
  fetchRadarData,
  fetchPredictions,
  fetchLemmy,
  fetchOpenSocial,
  fetchHackerNews,
  fetchFourChan,
  fetchTechNews,
  fetchScienceNews,
  isLocalAdOrPromotion,
};
