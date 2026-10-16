const fs = require("node:fs/promises");
const path = require("node:path");

async function prepareProfile(profile) {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  await fs.chmod(profile, 0o700);
  await fs.mkdir(path.join(profile, "chrome"), { recursive: true });
  const config = path.join(__dirname, "../config");
  await fs.copyFile(path.join(config, "firefox-user.js"), path.join(profile, "user.js"));
  await fs.copyFile(
    path.join(config, "firefox-userChrome.css"),
    path.join(profile, "chrome/userChrome.css"),
  );

  // Drop geometry saved by the old kiosk launcher. Let the window manager
  // choose placement on every launch, preserving the rest of the profile.
  const store = path.join(profile, "xulstore.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(store, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return;
    throw error;
  }
  const window = state?.["chrome://browser/content/browser.xhtml"]?.["main-window"];
  if (!window || typeof window !== "object") return;
  for (const key of ["sizemode", "screenX", "screenY", "width", "height"])
    delete window[key];
  await fs.writeFile(store, JSON.stringify(state));
}

module.exports = { prepareProfile };
if (require.main === module) {
  const profile = process.argv[2];
  if (!profile) throw new Error("Usage: node scripts/firefox-profile.cjs PROFILE");
  prepareProfile(profile).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
