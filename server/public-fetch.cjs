// DNS-pinned, size-bounded public fetching, adapted from Blake News Now's reader.
const dns = require("node:dns").promises;
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");

function isPublicAddress(address) {
  address = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) !== 6) return false;
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice(7);
    const parts = mapped.match(/^([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (!parts) return isPublicAddress(mapped);
    const [high, low] = parts.slice(1).map((x) => parseInt(x, 16));
    return isPublicAddress(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }
  // Only global unicast; exclude documentation and IPv6 transition mechanisms.
  return (
    /^[23][\da-f]{3}:/.test(address) &&
    !/^2001:(?:0:|db8:|10:|20:)/.test(address) &&
    !address.startsWith("2002:")
  );
}

function parsePublicUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Unsupported public URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (net.isIP(host) && !isPublicAddress(host))
  )
    throw new Error("Private address blocked");
  return url;
}

async function resolvePublicHost(url, lookup = dns.lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address))) {
    throw new Error("Private address blocked");
  }
  return addresses;
}

async function fetchPublic(
  value,
  { maxBytes = 1024 * 1024, timeoutMs = 12000, accept = "*/*" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const url = parsePublicUrl(value);
    let dnsTimer;
    const addresses = await Promise.race([
      resolvePublicHost(url),
      new Promise((_, reject) => {
        dnsTimer = setTimeout(
          () => reject(new Error("DNS timeout")),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (Date.now() >= deadline) throw new Error("Fetch timed out");
    const result = await new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(
        url,
        {
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          headers: {
            Accept: accept,
            "Accept-Encoding": "identity",
            "User-Agent": "Newsview/0.1 (personal news display)",
          },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses);
            else {
              const address =
                addresses.find(
                  (x) => !options.family || x.family === options.family,
                ) || addresses[0];
              callback(null, address.address, address.family);
            }
          },
        },
        (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            let redirect;
            try {
              redirect = new URL(response.headers.location, url).href;
            } catch {
              response.destroy();
              reject(new Error("Invalid redirect"));
              return;
            }
            response.destroy();
            resolve({ redirect });
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            response.destroy();
            reject(new Error(`Upstream HTTP ${response.statusCode}`));
            return;
          }
          if (
            Number(response.headers["content-length"]) > maxBytes ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy();
            reject(new Error("Unsupported or oversized response"));
            return;
          }
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              response.destroy(new Error("Response too large"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("aborted", () =>
            reject(new Error("Incomplete response")),
          );
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks),
              type: String(response.headers["content-type"] || "")
                .split(";")[0]
                .toLowerCase(),
              url: url.href,
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    if (!result.redirect) return result;
    value = result.redirect;
  }
  throw new Error("Too many redirects");
}

module.exports = {
  isPublicAddress,
  parsePublicUrl,
  resolvePublicHost,
  fetchPublic,
};
