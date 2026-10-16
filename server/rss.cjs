const { XMLParser } = require('fast-xml-parser');
const { extractFeedImage } = require('./metadata.cjs');

const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  removeNSPrefix: false,
  trimValues: true,
});

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  if (value && typeof value === 'object') {
    return textValue(value['#text']);
  }
  return '';
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, num) => String.fromCodePoint(parseInt(num, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractLink(value) {
  const links = asArray(value);
  const preferred = links.find(link => {
    if (!link || typeof link !== 'object') return false;
    return !link['@_rel'] || link['@_rel'] === 'alternate';
  }) || links[0];

  if (typeof preferred === 'string') return decodeEntities(preferred.trim());
  if (preferred && typeof preferred === 'object') {
    return decodeEntities(textValue(preferred['@_href'] || preferred['#text']));
  }
  return '';
}

function inferDateFromUrl(link) {
  if (!link) return null;
  const match = link.match(/\/(20\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$)/);
  if (!match) return null;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) ? date : null;
}

function inferDateFromTitle(title) {
  const match = title.match(/\b(?:week of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (!match) return null;
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00 UTC`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractDate(entry, link) {
  const candidates = [
    entry.pubDate,
    entry.pubdate,
    entry.published,
    entry.updated,
    entry['dc:date'],
    entry.date,
    entry.issued,
  ];

  for (const candidate of candidates) {
    const raw = textValue(candidate);
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isFinite(date.getTime())) {
      return { date, dateSource: 'feed' };
    }
  }

  const inferred = inferDateFromUrl(link);
  return inferred ? { date: inferred, dateSource: 'url' } : { date: null, dateSource: 'missing' };
}

function parseRSS(xml, sourceName) {
  let document;
  try {
    document = parser.parse(xml);
  } catch {
    return [];
  }

  const channel = document?.rss?.channel;
  const entries = channel
    ? asArray(channel.item)
    : document?.feed
      ? asArray(document.feed.entry)
      : asArray(document?.['rdf:RDF']?.item);

  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];

    const title = decodeEntities(stripHtml(textValue(entry.title)));
    const link = extractLink(entry.link || entry.guid);
    if (!title) return [];

    let { date, dateSource } = extractDate(entry, link);
    if (!date) {
      date = inferDateFromTitle(title);
      if (date) dateSource = 'title';
    }
    const descriptionRaw = textValue(
      entry.description || entry.summary || entry.content || entry['content:encoded']
    );

    return [{
      title,
      link,
      pubDate: date,
      dateSource,
      description: decodeEntities(stripHtml(descriptionRaw)).slice(0, 1200),
      image: extractFeedImage(entry, link, descriptionRaw) || undefined,
      source: sourceName,
      entryCategory: asArray(entry.category).map(category => textValue(category) || textValue(category?.['@_term'])).join(' '),
    }];
  });
}

function parseAlexandriaNews(html, sourceName, baseUrl = 'https://www.alexandriava.gov/News') {
  const items = [];
  const rowPattern = /<tr[\s\S]*?<td[^>]*releasedate[^>]*>([\s\S]*?)<\/td>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const dateText = stripHtml(match[1]);
    const title = decodeEntities(stripHtml(match[3]));
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;
    let link;
    try {
      link = new URL(decodeEntities(match[2]), baseUrl).href;
    } catch {
      continue;
    }
    const pubDate = new Date(`${dateText}T12:00:00Z`);
    if (!Number.isFinite(pubDate.getTime())) continue;
    items.push({
      title,
      link,
      pubDate,
      dateSource: 'feed',
      description: '',
      source: sourceName,
    });
  }
  return items;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function filterRecentItems(items, { maxAgeMs, now = Date.now() }) {
  return items.filter(item => {
    const timestamp = item.pubDate?.getTime();
    if (!Number.isFinite(timestamp)) return false;
    if (timestamp > now + FUTURE_TOLERANCE_MS) return false;
    if (timestamp < now - maxAgeMs) return false;
    return isHttpUrl(item.link);
  });
}

module.exports = {
  FUTURE_TOLERANCE_MS,
  decodeEntities,
  filterRecentItems,
  inferDateFromUrl,
  inferDateFromTitle,
  isHttpUrl,
  parseAlexandriaNews,
  parseRSS,
};
