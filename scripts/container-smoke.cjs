// Requires a configured Podman host and the built result-container archive.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const name = `newsview-smoke-${process.pid}`;
const volume = `${name}-cache`;
const podman = (...args) =>
  execFileSync("podman", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  podman("load", "-i", process.argv[2] || "result-container");
  podman("volume", "create", volume);
  let started = false;
  try {
    podman(
      "run",
      "--rm",
      "--name",
      name,
      "-d",
      "-p",
      "127.0.0.1::3080",
      "-v",
      `${volume}:/var/cache/newsview`,
      "newsview:0.1.0",
    );
    started = true;
    const address = podman("port", name, "3080/tcp").split("\n")[0];
    const base = `http://${address}`;
    let health;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        health = await fetch(`${base}/health`).then((r) => r.json());
        break;
      } catch {
        await delay(100);
      }
    }
    assert.equal(health?.app, "newsview");
    assert.equal((await fetch(base)).status, 200);
    const source = await fetch(`${base}/api/config`).then((r) => r.json());
    assert.equal(source.zip, "22314");
    assert.equal(
      podman("inspect", "--format", "{{.Config.User}}", name),
      "10001:10001",
    );
    // Exercise native image decoding and writes as the unprivileged image user.
    const imageCheck = `const {ImageCache}=require('./server/images.cjs'); const sharp=require('sharp'); (async()=>{const png=await sharp({create:{width:500,height:300,channels:3,background:'#345'}}).png().toBuffer();const cache=new ImageCache('/var/cache/newsview/images',{fetcher:async url=>({body:png,type:'image/png',url})});const image=await cache.get('https://example.com/container-smoke','https://example.com/photo.png');if((await sharp(image).metadata()).format!=='webp')process.exit(1);console.log('image cache writable');})().catch(e=>{console.error(e);process.exit(1)});`;
    const command = JSON.parse(
      podman("inspect", "--format", "{{json .Config.Cmd}}", name),
    )[0];
    const storeRoot = command.replace(/\/bin\/newsview-server$/, "/lib/newsview");
    const node = fs
      .readFileSync(command, "utf8")
      .match(/exec\s+"([^"]+\/bin\/node)"/)?.[1];
    assert.ok(node, "Packaged launcher names its Node runtime");
    podman("exec", "--workdir", storeRoot, name, node, "-e", imageCheck);
    console.log(
      "PASS: rootless container startup, loopback HTTP/assets, configured non-root user and writable native image cache",
    );
  } catch (error) {
    if (started) {
      try {
        console.error(podman("logs", name));
      } catch {}
    }
    throw error;
  } finally {
    if (started) podman("stop", "--time", "5", name);
    podman("volume", "rm", volume);
  }
})().catch((error) => {
  console.error(
    error.message,
    `exit=${error.status ?? "unknown"} signal=${error.signal ?? "none"}`,
    error.stdout?.toString() || "",
    error.stderr?.toString() || "",
  );
  process.exitCode = 1;
});
