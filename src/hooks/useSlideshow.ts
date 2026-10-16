import { useCallback, useEffect, useRef, useState } from "react";
import { nextStory, photoUrl } from "../utils/playlist";
import type { FeedItem } from "../types";

export function useSlideshow(
  items: FeedItem[],
  seconds: number,
  running: boolean,
) {
  const [slide, setSlide] = useState<{ item: FeedItem | null; serial: number }>(
    { item: null, serial: 0 },
  );
  const pool = useRef(items);
  const current = useRef(slide);
  const seen = useRef(new Set<string>());
  const history = useRef<FeedItem[]>([]);
  const remaining = useRef({ serial: 0, ms: seconds * 1000 });
  useEffect(() => {
    pool.current = items;
  }, [items]);
  const select = useCallback(
    (item: FeedItem | null, remember = true) => {
      if (remember && current.current.item)
        history.current = [...history.current.slice(-19), current.current.item];
      if (item) seen.current.add(item.id);
      while (seen.current.size > 200)
        seen.current.delete(seen.current.values().next().value!);
      const next = { item, serial: current.current.serial + 1 };
      current.current = next;
      remaining.current = { serial: next.serial, ms: seconds * 1000 };
      setSlide(next);
    },
    [seconds],
  );
  const advance = useCallback(() => {
    if (pool.current.every((item) => seen.current.has(item.id)))
      seen.current.clear();
    select(nextStory(pool.current, current.current.item?.id, seen.current));
  }, [select]);
  const previous = useCallback(() => {
    const previousItem = history.current.pop();
    if (previousItem) select(previousItem, false);
  }, [select]);
  useEffect(() => {
    if (!current.current.item && items.length) select(items[0], false);
  }, [items, select]);
  useEffect(() => {
    if (!running || !slide.item) return;
    const started = performance.now();
    const duration = remaining.current.ms;
    const timer = setTimeout(advance, duration);
    return () => {
      clearTimeout(timer);
      if (remaining.current.serial === slide.serial)
        remaining.current.ms = Math.max(
          0,
          duration - (performance.now() - started),
        );
    };
  }, [slide, running, advance]);
  useEffect(() => {
    if (!running || !slide.item) return;
    const next = nextStory(items, slide.item.id, seen.current);
    if (!next || next.id === slide.item.id) return;
    const image = new Image();
    image.src = photoUrl(next);
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [items, slide.item, running]);
  return { ...slide, advance, previous };
}
