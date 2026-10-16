import defaults from "../config/default.json";

export const categories = [
  "headlines",
  "tech",
  "science",
  "local",
  "finance",
  "social",
] as const;
export type Category = (typeof categories)[number];
export type Sources = Record<Category, string[]>;
export interface Settings {
  zip: string;
  slideSeconds: number;
  radarAnimation: boolean;
  dim: boolean;
  sources: Sources;
}
export const categoryNames: Record<Category, string> = {
  headlines: "World & national",
  tech: "Technology",
  science: "Science",
  local: "DC & Virginia",
  finance: "Business",
  social: "Social",
};
export const DEFAULT_SETTINGS = defaults as Settings;
export function normalizeSettings(input: unknown): Settings {
  const value =
    input && typeof input === "object" ? (input as Partial<Settings>) : {};
  return {
    zip:
      typeof value.zip === "string" && /^\d{5}$/.test(value.zip)
        ? value.zip
        : defaults.zip,
    slideSeconds:
      typeof value.slideSeconds === "number" &&
      Number.isFinite(value.slideSeconds)
        ? Math.max(10, Math.min(120, Math.round(value.slideSeconds)))
        : defaults.slideSeconds,
    radarAnimation:
      typeof value.radarAnimation === "boolean" ? value.radarAnimation : true,
    dim: value.dim === true,
    sources: Object.fromEntries(
      categories.map((category) => [
        category,
        Array.isArray(value.sources?.[category])
          ? [
              ...new Set(
                value.sources[category].filter(
                  (name): name is string =>
                    typeof name === "string" &&
                    name.length > 0 &&
                    name.length < 120,
                ),
              ),
            ].slice(0, 150)
          : defaults.sources[category],
      ]),
    ) as Sources,
  };
}
