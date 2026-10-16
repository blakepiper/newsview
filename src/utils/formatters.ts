import type { FeedItem } from "../types.ts";

import {
  SCIENTIST_SOURCES,
  sourceWindowDays,
} from "../../shared/source-policy.js";
export { SCIENTIST_SOURCES } from "../../shared/source-policy.js";

export function isScientistSource(source: string): boolean {
  return SCIENTIST_SOURCES.some((name) => name === source);
}

export function getFeedItemMaxAge(source: string): number {
  return sourceWindowDays(source) * 24 * 60 * 60 * 1000;
}

export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

export function formatScore(score: number): string {
  if (score >= 10000) return (score / 1000).toFixed(0) + "k";
  if (score >= 1000) return (score / 1000).toFixed(1) + "k";
  return score.toString();
}

export function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    NPR: "bg-blue-500",
    Bloomberg: "bg-amber-600",
    "Financial Times": "bg-rose-600",
    "Wall Street Journal": "bg-slate-400",
    "CNBC Economy": "bg-blue-600",
    "CNBC IPOs": "bg-violet-600",
    CoinDesk: "bg-yellow-600",
    "BBC Business": "bg-amber-500",
    "Guardian Business": "bg-indigo-500",
    ECB: "bg-emerald-700",
    "WTO News": "bg-teal-700",

    BBC: "bg-amber-500",
    "CBC News": "bg-red-600",
    DW: "bg-blue-700",
    Guardian: "bg-indigo-500",
    "Al Jazeera": "bg-orange-500",
    Haaretz: "bg-sky-700",
    "ABC News": "bg-yellow-500",
    "CBS News": "bg-cyan-500",
    "NY Times": "bg-slate-400",
    "Google Trends": "bg-green-500",
    "PBS NewsHour": "bg-indigo-600",
    "NBC News": "bg-blue-600",
    Axios: "bg-sky-600",
    "The Hill": "bg-cyan-700",
    Vox: "bg-rose-600",
    "Hacker News": "bg-orange-400",
    "Ars Technica": "bg-orange-500",
    "The Verge": "bg-purple-500",
    TechCrunch: "bg-green-500",
    Wired: "bg-gray-600",
    Lobsters: "bg-red-600",
    "MIT Technology Review": "bg-red-700",
    BleepingComputer: "bg-sky-700",
    "Rest of World": "bg-lime-700",
    "The Register": "bg-rose-700",
    "404 Media": "bg-violet-700",
    "Fox News": "bg-blue-700",
    Politico: "bg-red-500",
    Semafor: "bg-amber-600",
    "The Intercept": "bg-green-600",
    ProPublica: "bg-yellow-600",
    "Foreign Policy": "bg-teal-600",
    Breitbart: "bg-orange-700",
    GDELT: "bg-slate-500",
    "France 24": "bg-blue-500",
    RFI: "bg-red-500",
    "VOA Africa": "bg-blue-600",
    "VOA East Asia": "bg-cyan-600",
    "VOA China": "bg-red-600",
    "VOA Worldwide in Five": "bg-indigo-600",
    "The Hindu": "bg-orange-500",
    "Indian Express": "bg-amber-600",
    SCMP: "bg-red-700",
    "El Pais": "bg-slate-600",
    Euronews: "bg-blue-700",
    "The New Humanitarian": "bg-orange-600",
    "African Arguments": "bg-emerald-700",
    "The Conversation": "bg-teal-600",
    "White House": "bg-blue-700",
    "Defense.gov": "bg-green-700",
    "Congress.gov": "bg-indigo-700",
    CISA: "bg-cyan-700",
    NOAA: "bg-sky-700",
    SEC: "bg-violet-700",
    "Federal Reserve": "bg-emerald-700",
    BLS: "bg-teal-700",
    EIA: "bg-yellow-700",
    "FDA Press Releases": "bg-pink-700",
    "FDA Recalls": "bg-rose-700",
    "CDC Travel Notices": "bg-green-700",
    "FactCheck.org": "bg-lime-700",
    Snopes: "bg-purple-700",
    ICIJ: "bg-amber-700",
    Bellingcat: "bg-fuchsia-700",
    KrebsOnSecurity: "bg-red-700",
    "Dark Reading": "bg-orange-600",
    "IEEE Spectrum": "bg-blue-600",
    "The Markup": "bg-green-700",
    "GitHub Engineering": "bg-gray-700",
    "GitHub Security": "bg-gray-600",
    "OpenAI News": "bg-emerald-600",
    "Google AI": "bg-blue-600",
    "AWS News": "bg-orange-600",
    Cloudflare: "bg-orange-700",
    "/news/": "bg-green-700",
    "/pol/": "bg-amber-700",
    "/lit/": "bg-fuchsia-700",
    "Bluesky Discover": "bg-sky-600",
    "Mastodon Trending": "bg-violet-600",
    ScienceDaily: "bg-emerald-500",
    "Phys.org": "bg-teal-500",
    "Science News": "bg-cyan-600",
    "Live Science": "bg-lime-600",
    "Quanta Magazine": "bg-violet-500",
    NASA: "bg-blue-500",
    "AAAS Science News": "bg-sky-600",
    Nature: "bg-red-600",
    Science: "bg-red-500",
    PNAS: "bg-indigo-500",
    Cell: "bg-purple-600",
    "Science Advances": "bg-fuchsia-600",
    eLife: "bg-yellow-600",
    "PLOS ONE": "bg-orange-600",
    "The Lancet": "bg-rose-600",
    NEJM: "bg-red-700",
    "APS Psychology": "bg-cyan-500",
    "Neuroscience News Psychology": "bg-violet-600",
    "Frontiers in Psychology": "bg-indigo-600",
    "Human Factors": "bg-teal-600",
    Ergonomics: "bg-emerald-700",
    "Carbon Brief": "bg-green-600",
    Mongabay: "bg-lime-700",
    STAT: "bg-pink-600",
    WHO: "bg-blue-600",
    Undark: "bg-slate-600",
    "Karl Friston": "bg-indigo-500",
    "Michael Levin": "bg-teal-500",
    "Chris Fields": "bg-violet-500",
    "Geoffrey Hinton": "bg-blue-500",
    "Yann LeCun": "bg-cyan-500",
    "Percy Liang": "bg-emerald-500",
    "Stuart Russell": "bg-amber-500",
    "Yoshua Bengio": "bg-indigo-600",
    "Fei-Fei Li": "bg-blue-600",
    "Yejin Choi": "bg-cyan-600",
    "Dawn Song": "bg-teal-600",
    "Chris Olah": "bg-violet-600",
    "Neel Nanda": "bg-purple-600",
    "Paul Christiano": "bg-sky-600",
    "Dan Hendrycks": "bg-amber-600",
    "Myles Allen": "bg-emerald-600",
    "Piers Forster": "bg-teal-600",
    "Gavin Schmidt": "bg-cyan-600",
    "Friederike Otto": "bg-green-600",
    "Richard Alley": "bg-sky-600",
    "Corinne Le Quéré": "bg-lime-600",
    "Marshall Burke": "bg-emerald-600",
    "Jesse Jenkins": "bg-teal-600",
    "Michael Mann": "bg-green-600",
    "Zeke Hausfather": "bg-cyan-600",
    "Matt Kaeberlein": "bg-indigo-600",
    "Valter Longo": "bg-green-600",
    "David Sinclair": "bg-blue-600",
    "Steve Horvath": "bg-violet-600",
    "Michael Snyder": "bg-cyan-600",
    "Herman Pontzer": "bg-amber-600",
    "Vishwa Deep Dixit": "bg-teal-600",
    "Rhonda Patrick": "bg-emerald-600",
    "Peter Attia": "bg-sky-600",
    "Chris Masterjohn": "bg-purple-600",
    "Lisa Kaltenegger": "bg-indigo-600",
    "Nikku Madhusudhan": "bg-violet-600",
    "Sara Seager": "bg-blue-600",
    "David Kipping": "bg-sky-600",
    "Victoria Meadows": "bg-cyan-600",
    "Ravi Kopparapu": "bg-teal-600",
    "Jessie Christiansen": "bg-purple-600",
    "Kevin Hand": "bg-slate-600",
    "Sara Imari Walker": "bg-fuchsia-600",
    "Jason Wright": "bg-indigo-600",
    "Jennifer Doudna": "bg-emerald-600",
    "Feng Zhang": "bg-blue-600",
    "David Liu": "bg-violet-600",
    "George Church": "bg-purple-600",
    "Jay Keasling": "bg-green-600",
    "James Collins": "bg-teal-600",
    "Pamela Silver": "bg-pink-600",
    "Drew Endy": "bg-cyan-600",
    "Timothy Lu": "bg-sky-600",
    "Cameron Myhrvold": "bg-indigo-600",
    WTOP: "bg-blue-700",
    WAMU: "bg-purple-700",
    "Alexandria City": "bg-cyan-700",
    "Alexandria Times": "bg-red-700",
    ALXnow: "bg-orange-700",
    "Virginia Mercury": "bg-amber-700",
    "Washington Post Local": "bg-slate-500",
    "DC News Now": "bg-indigo-700",
    "Washington City Paper": "bg-rose-700",
    "Washington Blade": "bg-pink-700",
  };
  if (source.startsWith("c/")) return "bg-emerald-600";
  return colors[source] || "bg-gray-500";
}

