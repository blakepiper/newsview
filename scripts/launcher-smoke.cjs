const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "newsview-launcher-"),
  );
  const stub = path.join(directory, "firefox");
  await fs.writeFile(
    stub,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$NEWSVIEW_CAPTURE"\nprintf "%s\\n" "$MOZ_APP_REMOTINGNAME" > "$NEWSVIEW_CAPTURE.class"\nexec sleep 300\n',
    { mode: 0o755 },
  );
  const probe = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = {
    ...process.env,
    DISPLAY: ":99",
    NEWSVIEW_FIREFOX: stub,
    NEWSVIEW_PORT: String(port),
    NEWSVIEW_PROFILE: path.join(directory, "profile"),
    NEWSVIEW_CAPTURE: path.join(directory, "args"),
    NEWSVIEW_CACHE_DIR: path.join(directory, "cache"),
  };
  const browserDocument = "chrome://browser/content/browser.xhtml";
  await fs.mkdir(env.NEWSVIEW_PROFILE);
  await fs.writeFile(path.join(env.NEWSVIEW_PROFILE, "xulstore.json"), JSON.stringify({
    [browserDocument]: {
      "main-window": { sizemode: "fullscreen", screenX: "100", screenY: "100", width: "800", height: "600", unrelated: "keep" },
      "sidebar-box": { sidebarcommand: "viewBookmarksSidebar" },
    },
  }));
  const children = new Set();
  const launch = (args = [], overrides = {}) => {
    const child = spawn("./newsview", args, {
      env: { ...env, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    child.result = new Promise((resolve) =>
      child.once("exit", (code, signal) => {
        children.delete(child);
        resolve({ code, signal, log });
      }),
    );
    child.log = () => log;
    return child;
  };
  async function ready(child) {
    for (let attempt = 0; attempt < 240; attempt++) {
      if (child.exitCode !== null) throw new Error(child.log());
      try {
        if (
          (await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()))
            .app === "newsview"
        )
          return;
      } catch {
        /* Starting. */
      }
      await delay(500);
    }
    throw new Error("Launcher readiness timeout: " + child.log());
  }
  async function stop(child) {
    child.kill("SIGTERM");
    return Promise.race([
      child.result,
      delay(5000).then(() => {
        if (children.has(child)) throw new Error("Launcher did not clean up");
      }),
    ]);
  }
  try {
    const first = launch();
    await ready(first);
    let args;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        args = await fs.readFile(env.NEWSVIEW_CAPTURE, "utf8");
        break;
      } catch {
        await delay(100);
      }
    }
    assert.equal(args, `--no-remote\n--profile\n${env.NEWSVIEW_PROFILE}\n--new-window\nhttp://127.0.0.1:${port}\n`);
    assert.equal(await fs.readFile(env.NEWSVIEW_CAPTURE + ".class", "utf8"), "newsview\n");
    assert.match(
      await fs.readFile(path.join(env.NEWSVIEW_PROFILE, "user.js"), "utf8"),
      /resume_from_crash/,
    );
    assert.match(
      await fs.readFile(path.join(env.NEWSVIEW_PROFILE, "user.js"), "utf8"),
      /user_pref\("toolkit.legacyUserProfileCustomizations.stylesheets", true\)/,
    );
    assert.match(
      await fs.readFile(path.join(env.NEWSVIEW_PROFILE, "chrome/userChrome.css"), "utf8"),
      /#navigator-toolbox/,
    );
    const saved = JSON.parse(await fs.readFile(path.join(env.NEWSVIEW_PROFILE, "xulstore.json"), "utf8"));
    assert.deepEqual(saved[browserDocument]["main-window"], { unrelated: "keep" });
    assert.deepEqual(saved[browserDocument]["sidebar-box"], { sidebarcommand: "viewBookmarksSidebar" });
    const duplicate = await launch().result;
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.log, /already running/);
    await stop(first);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
    const headless = launch(["--server"], { DISPLAY: "", WAYLAND_DISPLAY: "" });
    await ready(headless);
    await stop(headless);
    const occupied = net.createServer().listen(port, "127.0.0.1");
    await new Promise((resolve) => occupied.once("listening", resolve));
    try {
      const conflict = await launch(["--server"]).result;
      assert.equal(conflict.code, 1);
      assert.match(conflict.log, /port occupied/);
      assert.equal(occupied.listening, true);
    } finally {
      await new Promise((resolve) => occupied.close(resolve));
    }
    console.log(
      "PASS: real Nix launcher, managed app window, isolated chrome-free profile, saved fullscreen migration, duplicate detection, owned-process cleanup, server mode and occupied-port handling",
    );
  } finally {
    for (const child of children) await stop(child);
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
