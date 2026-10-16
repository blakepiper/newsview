import type { FeedItem } from "../types.ts";
import {
  canonicalArticleLink,
  sourceKind,
  publisherIdentity,
  entryContentType,
} from "../../shared/source-policy.js";
import { getFeedItemMaxAge } from "./formatters.ts";
import { compareFeedItems } from "./feedRanking.ts";

export function isCurrentFeedItem(item: FeedItem, now = Date.now()): boolean {
  const timestamp = Date.parse(item.timestamp);
  const published = item.publishedAt ? Date.parse(item.publishedAt) : timestamp;
  let validUrl = false;
  try {
    validUrl = ["http:", "https:"].includes(new URL(item.link).protocol);
  } catch {
    /* invalid URL */
  }
  return (
    validUrl &&
    Number.isFinite(timestamp) &&
    Number.isFinite(published) &&
    timestamp <= now + 15 * 60000 &&
    published <= now + 15 * 60000 &&
    published >= now - getFeedItemMaxAge(item.source) &&
    (!item.expiresAt || Date.parse(item.expiresAt) > now)
  );
}

export function isBriefingReport(item: FeedItem): boolean {
  const kind = item.sourceKind || sourceKind(item.source);
  return (
    !["discovery", "discussion", "summary"].includes(kind) &&
    !["opinion", "buying guide", "review / interview"].includes(
      item.contentType || entryContentType(item),
    ) &&
    !["indexed", "posted", "trending"].includes(
      item.timestampKind || "published",
    )
  );
}

function articleKey(item: FeedItem): string | null {
  try {
    const url = new URL(canonicalArticleLink(item.link));
    if (
      url.pathname === "/" ||
      /\/alerts-and-advisories\.html$/.test(url.pathname)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function groupFeedItems(items: FeedItem[]): FeedItem[] {
  const groups = new Set<FeedItem[]>();
  const links = new Map<string, FeedItem[]>();
  const titles = new Map<string, FeedItem[]>();
  for (const item of items) {
    const link = articleKey(item);
    const title = item.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    // Scientific identity is established by its publication link, not similar headlines.
    const useTitle = sourceKind(item.source) !== "author" && title.length > 20;
    const linkGroup = link ? links.get(link) : undefined;
    const titleGroup = useTitle ? titles.get(title) : undefined;
    const group = linkGroup || titleGroup || [];
    if (linkGroup && titleGroup && linkGroup !== titleGroup) {
      group.push(...titleGroup);
      groups.delete(titleGroup);
      for (const [key, value] of links)
        if (value === titleGroup) links.set(key, group);
      for (const [key, value] of titles)
        if (value === titleGroup) titles.set(key, group);
    }
    groups.add(group);
    group.push(item);
    if (link) links.set(link, group);
    if (useTitle) titles.set(title, group);
  }
  return [...groups]
    .map((group) => {
      const ranked = [...group].sort(
        (a, b) =>
          Number(isBriefingReport(b)) - Number(isBriefingReport(a)) ||
          compareFeedItems(a, b),
      );
      const representative = ranked[0];
      const sources = [...new Set(group.map((x) => x.source))];
      return {
        ...representative,
        sources,
        publisher:
          representative.publisher || publisherIdentity(representative.source),
        monitoredAuthors: sources.filter((x) => sourceKind(x) === "author"),
        discoverySources: sources.filter((x) =>
          ["discovery", "discussion"].includes(sourceKind(x)),
        ),
        relatedReports: group.map((x) => ({ source: x.source, link: x.link })),
      };
    })
    .sort(compareFeedItems);
}
