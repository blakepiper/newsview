{ lib, buildNpmPackage, nodejs_24, makeWrapper, cacert }:

buildNpmPackage {
  pname = "newsview";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let name = baseNameOf path;
      in !(builtins.elem name [ ".git" "node_modules" "dist" ".newsview-cache" ".newsview-state" "test-results" "result" "config.local.json" ])
        && !(lib.hasPrefix "result-" name);
  };
  nodejs = nodejs_24;
  npmDepsHash = "sha256-3XF14NJeaOxNgzqIfnaqKNtnKq37OPT0PPr1qpHAB5Y=";
  npmRebuildFlags = [ "--ignore-scripts" ];
  nativeBuildInputs = [ makeWrapper ];
  # Sharp locates its bundled libvips through $ORIGIN. Node supplies the C/C++
  # runtime closure. Rewriting these vendor ELF files breaks native loading.
  dontPatchELF = true;
  dontStrip = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm run lint
    npm test
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --ignore-scripts --offline
    mkdir -p "$out/lib/newsview" "$out/bin"
    cp -r dist server shared config package.json node_modules "$out/lib/newsview/"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/newsview-server" \
      --add-flags "$out/lib/newsview/server/proxy.cjs" \
      --set NODE_ENV production \
      --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    node - "$out/lib/newsview" <<'JS'
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const sharp = require(path.join(process.argv[2], 'node_modules/sharp'));
    (async () => {
      const image = await sharp({ create: {
        width: 500, height: 300, channels: 3, background: '#345'
      } }).webp().toBuffer();
      assert.equal((await sharp(image).metadata()).format, 'webp');
      console.log('Installed native image runtime passed');
    })().catch(error => { console.error(error); process.exit(1); });
    JS
    runHook postInstallCheck
  '';
  meta = {
    description = "Passive news, weather and market display";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" "aarch64-linux" ];
    mainProgram = "newsview-server";
  };
}
