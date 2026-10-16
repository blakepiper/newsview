export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  cached?: boolean;
  receivedAt?: number;
}
type Entry = {
  state: QueryState<unknown>;
  listeners: Set<() => void>;
  interval: number;
  at: number;
  etag?: string;
  updating?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  failures?: number;
  controller?: AbortController;
  request?: Promise<void>;
};
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 64;
const persistent = (url: string) =>
  /^\/api\/(?:weather|radar|markets|crypto|predictions)(?:[/?]|$)/.test(url);
function restore(url: string): QueryState<unknown> {
  try {
    if (typeof localStorage !== "undefined" && persistent(url)) {
      const saved = JSON.parse(
        localStorage.getItem(`newsview.query:${url}`) || "null",
      );
      if (
        saved?.data &&
        Number.isFinite(saved.receivedAt) &&
        Date.now() - saved.receivedAt < 86400000
      ) {
        return { ...saved, loading: false, cached: true, error: null };
      }
    }
  } catch {
    /* Corrupt or unavailable local storage. */
  }
  return { data: null, loading: true, error: null };
}
function persist(url: string, state: QueryState<unknown>) {
  try {
    if (typeof localStorage === "undefined" || !persistent(url)) return;
    const body = JSON.stringify({
      data: state.data,
      receivedAt: state.receivedAt,
    });
    if (body.length > 150000) return;
    localStorage.setItem(`newsview.query:${url}`, body);
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("newsview.query:"),
    );
    for (const key of keys.slice(0, Math.max(0, keys.length - 16)))
      localStorage.removeItem(key);
  } catch {
    /* The display also works without persistence. */
  }
}
// Leave browser HTTP/1.1 connections free for assets and radar tiles. Context
// panels get the next free slot rather than sitting behind long social requests.
let activeRequests = 0;
const requestQueue: Array<{ priority: number; start: () => void }> = [];
function requestSlot(url: string, signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const queued = {
      priority:
        /\/api\/(?:weather|radar|markets|crypto|macro|predictions|ticker)(?:[/?]|$)/.test(
          url,
        )
          ? 0
          : 1,
      start() {
        signal.removeEventListener("abort", cancel);
        activeRequests++;
        resolve(() => {
          activeRequests--;
          requestQueue.sort((a, b) => a.priority - b.priority);
          requestQueue.shift()?.start();
        });
      },
    };
    function cancel() {
      const index = requestQueue.indexOf(queued);
      if (index >= 0) requestQueue.splice(index, 1);
      reject(signal.reason);
    }
    if (signal.aborted) return reject(signal.reason);
    if (activeRequests < 4) queued.start();
    else {
      requestQueue.push(queued);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}
const visible = () =>
  typeof document === "undefined" || document.visibilityState !== "hidden";
function notify(entry: Entry) {
  for (const listener of entry.listeners) listener();
}
function schedule(url: string, entry: Entry) {
  clearTimeout(entry.timer);
  if (!entry.listeners.size || !visible()) return;
  const delay = entry.state.error
    ? Math.min(
        entry.interval,
        5000 * 2 ** Math.min((entry.failures || 1) - 1, 5),
      )
    : entry.updating
      ? 2000
      : Math.max(0, entry.interval - (Date.now() - entry.at));
  entry.timer = setTimeout(() => {
    void load(url, entry);
  }, delay);
}
async function load(url: string, entry: Entry): Promise<void> {
  if (entry.request) return entry.request;
  if (!visible()) return;
  const controller = new AbortController();
  entry.controller = controller;
  const timeout = setTimeout(
    () => controller.abort(new Error("Request timed out")),
    15000,
  );
  entry.request = (async () => {
    let release: (() => void) | undefined;
    try {
      release = await requestSlot(url, controller.signal);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: entry.etag ? { "If-None-Match": entry.etag } : {},
      });
      if (controller.signal.aborted) return;
      if (response.status !== 304 && !response.ok)
        throw new Error(`HTTP ${response.status}`);
      const data =
        response.status === 304 ? entry.state.data : await response.json();
      if (controller.signal.aborted) return;
      entry.etag = response.headers.get("ETag") || undefined;
      entry.updating = response.headers.get("X-Feed-Updating") === "1";
      entry.at = Date.now();
      entry.failures = 0;
      if (
        data !== entry.state.data ||
        entry.state.loading ||
        entry.state.error ||
        entry.state.cached
      ) {
        entry.state = {
          data,
          loading: false,
          error: null,
          cached: false,
          receivedAt: Date.now(),
        };
        persist(url, entry.state);
        notify(entry);
      }
    } catch (error) {
      if (
        controller.signal.aborted &&
        !controller.signal.reason?.message?.includes("timed out")
      )
        return;
      entry.at = Date.now();
      entry.updating = false;
      entry.failures = (entry.failures || 0) + 1;
      entry.state = {
        ...entry.state,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load",
      };
      notify(entry);
    } finally {
      release?.();
      clearTimeout(timeout);
      entry.controller = undefined;
      entry.request = undefined;
      schedule(url, entry);
    }
  })();
  return entry.request;
}
export function pollingQuery<T>(url: string, interval: number) {
  let entry = entries.get(url);
  if (!entry) {
    entry = { state: restore(url), listeners: new Set(), interval, at: 0 };
    entries.set(url, entry);
    for (const [key, old] of entries) {
      if (entries.size <= MAX_ENTRIES) break;
      if (!old.listeners.size && !old.request && key !== url)
        entries.delete(key);
    }
  }
  const current = entry;
  current.interval = Math.min(interval, current.interval);
  return {
    getSnapshot: () => current.state as QueryState<T>,
    subscribe(listener: () => void) {
      current.listeners.add(listener);
      if (Date.now() - current.at >= current.interval || current.updating)
        void load(url, current);
      else schedule(url, current);
      return () => {
        current.listeners.delete(listener);
        // StrictMode immediately subscribes again; keep that request alive.
        queueMicrotask(() => {
          if (!current.listeners.size) {
            clearTimeout(current.timer);
            current.controller?.abort();
          }
        });
      };
    },
    refresh: () => load(url, current),
  };
}
if (typeof document !== "undefined") {
  window.addEventListener("online", () => {
    for (const [url, entry] of entries)
      if (entry.listeners.size) void load(url, entry);
  });
  document.addEventListener("visibilitychange", () => {
    for (const [url, entry] of entries) {
      if (!visible()) {
        clearTimeout(entry.timer);
        entry.controller?.abort();
      } else if (entry.listeners.size) {
        if (Date.now() - entry.at >= entry.interval || entry.updating)
          void load(url, entry);
        else schedule(url, entry);
      }
    }
  });
}
