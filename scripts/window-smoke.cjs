// Requires the host's OXWM, Xvfb, xterm and xprop, plus xdotool on PATH.
// All windows and key events stay inside a separate virtual X server.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "newsview-window-"));
  const children = [];
  const launch = (command, args, options = {}) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    child.log = "";
    child.stdout.on("data", (chunk) => { child.log += chunk; });
    child.stderr.on("data", (chunk) => { child.log += chunk; });
    child.once("error", (error) => { child.failure = error; });
    child.done = new Promise((resolve) => child.once("close", resolve));
    children.push(child);
    return child;
  };
  async function until(check, label) {
    for (let attempt = 0; attempt < 150; attempt++) {
      for (const child of children) if (child.failure) throw child.failure;
      const value = check();
      if (value) return value;
      await delay(200);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/health" ? "application/json" : "text/html");
    res.end(req.url === "/health" ? '{"app":"newsview"}' : '<title>Newsview window test</title><body style="margin:0;background:black;color:white">Newsview window test</body>');
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const x = launch("Xvfb", ["-displayfd", "3", "-screen", "0", "1170x540x24", "-nolisten", "tcp", "-noreset"], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    let display = "";
    x.stdio[3].on("data", (chunk) => { display += chunk; });
    await until(() => display.includes("\n"), "virtual X server");
    const env = { ...process.env, DISPLAY: `:${display.trim()}`, WAYLAND_DISPLAY: "", XAUTHORITY: "", MOZ_ENABLE_WAYLAND: "0" };
    const config = path.join(directory, "oxwm.lua");
    await fs.writeFile(config, `
oxwm.set_terminal("xterm")
oxwm.set_tags({ "1", "2" })
oxwm.set_layout("dwindle")
oxwm.set_attach_method("bottom")
oxwm.gaps.set_enabled(true)
oxwm.gaps.set_inner(8, 8)
oxwm.gaps.set_outer(8, 8)
oxwm.border.set_width(2)
oxwm.bar.set_font("monospace:size=10")
oxwm.key.bind({ "Mod4" }, "q", oxwm.client.kill())
`);
    launch("oxwm", ["--config", config], { env });
    const run = (command, args) => execFileSync(command, args, { env, encoding: "utf8", timeout: 5000 });
    const clients = () => run("xprop", ["-root", "_NET_CLIENT_LIST"]).match(/0x[0-9a-f]+/gi) || [];
    const geometry = (id) => Object.fromEntries(
      [...run("xdotool", ["getwindowgeometry", "--shell", id]).matchAll(/^(X|Y|WIDTH|HEIGHT)=(\d+)$/gm)]
        .map(([, key, value]) => [key, Number(value)]),
    );
    const state = (id) => run("xprop", ["-id", id, "WM_CLASS", "_NET_WM_WINDOW_TYPE", "_NET_WM_STATE"]);
    await until(() => run("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"]).includes("window id"), "OXWM startup");
    const terminal = launch("xterm", ["-title", "Newsview peer"], { env });
    const terminalId = await until(() => clients()[0], "terminal window");
    const app = launch("./newsview", ["--connect", `http://127.0.0.1:${server.address().port}`], {
      env: { ...env, NEWSVIEW_PROFILE: path.join(directory, "firefox"), NEWSVIEW_CACHE_DIR: path.join(directory, "cache") },
    });
    const appId = await until(() => clients().find((id) => id !== terminalId), "Newsview window");
    const properties = state(appId);
    assert.match(properties, /WM_CLASS.*"newsview"/i);
    assert.match(properties, /_NET_WM_WINDOW_TYPE_NORMAL/);
    assert.doesNotMatch(properties, /_NET_WM_STATE_FULLSCREEN/);
    function tiled() {
      const a = geometry(appId);
      const b = geometry(terminalId);
      return a.WIDTH < 1000 && b.WIDTH < 1000 && (
        a.X + a.WIDTH <= b.X || b.X + b.WIDTH <= a.X ||
        a.Y + a.HEIGHT <= b.Y || b.Y + b.HEIGHT <= a.Y
      ) && { app: a, terminal: b };
    }
    const split = await until(tiled, "Newsview tiles beside an existing terminal");
    terminal.kill("SIGTERM");
    await terminal.done;
    await until(() => clients().length === 1 && geometry(appId).WIDTH > 1100, "Newsview fills the empty desktop");
    const alone = geometry(appId);
    assert.ok(alone.HEIGHT > 480 && alone.HEIGHT < 540, JSON.stringify(alone));
    assert.ok(alone.X + alone.WIDTH <= 1170 && alone.Y + alone.HEIGHT <= 540, JSON.stringify(alone));
    assert.doesNotMatch(state(appId), /_NET_WM_STATE_FULLSCREEN/);
    run("xdotool", ["windowactivate", "--sync", appId]);
    run("xdotool", ["key", "--clearmodifiers", "super+q"]);
    await until(() => app.exitCode !== null || app.signalCode !== null, "OXWM closes Newsview and its launcher");
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`).then(r => r.json())).app, "newsview");
    await fs.mkdir("test-results", { recursive: true });
    await fs.writeFile("test-results/oxwm-window.json", JSON.stringify({ properties, split, alone }, null, 2));
    console.log("PASS: real OXWM, Newsview window class, tiled beside a terminal, fills the available desktop, normal WM close, external server preserved", { split, alone });
  } catch (error) {
    for (const child of children) if (child.log) console.error(child.log.slice(-1500));
    throw error;
  } finally {
    for (const child of children.reverse()) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await child.done;
      clearTimeout(timer);
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
