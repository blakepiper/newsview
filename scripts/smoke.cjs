const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "newsview-smoke-"));
  process.env.NEWSVIEW_CACHE_DIR = cache;
  const { createApp } = require("../server/proxy.cjs");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.app, "newsview");
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Newsview<\/title>/);
    const settings = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.equal(settings.slideSeconds, 25);
    const available = await fetch(`${base}/api/sources`).then((r) => r.json());
    for (const [category, selected] of Object.entries(settings.sources)) {
      for (const name of selected)
        assert.ok(
          available[category].includes(name),
          `Unknown default source: ${category}/${name}`,
        );
    }
    const empty = await fetch(`${base}/api/headlines?sources=`);
    assert.deepEqual(await empty.json(), []);
    assert.equal(
      (await fetch(`${base}/api/image?article=http://127.0.0.1/private`))
        .status,
      404,
    );
    assert.equal(
      (await fetch(`${base}/api/radar/tile?url=https://example.com/image.png`))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/config`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    console.log(
      "PASS: production assets, health, configuration, default sources, empty feeds and public-fetch boundaries",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(cache, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
