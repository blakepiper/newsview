import type { FeedItem } from "../types.ts";

const SOURCE_WEIGHTS: ReadonlyMap<string, number> = new Map([
  ["The Hindu", 0.35],
]);

export function sourceRankingWeight(source: string): number {
  return SOURCE_WEIGHTS.get(source) ?? 1;
}

// Weight a recency score with a three-hour half-life. Comparing its logarithm
// preserves chronological order for ordinary sources without needing a clock.
// The Hindu's weight is equivalent to a ~4.5-hour ranking penalty; actual
// timestamps, freshness checks and displayed publication dates stay unchanged.
const RANKING_OFFSETS = new Map(
  [...SOURCE_WEIGHTS].map(([source, weight]) => [
    source,
    Math.log2(weight) * 3 * 60 * 60 * 1000,
  ]),
);

export function compareFeedItems(left: FeedItem, right: FeedItem): number {
  const leftRank =
    Date.parse(left.timestamp) + (RANKING_OFFSETS.get(left.source) ?? 0);
  const rightRank =
    Date.parse(right.timestamp) + (RANKING_OFFSETS.get(right.source) ?? 0);
  return rightRank - leftRank;
}
