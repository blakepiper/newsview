import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNewsFeed } from "./hooks/useNewsFeed";
import { useSlideshow } from "./hooks/useSlideshow";
import { usePageVisible } from "./hooks/usePageVisible";
import { usePollingQuery } from "./hooks/usePollingQuery";
import { Radar, type WeatherData } from "./components/Radar";
import { ContextPanel } from "./components/ContextPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { normalizeSettings, type Settings } from "./settings";
import { photoUrl } from "./utils/playlist";
import type { FeedItem } from "./types";
import fallbackLogo from "./assets/blakenewsnow-logo.png";
import "./App.css";

const settingsKey = "newsview.settings.v1";
function initialSettings() {
  try {
    return normalizeSettings(
      JSON.parse(localStorage.getItem(settingsKey) || "null"),
    );
  } catch {
    return normalizeSettings(null);
  }
}
function age(timestamp: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(timestamp)) / 60000),
  );
  if (!Number.isFinite(minutes)) return "Date unavailable";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
const sectionNames = {
  news: "World & national",
  tech: "Technology",
  science: "Science",
  local: "Local",
  finance: "Business & economy",
  social: "Social",
};
function Story({ item }: { item: FeedItem }) {
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const photo = imageStatus === "loaded";
  const excerpt = item.description?.replace(/\s+/g, " ").trim();
  return (
    <article className={`story ${photo ? "has-photo" : "has-fallback"}`}>
      <header className="story-header">
        <span className="story-category">{sectionNames[item.sourceType]}</span>
        <div className="story-meta">
          <span>{item.source}</span>
          <span>·</span>
          <time dateTime={item.timestamp}>{age(item.timestamp)}</time>
          {item.contentType && item.contentType !== "reporting" && (
            <span>{item.contentType}</span>
          )}
        </div>
      </header>
      <div className="story-media">
        {!photo && (
          <div className="story-fallback">
            <img src={fallbackLogo} alt="Blake News Now" />
          </div>
        )}
        {imageStatus !== "failed" && (
          <img
            className="story-photo"
            src={photoUrl(item)}
            alt=""
            onLoad={() => setImageStatus("loaded")}
            onError={() => setImageStatus("failed")}
          />
        )}
        {photo && <span className="image-credit">Image: {item.source}</span>}
      </div>
      <div className="story-copy">
        <h1 className={item.title.length > 160 ? "long-headline" : ""}>
          {item.title}
        </h1>
        {excerpt && excerpt.toLowerCase() !== item.title.toLowerCase() && (
          <p>{excerpt}</p>
        )}
      </div>
    </article>
  );
}
function Display({
  settings,
  openSettings,
  dialogOpen,
}: {
  settings: Settings;
  openSettings: () => void;
  dialogOpen: boolean;
}) {
  const feed = useNewsFeed(settings.sources);
  const [paused, setPaused] = useState(false);
  const visible = usePageVisible();
  const running = !paused && !dialogOpen && visible;
  const slide = useSlideshow(feed.items, settings.slideSeconds, running);
  const { advance, previous } = slide;
  const weather = usePollingQuery<WeatherData>(
    `/api/weather?zip=${settings.zip}`,
    300000,
  );
  const [now, setNow] = useState(new Date());
  const [controls, setControls] = useState(true);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function revealControls() {
    setControls(true);
    clearTimeout(controlTimer.current);
    controlTimer.current = setTimeout(() => setControls(false), 5000);
  }
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    controlTimer.current = setTimeout(() => setControls(false), 5000);
    return () => clearTimeout(controlTimer.current);
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        dialogOpen ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat
      )
        return;
      if (
        event.key === " " ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft" ||
        event.key.toLowerCase() === "s"
      )
        event.preventDefault();
      if (event.key === " ") setPaused((value) => !value);
      else if (event.key === "ArrowRight") advance();
      else if (event.key === "ArrowLeft") previous();
      else if (event.key.toLowerCase() === "s") openSettings();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, advance, previous, openSettings]);
  const ordinal = Math.max(
    1,
    feed.items.findIndex((item) => item.id === slide.item?.id) + 1,
  );
  const temperature = weather.data?.temperature;
  return (
    <div
      className={`display ${settings.dim ? "dim" : ""}`}
      style={
        {
          "--label-shift-x": `${now.getMinutes() % 2}px`,
          "--label-shift-y": `${Math.floor(now.getMinutes() / 2) % 2}px`,
        } as CSSProperties
      }
      onPointerMove={revealControls}
      onPointerDown={revealControls}
    >
      <main className="display-grid">
        <div className="main-stage">
          {slide.item ? (
            <Story key={slide.item.id} item={slide.item} />
          ) : (
            <div className="empty-state">
              <h1>
                {feed.loading
                  ? "Loading news..."
                  : "No current stories."}
              </h1>
              <p>
                {feed.loading
                  ? "Fetching selected sources."
                  : feed.offline
                    ? "Waiting for a connection. Current cached stories will appear here when available."
                    : "No current stories from the selected sources. New stories appear automatically."}
              </p>
              <button type="button" onClick={openSettings}>
                [select sources]
              </button>
            </div>
          )}
          {slide.item && (
            <div
              className="slide-progress"
              key={`${slide.serial}:${settings.slideSeconds}`}
            >
              <span
                style={{
                  animationDuration: `${settings.slideSeconds}s`,
                  animationPlayState: running ? "running" : "paused",
                }}
              />
            </div>
          )}
        </div>
        <aside className="info-rail" aria-label="Weather and financial context">
          <section className="weather-section">
            <div className="section-label">
              <span>
                {weather.data?.location || `WEATHER · ${settings.zip}`}
              </span>
              <span>
                {weather.error || weather.cached
                  ? `CACHED${weather.receivedAt ? ` · ${new Date(weather.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                  : "LOCAL"}
              </span>
            </div>
            <div className="weather-current">
              <strong>
                {temperature == null ? "—" : Math.round(temperature)}
                <small>°F</small>
              </strong>
              <div>
                <span>
                  {weather.data?.condition ||
                    (weather.loading
                      ? "Checking conditions…"
                      : "Weather unavailable")}
                </span>
                <small>
                  {weather.data && (
                    <>
                      H{" "}
                      {weather.data.high == null
                        ? "—"
                        : Math.round(weather.data.high)}
                      ° &nbsp; L{" "}
                      {weather.data.low == null
                        ? "—"
                        : Math.round(weather.data.low)}
                      °
                    </>
                  )}
                </small>
              </div>
            </div>
            <Radar weather={weather.data} animate={settings.radarAnimation} />
          </section>
          <ContextPanel />
        </aside>
      </main>
      <footer className="display-footer">
        <div className="edition-status">
          <span>
            {paused
              ? "PAUSED"
              : feed.offline
                ? "OFFLINE · CACHED EDITION"
                : `PLAYING / ${settings.slideSeconds}s`}
          </span>
        </div>
        <span className="story-count">
          {feed.items.length
            ? `${String(ordinal).padStart(2, "0")} / ${String(feed.items.length).padStart(2, "0")}`
            : "—"}
        </span>
        <div
          className={`playback-controls ${controls || paused ? "visible" : ""}`}
        >
          <button
            type="button"
            aria-label="Previous story"
            title="Previous story (←)"
            onClick={slide.previous}
          >
            [prev]
          </button>
          <button
            type="button"
            aria-label={paused ? "Resume stories" : "Pause stories"}
            title="Pause / resume (Space)"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "[play]" : "[pause]"}
          </button>
          <button
            type="button"
            aria-label="Next story"
            title="Next story (→)"
            onClick={slide.advance}
          >
            [next]
          </button>
          <button
            type="button"
            aria-label="Display settings"
            title="Display settings (S)"
            onClick={openSettings}
          >
            [settings]
          </button>
        </div>
      </footer>
    </div>
  );
}
export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(settingsKey)) return;
    } catch {
      /* Use server defaults. */
    }
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (value && !edited.current) setSettings(normalizeSettings(value));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  function save(value: Settings) {
    edited.current = true;
    setSettings(value);
    try {
      localStorage.setItem(settingsKey, JSON.stringify(value));
    } catch {
      /* Session settings remain usable. */
    }
  }
  return (
    <>
      <Display
        key={JSON.stringify(settings.sources)}
        settings={settings}
        openSettings={() => setShowSettings(true)}
        dialogOpen={showSettings}
      />
      {showSettings && (
        <SettingsDialog
          value={settings}
          onSave={save}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
