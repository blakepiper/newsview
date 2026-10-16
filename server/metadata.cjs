const { Parser } = require("htmlparser2");
const { parsePublicUrl } = require("./public-fetch.cjs");

function imageUrl(value, base) {
  try {
    if (typeof value !== "string" || !value.trim() || value.length > 4096)
      return null;
    return parsePublicUrl(new URL(value.trim(), base).href).href;
  } catch {
    return null;
  }
}

function extractMetadata(html, base, allowInline = false) {
  const candidates = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "meta") {
          const key = (attrs.property || attrs.name || "").toLowerCase();
          if (
            [
              "og:image",
              "og:image:url",
              "og:image:secure_url",
              "twitter:image",
              "twitter:image:src",
            ].includes(key)
          ) {
            candidates.push({
              url: attrs.content,
              priority: key.startsWith("og:") ? 0 : 1,
            });
          }
        }
        if (
          allowInline &&
          name === "img" &&
          !(Number(attrs.width) > 0 && Number(attrs.width) < 120)
        ) {
          candidates.push({ url: attrs.src, priority: 2 });
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(String(html).slice(0, 1024 * 1024));
  return (
    candidates
      .sort((a, b) => a.priority - b.priority)
      .map((x) => imageUrl(x.url, base))
      .find(Boolean) || null
  );
}

function extractFeedImage(entry, base, description) {
  const array = (value) =>
    value == null ? [] : Array.isArray(value) ? value : [value];
  const groups = [entry, ...array(entry["media:group"])];
  for (const name of ["media:content", "enclosure", "media:thumbnail"]) {
    const candidates = groups
      .flatMap((group) => array(group[name]))
      .filter((x) => x && typeof x === "object")
      .filter((x) => !x["@_type"] || x["@_type"].startsWith("image/"))
      .filter((x) => !x["@_medium"] || x["@_medium"] === "image")
      .sort((a, b) => Number(b["@_width"] || 0) - Number(a["@_width"] || 0));
    for (const item of candidates) {
      const candidate = imageUrl(item["@_url"], base);
      if (candidate && !/\.(?:mp4|mp3|m3u8)(?:\?|$)/i.test(candidate))
        return candidate;
    }
  }
  return extractMetadata(description || "", base, true);
}

module.exports = { imageUrl, extractMetadata, extractFeedImage };
