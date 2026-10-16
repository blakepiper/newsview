const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const stateDir = path.join(root, ".newsview-state");
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const stateFile = path.join(stateDir, "build.json");
let state = {};
try {
  state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
} catch {
  /* First launch. */
}
function fingerprint(paths) {
  const hash = createHash("sha256");
  const visit = (file) => {
    const absolute = path.join(root, file);
    if (fs.statSync(absolute).isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort())
        visit(path.join(file, child));
    } else hash.update(file).update(fs.readFileSync(absolute));
  };
  paths.forEach(visit);
  return hash.digest("hex");
}
const dependencies =
  fingerprint(["package.json", "package-lock.json"]) +
  process.version +
  process.arch;
if (
  state.dependencies !== dependencies ||
  !fs.existsSync(path.join(root, "node_modules/.bin/vite"))
) {
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
  });
  state.dependencies = dependencies;
  delete state.build;
}
if (process.argv[2] !== "--dev") {
  const build = fingerprint([
    "src",
    "shared",
    "public",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "package-lock.json",
    "config/default.json",
    "scripts/compress-assets.cjs",
  ]);
  if (
    state.build !== build ||
    !fs.existsSync(path.join(root, "dist/index.html"))
  ) {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    state.build = build;
  }
}
fs.writeFileSync(stateFile, JSON.stringify(state) + "\n");