export function getSourceCategory(source: string): FeedItem["sourceType"] {
  const techSources = [
    "Hacker News",
    "/g/",
    "4chan /g/",
    "Ars Technica",
    "The Verge",
    "TechCrunch",
    "Wired",
    "Lobsters",
    "MIT Technology Review",
    "BleepingComputer",
    "Rest of World",
    "The Register",
    "404 Media",
    "KrebsOnSecurity",
    "Dark Reading",
    "IEEE Spectrum",
    "The Markup",
    "GitHub Engineering",
    "GitHub Security",
    "OpenAI News",
    "Google AI",
    "AWS News",
    "Cloudflare",
  ];
  const scienceSources = [
    ...SCIENTIST_SOURCES,
    "KFF Health News",
    "ScienceDaily",
    "Phys.org",
    "Science News",
    "Live Science",
    "Quanta Magazine",
    "NASA",
    "AAAS Science News",
    "Nature",
    "Science",
    "PNAS",
    "Cell",
    "Science Advances",
    "eLife",
    "PLOS ONE",
    "The Lancet",
    "NEJM",
    "APS Psychology",
    "Neuroscience News Psychology",
    "Frontiers in Psychology",
    "Human Factors",
    "Ergonomics",
    "Carbon Brief",
    "Mongabay",
    "STAT",
    "WHO",
    "Undark",
  ];
  const financeSources = [
    "BEA",
    "USTR",
    "Federal Register Trade",
    "SEC IPO Filings",
    "SEC Foreign IPO Filings",
    "Bank of Japan",
    "CFTC",
    "Ethereum Foundation",
    "Bloomberg",
    "Financial Times",
    "Wall Street Journal",
    "SEC",
    "Federal Reserve",
    "BLS",
    "EIA",
    "CNBC Economy",
    "CNBC IPOs",
    "CoinDesk",
    "BBC Business",
    "Guardian Business",
    "ECB",
    "WTO News",
  ];
  const localSources = [
    "WMATA Alerts",
    "Alexandria Council",
    "WTOP",
    "WAMU",
    "Alexandria City",
    "Alexandria Times",
    "ALXnow",
    "Virginia Mercury",
    "Washington Post Local",
    "DC News Now",
    "Washington City Paper",
    "Washington Blade",
  ];
  if (techSources.includes(source)) return "tech";
  if (scienceSources.includes(source)) return "science";
  if (localSources.includes(source)) return "local";
  if (financeSources.includes(source)) return "finance";
  if (source.startsWith("c/")) return "social";
  if (source.startsWith("/") && source.endsWith("/")) return "social";
  if (["Bluesky Discover", "Mastodon Trending"].includes(source))
    return "social";
  return "news";
}

export function getCategoryDotColor(
  sourceType: FeedItem["sourceType"],
): string {
  switch (sourceType) {
    case "news":
      return "bg-blue-400";
    case "tech":
      return "bg-purple-400";
    case "science":
      return "bg-emerald-400";
    case "social":
      return "bg-orange-400";
    case "local":
      return "bg-cyan-400";
    case "finance":
      return "bg-amber-400";
  }
}

export function getDomain(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace("www.", "").slice(0, 15);
  } catch {
    return "";
  }
}
