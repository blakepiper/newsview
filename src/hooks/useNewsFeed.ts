import { useEffect, useState } from "react";
import { pollingQuery } from "../utils/polling";
import { buildPlaylist } from "../utils/playlist";
import { isCurrentFeedItem } from "../utils/feedGrouping";
import type { FeedItem } from "../types";
import type { Sources } from "../settings";

const cacheKey = "newsview.playlist.v1";
function readCache(): FeedItem[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (item) =>
              item &&
              typeof item.title === "string" &&
              typeof item.source === "string" &&
              isCurrentFeedItem(item),
          )
          .slice(0, 150)
      : [];
  } catch {
    return [];
  }
}
const kinds: Record<string, FeedItem["sourceType"]> = {
  headlines: "news",
  tech: "tech",
  science: "science",
  local: "local",
  finance: "finance",
  lemmy: "social",
  "open-social": "social",
  hackernews: "social",
  "4chan": "social",
};

export function useNewsFeed(sources: Sources) {
  const [state, setState] = useState<{
    items: FeedItem[];
    loading: boolean;
    offline: boolean;
  }>(() => {
    const enabled = new Set(Object.values(sources).flat());
    return {
      items: buildPlaylist(
        readCache().filter((item) => enabled.has(item.source)),
      ),
      loading: true,
      offline: false,
    };
  });
  useEffect(() => {
    const enabled = new Set(Object.values(sources).flat());
    let retained = readCache().filter((item) => enabled.has(item.source));
    const routes = Object.entries(sources)
      .filter(([key, names]) => key !== "social" && names.length)
      .map(([key, names]) => ({ key, names }));
    const socialRoutes: Record<string, string[]> = {
      lemmy: sources.social.filter((name) => name.startsWith("c/")),
      "open-social": sources.social.filter((name) =>
        ["Bluesky Discover", "Mastodon Trending"].includes(name),
      ),
      hackernews: sources.social.filter((name) => name === "Hacker News"),
      "4chan": sources.social.filter((name) => name.startsWith("/")),
    };
    routes.push(
      ...Object.entries(socialRoutes)
        .filter(([, names]) => names.length)
        .map(([key, names]) => ({ key, names })),
    );
    const queries = routes.map((route) =>
      pollingQuery<FeedItem[]>(
        `/api/${route.key}?${new URLSearchParams({ sources: route.names.join(",") })}`,
        180000,
      ),
    );
    let timer: ReturnType<typeof setTimeout>;
    const publish = () => {
      const incoming: FeedItem[] = [];
      queries.forEach((query, index) => {
        const data = query.getSnapshot().data;
        if (!Array.isArray(data) || !data.length) return;
        const route = routes[index];
        retained = retained.filter(
          (item) => !route.names.includes(item.source),
        );
        for (const value of data) {
          const raw = value as FeedItem & { url?: string; permalink?: string };
          if (!raw || typeof raw.title !== "string" || !enabled.has(raw.source))
            continue;
          incoming.push({
            ...raw,
            sourceType: kinds[route.key],
            category: route.key,
            link: raw.link || raw.url || raw.permalink || "",
            title: raw.title.slice(0, 700),
            description: raw.description?.slice(0, 1200),
          });
        }
      });
      retained = [...incoming, ...retained].filter((item) =>
        isCurrentFeedItem(item),
      );
      const items = buildPlaylist(retained);
      retained = items;
      const states = queries.map((query) => query.getSnapshot());
      setState({
        items,
        loading: states.some((s) => s.loading) && !items.length,
        offline: states.length > 0 && states.every((s) => s.error),
      });
      if (items.length) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(items));
        } catch {
          /* Storage may be unavailable. */
        }
      }
    };
    const stops = queries.map((query) =>
      query.subscribe(() => {
        clearTimeout(timer);
        timer = setTimeout(publish, 50);
      }),
    );
    publish();
    // Expiry is checked even when the network is unavailable.
    const expiry = setInterval(publish, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(expiry);
      stops.forEach((stop) => stop());
    };
  }, [sources]);
  return state;
}
