// Run with geckodriver and Firefox on PATH. Fixture data stays in this test process.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const express = require("express");
const sharp = require("sharp");
const { prepareProfile } = require("./firefox-profile.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      /* Wait for startup/render. */
    }
    await delay(150);
  }
  throw new Error(`Timed out: ${description}`);
}
(async () => {
  const live = process.argv.includes("--live");
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "newsview-browser-"));
  const profile = path.join(cache, "firefox");
  await prepareProfile(profile);
  process.env.NEWSVIEW_CACHE_DIR = cache;
  const { createApp } = require("../server/proxy.cjs");
  const app = express();
  let offline = false;
  const config = { ...require("../config/default.json"), slideSeconds: 10 };
  app.get("/api/config", (_req, res) => res.json(config));
  const photo = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#355347" },
  })
    .webp()
    .toBuffer();
  let imageMode = "ready";
  const waitingImages = [];
  app.get("/api/image", (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (imageMode === "missing") return res.status(404).end();
    if (imageMode === "waiting") return waitingImages.push(res);
    res.type("webp").send(photo);
  });
  const now = new Date(Date.now() - 3600000).toISOString();
  const fixtures = {
    headlines: [
      {
        id: "world",
        title: "A new chapter for the cities shaping our future",
        source: "BBC",
      },
      {
        id: "world2",
        title:
          "Across the country, communities are finding new ways to connect",
        source: "NPR",
      },
    ],
    tech: [
      {
        id: "tech",
        title:
          "Researchers develop a quieter, more efficient way to power the next generation of computers",
        source: "Ars Technica",
      },
    ],
    science: [
      {
        id: "science",
        title:
          "An extraordinary discovery beneath the ocean changes how scientists understand life in the deep",
        source: "Science News",
      },
    ],
    local: [
      {
        id: "local",
        title:
          "New waterfront paths bring Alexandria neighborhoods closer together",
        source: "ALXnow",
      },
    ],
    finance: [
      {
        id: "finance",
        title: "Global markets respond as central banks outline the year ahead",
        source: "BBC Business",
      },
    ],
  };
  for (const [category, items] of Object.entries(fixtures))
    app.get(`/api/${category}`, (_req, res) => {
      if (offline)
        return res
          .status(503)
          .json({ error: "Fixture connection interrupted" });
      res.json(
        items.map((item) => ({
          ...item,
          link: `https://example.com/${item.id}`,
          timestamp: now,
          description:
            "Browser test fixture. This supporting excerpt checks readability and spacing on a small landscape display.",
        })),
      );
    });
  app.get("/api/weather", (_req, res) =>
    res.json({
      temperature: 68,
      condition: "Partly cloudy",
      location: "Alexandria, VA",
      high: 72,
      low: 55,
      lat: 38.8,
      lon: -77.05,
    }),
  );
  app.get("/api/radar", (_req, res) =>
    res.json({
      host: "https://tilecache.rainviewer.com",
      frames: [],
      generated: Date.now() / 1000,
    }),
  );
  const quotes = ["SPX", "DJI", "IXIC", "RUT", "FTSE", "DAX", "N225", "HSI", "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "AMD", "NFLX", "CRM", "BTC", "ETH"].map((symbol, index) => ({
        symbol,
        name: "Market fixture",
        price: 5500 + index,
        changePercent: [0.82, -1.24, 0][index % 3],
        currency: "USD",
        asOf: now,
      }));
  app.get("/api/markets", (_req, res) =>
    res.json({ indices: quotes.slice(0, 8), movers: quotes.slice(8, 18) }),
  );
  app.get("/api/crypto", (_req, res) => res.json(quotes.slice(18)));
  app.get("/api/predictions", (_req, res) =>
    res.json([
      {
        id: "odds",
        question:
          "Will the next central bank decision include an interest rate cut?",
        source: "Polymarket",
        yesPrice: 67,
        asOf: now,
        endDate: new Date(Date.now() + 86400000 * 30).toISOString(),
      },
    ]),
  );
  app.use(createApp());
  const server = (live ? createApp() : app).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const driver = spawn("geckodriver", ["--port", "4447", "--allow-system-access"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let driverLog = "";
  driver.stdout.on("data", (chunk) => {
    driverLog += chunk;
  });
  driver.stderr.on("data", (chunk) => {
    driverLog += chunk;
  });
  const endpoint = "http://127.0.0.1:4447";
  async function command(route, method = "GET", body) {
    const response = await fetch(endpoint + route, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result.value;
  }
  let session;
  try {
    await until(() => command("/status"), "WebDriver startup");
    session = (
      await command("/session", "POST", {
        capabilities: {
          alwaysMatch: {
            browserName: "firefox",
            "moz:firefoxOptions": {
              binary: execFileSync("sh", ["-c", "command -v firefox"], {
                encoding: "utf8",
              }).trim(),
              args: ["--headless", "--profile", profile],
              prefs: {
                "layout.css.devPixelsPerPx": "1.0",
                "browser.shell.checkDefaultBrowser": false,
                "browser.aboutwelcome.enabled": false,
              },
            },
          },
        },
      })
    ).sessionId;
    const execute = (script) =>
      command(`/session/${session}/execute/sync`, "POST", { script, args: [] });
    const navigate = () =>
      command(`/session/${session}/url`, "POST", { url: base });
    await command(`/session/${session}/moz/context`, "POST", { context: "chrome" });
    const chrome = await execute(`return {
      fullscreen: window.fullScreen,
      toolbarHeight: document.querySelector('#navigator-toolbox').getBoundingClientRect().height,
      content: gBrowser.selectedBrowser.getBoundingClientRect().toJSON(),
      width: innerWidth, height: innerHeight
    };`);
    assert.equal(chrome.fullscreen, false, JSON.stringify(chrome));
    assert.equal(chrome.toolbarHeight, 0, JSON.stringify(chrome));
    assert.equal(chrome.content.x, 0, JSON.stringify(chrome));
    assert.equal(chrome.content.y, 0, JSON.stringify(chrome));
    assert.equal(chrome.content.width, chrome.width, JSON.stringify(chrome));
    assert.equal(chrome.content.height, chrome.height, JSON.stringify(chrome));
    await command(`/session/${session}/moz/context`, "POST", { context: "content" });
    await command(`/session/${session}/window/rect`, "POST", {
      width: 1170,
      height: 540,
    });
    await navigate();
    if (live) {
      await until(
        () => execute('return !!document.querySelector(".story h1")'),
        "live stories",
        60000,
      );
      await until(
        () => execute('return !!document.querySelector(".has-photo")'),
        "live article image",
        60000,
      );
      await delay(1500);
      await fs.mkdir("test-results", { recursive: true });
      await fs.writeFile(
        "test-results/live.png",
        Buffer.from(await command(`/session/${session}/screenshot`), "base64"),
      );
      console.log(
        "LIVE:",
        await execute(
          `return { headline: document.querySelector('h1').textContent, image: !!document.querySelector('.has-photo'), weather: document.querySelector('.weather-current').textContent, count: document.querySelector('.story-count').textContent };`,
        ),
      );
      return;
    }
    await until(
      () => execute('return !!document.querySelector(".has-photo h1")'),
      "first story with image",
    );
    await until(
      () =>
        execute(
          'return document.querySelector(".weather-current strong")?.textContent.includes("68")',
        ),
      "weather",
    );
    await until(
      () => execute('return !!document.querySelector(".markets .quote") && !!document.querySelector(".predictions .prediction-result")'),
      "market and prediction data without interaction",
    );
    assert.equal(
      await execute('return document.querySelector(".prediction-result b").textContent'),
      "67%",
    );
    await fs.mkdir("test-results", { recursive: true });
    async function screenshot(name) {
      await fs.writeFile(
        `test-results/${name}.png`,
        Buffer.from(await command(`/session/${session}/screenshot`), "base64"),
      );
    }
    async function checkLayout() {
      const bounds = await execute(
        `return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, title: document.querySelector('h1').getBoundingClientRect().toJSON(), stage: document.querySelector('.main-stage').getBoundingClientRect().toJSON(), footer: document.querySelector('footer').getBoundingClientRect().toJSON() };`,
      );
      assert.ok(bounds.scroll <= bounds.width, JSON.stringify(bounds));
      assert.equal(bounds.stage.x, 0, JSON.stringify(bounds));
      assert.equal(bounds.stage.top, 0, JSON.stringify(bounds));
      assert.equal(await execute('return !!document.querySelector(".masthead")'), false);
      assert.ok(
        bounds.title.top >= bounds.stage.top &&
          bounds.title.bottom <= bounds.stage.bottom,
        JSON.stringify(bounds),
      );
      assert.ok(
        bounds.footer.bottom <= bounds.height + 1 && bounds.footer.height <= 22,
        JSON.stringify(bounds),
      );
      const panels = await execute(
        `return ['.weather-section', '.markets', '.predictions'].map(selector => {
          const element = document.querySelector(selector);
          if (!element) return { selector, visible: false };
          const box = element.getBoundingClientRect();
          const rail = document.querySelector('.info-rail').getBoundingClientRect();
          return { selector, visible: box.width > 0 && box.height > 0 && box.top >= rail.top && box.bottom <= rail.bottom + 1, clipped: element.scrollHeight > element.clientHeight + 1 };
        });`,
      );
      assert.ok(
        panels.every(panel => panel.visible && !panel.clipped),
        JSON.stringify({ width: bounds.width, height: bounds.height, panels }),
      );
      const rows = await execute(`
        const list = document.querySelector('.market-list').getBoundingClientRect();
        const quotes = [...document.querySelectorAll('.markets .quote')].map(el => el.getBoundingClientRect());
        return { count: quotes.length, rowHeight: quotes[0].height, unused: list.bottom - quotes.at(-1).bottom, clipped: quotes.some(row => row.top < list.top || row.bottom > list.bottom + 1) };
      `);
      assert.ok(rows.count >= 2 && !rows.clipped, JSON.stringify(rows));
      if (rows.count < quotes.length) assert.ok(rows.unused < rows.rowHeight + 1, JSON.stringify(rows));
    }
    await delay(700);
    await checkLayout();
    await screenshot("landscape");
    const firstMarkets = await execute('return [...document.querySelectorAll(".markets .quote strong:first-child")].map(el => el.textContent).join("|")');
    // Existing profiles must show both panels even with the former rotate mode.
    await execute(
      `localStorage.setItem('newsview.settings.v1', JSON.stringify(${JSON.stringify({ ...config, sidebarMode: "rotate" })}));`,
    );
    await navigate();
    await until(
      () => execute('return !!document.querySelector(".markets .quote") && !!document.querySelector(".predictions .prediction-question") && !!document.querySelector(".has-photo")'),
      "both panels with legacy saved settings",
    );
    await checkLayout();
    const first = await execute(
      'return document.querySelector("h1").textContent',
    );
    await execute(
      `document.querySelector('[aria-label="Next story"]').click()`,
    );
    await until(
      async () =>
        (await execute('return document.querySelector("h1").textContent')) !==
        first,
      "manual next story",
    );
    await execute(
      `document.querySelector('[aria-label="Pause stories"]').click()`,
    );
    const paused = await execute(
      'return document.querySelector("h1").textContent',
    );
    await delay(11000);
    assert.equal(
      await execute('return document.querySelector("h1").textContent'),
      paused,
    );
    await execute(
      `document.querySelector('[aria-label="Resume stories"]').click()`,
    );
    await until(
      async () =>
        (await execute('return document.querySelector("h1").textContent')) !==
        paused,
      "automatic rotation",
      12000,
    );
    assert.notEqual(
      await execute('return [...document.querySelectorAll(".markets .quote strong:first-child")].map(el => el.textContent).join("|")'),
      firstMarkets,
      "Market rows should rotate automatically when there are more quotes than fit",
    );
    await execute(
      `document.querySelector('[aria-label="Display settings"]').click()`,
    );
    assert.equal(
      await execute('return document.querySelector("dialog").open'),
      true,
    );
    await screenshot("settings");
    await execute(
      'document.querySelector(".settings-fields input[type=checkbox]").click(); document.querySelector("dialog form").requestSubmit()',
    );
    await until(
      () => execute('return JSON.parse(localStorage.getItem("newsview.settings.v1")).radarAnimation === false'),
      "saved radar setting",
    );
    await delay(700);
    const overflowing = await execute(
      `return [...document.querySelectorAll('.context-section')].filter(el => el.scrollHeight > el.clientHeight + 1).map(el => el.className);`,
    );
    assert.deepEqual(overflowing, []);
    await screenshot("all-panels");
    for (const [width, height, name] of [
      [1600, 900, "desktop"],
      [390, 844, "portrait"],
      [1150, 492, "oxwm-desktop"],
      [569, 492, "tiled"],
    ]) {
      await command(`/session/${session}/window/rect`, "POST", {
        width,
        height,
      });
      await delay(400);
      await screenshot(name);
      await checkLayout();
    }
    await command(`/session/${session}/window/rect`, "POST", {
      width: 1170,
      height: 540,
    });
    imageMode = "missing";
    await navigate();
    await until(
      () => execute('const logo = document.querySelector(".story-fallback img"); return logo?.complete && logo.naturalWidth > 0 && !document.querySelector(".story-photo")'),
      "bundled logo after an actual image 404",
    );
    assert.equal(await execute('return document.querySelector(".story-fallback img").alt'), "Blake News Now");
    assert.equal(await execute('return !!document.querySelector(".image-credit")'), false);
    await checkLayout();
    await screenshot("image-fallback");
    await command(`/session/${session}/window/rect`, "POST", { width: 569, height: 492 });
    await delay(400);
    await checkLayout();
    await screenshot("image-fallback-tiled");
    await command(`/session/${session}/window/rect`, "POST", { width: 1170, height: 540 });
    imageMode = "waiting";
    await execute(`document.querySelector('[aria-label="Next story"]').click()`);
    await until(
      async () => waitingImages.length && await execute('return !!document.querySelector(".story-fallback img") && !!document.querySelector(".story-photo")'),
      "logo while a publisher photograph loads",
    );
    imageMode = "ready";
    for (const response of waitingImages.splice(0)) response.type("webp").send(photo);
    await until(
      () => execute('const image = document.querySelector(".has-photo .story-photo"); return image?.complete && image.naturalWidth > 0 && !document.querySelector(".story-fallback")'),
      "publisher photograph replaces the logo when ready",
    );
    offline = true;
    await navigate();
    await until(
      () =>
        execute(
          'return document.querySelector(".edition-status").textContent.includes("OFFLINE")',
        ),
      "offline cached edition",
    );
    assert.ok(
      await execute(
        'return !!document.querySelector("h1") && !!document.querySelector(".markets") && !!document.querySelector(".predictions")',
      ),
    );
    await checkLayout();
    await screenshot("cached");
    await execute(`document.querySelector('[aria-label="Display settings"]').click()`);
    assert.equal(
      await execute('return document.querySelector(".settings-fields input[type=checkbox]").checked'),
      false,
    );
    await execute(`document.querySelector('[aria-label="Close settings"]').click()`);
    offline = false;
    await execute('window.dispatchEvent(new Event("online"))');
    await until(
      () =>
        execute(
          'return !document.querySelector(".edition-status").textContent.includes("OFFLINE")',
        ),
      "network recovery",
    );
    console.log(
      "PASS: managed Firefox with no browser chrome, compact layout, full market lists with automatic paging, phone/desktop/portrait/tiled bounds, logo fallback for missing/loading photos, image recovery, weather, both panels visible, playback, settings persistence and offline recovery",
    );
  } catch (error) {
    console.error(driverLog.slice(-2500));
    throw error;
  } finally {
    if (session) await command(`/session/${session}`, "DELETE").catch(() => {});
    driver.kill("SIGTERM");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(cache, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
