export interface FeedItem {
  id: string;
  title: string;
  source: string;
  sourceType: "news" | "tech" | "science" | "social" | "local" | "finance";
  category: string;
  timestamp: string;
  link: string;
  score?: number;
  comments?: number;
  community?: string;
  domain?: string;
  description?: string;
  image?: string;
  isNew?: boolean;
  publisher?: string;
  sourceKind?:
    | "author"
    | "official"
    | "vendor"
    | "journal"
    | "summary"
    | "discovery"
    | "discussion"
    | "reporting";
  contentType?: string;
  timestampKind?:
    | "published"
    | "posted"
    | "trending"
    | "indexed"
    | "updated"
    | "effective";
  activityAt?: string;
  publishedAt?: string;
  publicationDateSource?: string;
  scheduledAt?: string;
  expiresAt?: string | null;
  documentUrl?: string;
  sources?: string[];
  monitoredAuthors?: string[];
  discoverySources?: string[];
  relatedReports?: { source: string; link: string }[];
}

export type MobileView = "feed" | "markets" | "weather" | "more";
