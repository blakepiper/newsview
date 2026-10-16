import type { FeedItem } from "../types.ts";
import { groupFeedItems, isCurrentFeedItem } from "./feedGrouping.ts";
import { compareFeedItems } from "./feedRanking.ts";

const stopWords = new Set(
  "a an the and or of in on for to with as is are at by from after over new says".split(
    " ",
  ),
);
function tokens(title: string) {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}
export function similarHeadline(left: string, right: string) {
  const a = tokens(left),
    b = tokens(right);
  if (a.size < 5 || b.size < 5)
    return left.toLowerCase().trim() === right.toLowerCase().trim();
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / (a.size + b.size - intersection) >= 0.9;
}

export function buildPlaylist(
  items: FeedItem[],
  limit = 48,
  now = Date.now(),
): FeedItem[] {
  const sorted = groupFeedItems(
    items.filter((item) => isCurrentFeedItem(item, now)),
  ).sort(compareFeedItems);
  const pools = new Map<FeedItem["sourceType"], FeedItem[]>();
  for (const item of sorted)
    pools.set(item.sourceType, [...(pools.get(item.sourceType) || []), item]);
  const order: FeedItem["sourceType"][] = [
    "news",
    "tech",
    "news",
    "science",
    "local",
    "finance",
    "social",
  ];
  const selected: FeedItem[] = [];
  const counts = new Map<string, number>();
  while (
    selected.length < limit &&
    [...pools.values()].some((pool) => pool.length)
  ) {
    for (const category of order) {
      if (selected.length >= limit) break;
      const pool = pools.get(category);
      if (!pool?.length) continue;
      const index = pool.findIndex(
        (item) =>
          item.source !== selected.at(-1)?.source &&
          (counts.get(item.source) || 0) < 4,
      );
      const item = pool.splice(index >= 0 ? index : 0, 1)[0];
      if (
        selected.some((previous) => similarHeadline(previous.title, item.title))
      )
        continue;
      selected.push(item);
      counts.set(item.source, (counts.get(item.source) || 0) + 1);
    }
  }
  return selected;
}

export function nextStory(
  items: FeedItem[],
  currentId: string | undefined,
  seen: ReadonlySet<string>,
  now = Date.now(),
) {
  const valid = items.filter((item) => isCurrentFeedItem(item, now));
  return (
    valid.find((item) => item.id !== currentId && !seen.has(item.id)) ||
    valid.find((item) => item.id !== currentId) ||
    valid[0] ||
    null
  );
}
export function photoUrl(item: FeedItem) {
  return `/api/image?${new URLSearchParams({ article: item.link, ...(item.image ? { image: item.image } : {}) })}`;
}
