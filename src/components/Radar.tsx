import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingQuery } from "../hooks/usePollingQuery";
import { usePageVisible } from "../hooks/usePageVisible";
import { useMediaQuery } from "../hooks/useMediaQuery";

export interface WeatherData {
  temperature: number | null;
  condition: string;
  location: string;
  high: number | null;
  low: number | null;
  lat: number;
  lon: number;
  windSpeed: number | null;
}
interface RadarData {
  host: string;
  generated: number;
  frames: { time: number; path: string }[];
}
const tileSize = 256,
  zoom = 6,
  columns = 3,
  rows = 3;
function position(lat: number, lon: number) {
  const radians = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * 2 ** zoom,
    y:
      ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) /
        2) *
      2 ** zoom,
  };
}

export function Radar({
  weather,
  animate,
}: {
  weather: WeatherData | null;
  animate: boolean;
}) {
  const radar = usePollingQuery<RadarData>("/api/radar", 300000);
  const visible = usePageVisible();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [frameIndex, setFrameIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useRef(new Map<string, HTMLImageElement>());
  const drawRef = useRef<() => void>(() => {});
  const frames = radar.data?.frames.slice(-4) || [];
  const frame =
    frames[
      (animate && !reduced ? frameIndex : frames.length - 1) % frames.length
    ];
  const lat = weather?.lat,
    lon = weather?.lon;
  const draw = useCallback(() => {
    if (!canvas.current || lat == null || lon == null || !visible) return;
    const target = canvas.current,
      context = target.getContext("2d");
    if (!context) return;
    const { width, height } = target.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (!width || !height) return;
    if (target.width !== Math.round(width * dpr))
      target.width = Math.round(width * dpr);
    if (target.height !== Math.round(height * dpr))
      target.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const point = position(lat, lon);
    const startX = Math.floor(point.x) - 1,
      startY = Math.floor(point.y) - 1;
    const scale = Math.max(width, height) / (2 * tileSize);
    for (const overlay of [false, true]) {
      context.globalAlpha = overlay ? 0.8 : 0.55;
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const x = startX + col,
            y = startY + row;
          const key = `${overlay ? frame?.time : "base"}:${x}:${y}`;
          const image = tiles.current.get(key);
          if (image?.complete && image.naturalWidth)
            context.drawImage(
              image,
              width / 2 + (x - point.x) * tileSize * scale,
              height / 2 + (y - point.y) * tileSize * scale,
              tileSize * scale,
              tileSize * scale,
            );
        }
    }
    context.globalAlpha = 1;
    context.fillStyle = "#fff";
    context.strokeStyle = "#000";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(width / 2, height / 2, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }, [lat, lon, frame?.time, visible]);
  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !animate || reduced || !frames.length) return;
    const timer = setInterval(
      () => setFrameIndex((index) => (index + 1) % frames.length),
      1800,
    );
    return () => clearInterval(timer);
  }, [animate, reduced, visible, frames.length]);
  useEffect(() => {
    tiles.current.clear();
  }, [lat, lon]);
  useEffect(() => {
    if (lat == null || lon == null || !visible) return;
    const point = position(lat, lon);
    const activeFrames = new Set([
      "base",
      ...frames.map((f) => String(f.time)),
    ]);
    for (const key of tiles.current.keys())
      if (!activeFrames.has(key.split(":")[0])) tiles.current.delete(key);
    let active = true;
    setFailed(false);
    for (const overlay of [false, true]) {
      if (overlay && !frame) continue;
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const x = Math.floor(point.x) - 1 + col,
            y = Math.floor(point.y) - 1 + row;
          const key = `${overlay ? frame.time : "base"}:${x}:${y}`;
          if (tiles.current.has(key)) continue;
          const image = new Image();
          tiles.current.set(key, image);
          image.onload = () => {
            if (active) drawRef.current();
          };
          image.onerror = () => {
            if (active) setFailed(true);
          };
          image.referrerPolicy = "no-referrer";
          image.src = overlay
            ? `/api/radar/tile?${new URLSearchParams({ url: `https://tilecache.rainviewer.com${frame.path}/${tileSize}/${zoom}/${x}/${y}/2/1_1.png` })}`
            : `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${zoom}/${y}/${x}`;
        }
    }
    drawRef.current();
    return () => {
      active = false;
    };
    // A metadata refresh prunes frames and updates the tile URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, frame?.time, radar.data, visible]);
  return (
    <div className="radar">
      <canvas
        ref={canvas}
        aria-label="Regional precipitation radar centered on your weather location"
      />
      <div className="radar-label">
        RADAR
        <span>
          {frame
            ? new Date(frame.time * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Waiting"}
        </span>
      </div>
      {(failed || radar.error || radar.cached || !weather) && (
        <span className="radar-status">
          {!weather
            ? "Waiting for location"
            : radar.error || radar.cached
              ? "Cached radar"
              : "Some map tiles unavailable"}
        </span>
      )}
      <div className="radar-credit">
        <span>
          {frames.map((f) => (
            <i
              key={f.time}
              className={f.time === frame?.time ? "active" : ""}
            />
          ))}
        </span>
        <span>RainViewer · USGS</span>
      </div>
    </div>
  );
}
