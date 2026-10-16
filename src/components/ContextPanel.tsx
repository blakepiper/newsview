import { useEffect, useRef, useState } from "react";
import { usePollingQuery } from "../hooks/usePollingQuery";
import { usePageVisible } from "../hooks/usePageVisible";

interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  asOf?: string;
  currency?: string;
}
interface Prediction {
  id: string;
  question: string;
  yesPrice: number; // The API already expresses probability as a percentage.
  source: string;
  asOf?: string;
  endDate?: string;
  category: string;
}
function dateLabel(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Time unavailable";
}
function usePanelTick(seconds: number) {
  const [tick, setTick] = useState(0);
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(
      () => setTick((value) => value + 1),
      seconds * 1000,
    );
    return () => clearInterval(timer);
  }, [seconds, visible]);
  return tick;
}
function Markets() {
  const markets = usePollingQuery<{ indices: Quote[]; movers?: Quote[] }>(
    "/api/markets", 180000,
  );
  const crypto = usePollingQuery<Quote[]>("/api/crypto", 300000);
  const tick = usePanelTick(15);
  const visible = usePageVisible();
  const list = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(1);
  const quotes = [
    ...(markets.data?.indices || []),
    ...(markets.data?.movers || []),
    ...(crypto.data || []),
  ].filter(
    (quote) =>
      Number.isFinite(quote.price) && Number.isFinite(quote.changePercent),
  );
  useEffect(() => {
    const element = list.current;
    if (!element || !visible || !quotes.length) return;
    const measure = () => {
      const row = element.querySelector(".quote");
      if (!row) return;
      setCapacity(Math.max(
        1, Math.floor(element.clientHeight / row.getBoundingClientRect().height),
      ));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [quotes.length, visible]);
  const start = quotes.length > capacity ? (tick * capacity) % quotes.length : 0;
  const page = Array.from(
    { length: Math.min(capacity, quotes.length) },
    (_, index) => quotes[(start + index) % quotes.length],
  );
  return (
    <section className="context-section markets">
      <div className="section-label">
        <span>MARKETS</span>
        <span>{markets.cached || markets.error ? "CACHED" : ""}</span>
      </div>
      <div className="market-list" ref={list}>
        {!quotes.length && (
          <p className="panel-empty">
            {markets.loading
              ? "Checking the markets…"
              : "Market data is temporarily unavailable."}
          </p>
        )}
        {page.map((quote) => (
          <div className="quote" key={quote.symbol}>
            <div>
              <strong>{quote.symbol.replace("^", "")}</strong>
              <small>{quote.name}</small>
              <time>{dateLabel(quote.asOf)}</time>
            </div>
            <div className={`quote-value ${quote.changePercent > 0 ? "positive" : quote.changePercent < 0 ? "negative" : "neutral"}`}>
              <strong>
                {quote.price.toLocaleString(undefined, {
                  maximumFractionDigits: quote.price < 10 ? 3 : 2,
                })}
                <small> {quote.currency || "USD"}</small>
              </strong>
              <span>
                {quote.changePercent > 0 ? "+" : ""}
                {quote.changePercent.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
function Predictions() {
  const query = usePollingQuery<Prediction[]>("/api/predictions", 300000);
  const tick = usePanelTick(15);
  const items = (query.data || [])
    .filter(
      (item) =>
        item.question &&
        Number.isFinite(item.yesPrice) &&
        item.yesPrice >= 0 &&
        item.yesPrice <= 100 &&
        (!item.endDate || Date.parse(item.endDate) > Date.now()),
    )
    .sort(
      (a, b) =>
        Number(b.source === "Polymarket") - Number(a.source === "Polymarket"),
    );
  const item = items[tick % items.length];
  return (
    <section className="context-section predictions">
      <div className="section-label">
        <span>PREDICTIONS</span>
        <span>{query.cached || query.error ? "CACHED" : ""}</span>
      </div>
      {!item ? (
        <p className="panel-empty">
          {query.loading
            ? "Checking prediction markets…"
            : "No current odds available."}
        </p>
      ) : (
        <>
          <p className="prediction-question">{item.question}</p>
          <div className="prediction-result">
            <span>
              <b>
                {Math.round(item.yesPrice)}
                <small>%</small>
              </b>{" "}
              YES
            </span>
            <span>
              {item.source}
              <small>
                {item.endDate
                  ? `Ends ${new Date(item.endDate).toLocaleDateString([], { month: "short", day: "numeric" })}`
                  : "Open contract"}
              </small>
            </span>
          </div>
          <div className="odds-track">
            <span
              style={{
                width: `${item.yesPrice}%`,
              }}
            />
          </div>
          <time className="quote-time">As of {dateLabel(item.asOf)}</time>
        </>
      )}
    </section>
  );
}
export function ContextPanel() {
  return (
    <div className="context-panels">
      <Markets />
      <Predictions />
    </div>
  );
}
