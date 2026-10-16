const { parseRSS, parseAlexandriaNews, inferDateFromUrl, decodeEntities } = require('./rss.cjs');
const { parseScientistPublications } = require('./scientist-publications.cjs');

function datedItem(source, title, link, date, description = '', extra = {}) {
  const pubDate = date ? new Date(date) : null;
  if (!title || !link || !pubDate || !Number.isFinite(pubDate.getTime())) return null;
  return { source, title, link, pubDate, description, ...extra };
}

function utc(value) {
  return value && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value + 'Z' : value;
}

function parseConfiguredSource(data, feed) {
  if (feed.parser === 'scientist-publications') return parseScientistPublications(data, feed);
  if (feed.parser === 'alexandria-html') return parseAlexandriaNews(data, feed.name, feed.url);
  if (feed.parser === 'ustr-html') {
    // USTR lists pair a printed ISO date with a release link; a full DOM is unnecessary.
    const text = value => decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return [...data.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([, content]) => {
      const date = text(content).match(/\b(20\d{2}-\d{2}-\d{2})(?!\d)/);
      if (!date) return [];
      for (const [, href, title] of content.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        if (!/\/press-releases\/20\d{2}\/./.test(href)) continue;
        const item = datedItem(feed.name, text(title), new URL(href.replace(/&amp;/g, '&'), feed.url).href, date[1] + 'T00:00:00Z');
        return item ? [item] : [];
      }
      return [];
    });
  }
  if (feed.parser === 'who-json') {
    const doc = JSON.parse(data);
    if (!Array.isArray(doc.value)) throw new Error('Invalid WHO news response');
    return doc.value.map(x => datedItem(feed.name, x.Title,
      x.ItemDefaultUrl && new URL('/news/item' + x.ItemDefaultUrl, 'https://www.who.int').href,
      x.PublicationDateAndTime, x.NewsType || '')).filter(Boolean);
  }
  if (feed.parser === 'federal-register') {
    const doc = JSON.parse(data);
    if (!Array.isArray(doc.results)) throw new Error('Invalid Federal Register response');
    return doc.results.map(x => datedItem(feed.name, x.title, x.html_url,
      x.publication_date && x.publication_date + 'T00:00:00Z',
      `${x.type || 'Document'} · ${x.abstract || ''}`, { documentUrl: x.pdf_url })).filter(Boolean);
  }
  if (feed.parser === 'legistar') {
    const events = JSON.parse(data);
    if (!Array.isArray(events)) throw new Error('Invalid council calendar response');
    return events.filter(x => /^City Council /.test(x.EventBodyName)).map(x => datedItem(feed.name,
      `${x.EventBodyName} · ${String(x.EventDate).slice(0, 10)}`,
      x.EventInSiteURL,
      utc(x.EventAgendaLastPublishedUTC || x.EventLastModifiedUtc),
      `Meeting: ${String(x.EventDate).slice(0, 10)} ${x.EventTime || ''} · ${x.EventLocation || ''} · ${x.EventComment || ''}`,
      { timestampKind: 'updated', scheduledAt: x.EventDate, documentUrl: x.EventAgendaFile })).filter(Boolean);
  }
  if (feed.parser === 'wmata') {
    const doc = JSON.parse(data);
    if (!Array.isArray(doc.alertResults) || !Array.isArray(doc.advisoryResults)) throw new Error('Invalid WMATA alert response');
    const now = Date.now();
    const alerts = doc.alertResults.filter(x => !x.effectiveEndDate || x.effectiveEndDate * 1000 > now)
      .map(x => datedItem(feed.name, x.alertHeaderText,
        x.alertUrlTranslations?.find(t => t.language === 'en')?.text || 'https://www.wmata.com/ride/alerts-and-advisories.html',
        x.effectiveStartDate && x.effectiveStartDate * 1000, x.alertDescriptionText,
        { timestampKind: 'effective', expiresAt: x.effectiveEndDate ? new Date(x.effectiveEndDate * 1000).toISOString() : null }));
    const advisories = doc.advisoryResults.map(x => {
      const p = x.properties || {};
      if (p.effectiveDateEndEpoch && p.effectiveDateEndEpoch < now) return null;
      return datedItem(feed.name, x.title, x.url && new URL(x.url, feed.url).href,
        p.updatedDateOverride || x.lastModified || p.updatedDate,
        x.description || '', { timestampKind: 'updated' });
    });
    return [...alerts, ...advisories].filter(Boolean);
  }
  return parseRSS(data, feed.name);
}

function socialProvenance(item, kind = 'posted') {
  const published = inferDateFromUrl(item.url || item.link);
  return { ...item, timestampKind: kind, activityAt: item.timestamp,
    ...(published ? { publishedAt: published.toISOString(), publicationDateSource: 'url' } : {}) };
}

module.exports = { parseConfiguredSource, socialProvenance };
