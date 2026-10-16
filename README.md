# Newsview

A passive news display adapted from Blake News Now. One story fills the main
screen, while a compact rail shows local weather, regional radar, markets, and
prediction odds. Designed for the OnePlus 6T's landscape Blix desktop, with
desktop and portrait layouts too.

The interface uses a black background, white monospace text, and simple borders.
Market prices and percentage changes use green for gains, red for losses and
white for unchanged values, with signs retained on percentage changes.
Photographs and radar retain their original colors. Photographs fill their area
edge to edge with proportional cropping; headlines appear below them. Content
starts at the top of the window with minimal gutters and a single-line footer.

## Launch

From a graphical Linux session with Nix installed:

```sh
./newsview
```

The launcher enters the pinned Nix development shell, installs locked npm
dependencies on first use, builds the frontend when its inputs change, starts
the production server, and opens a separate Firefox app window. Tabs, bookmarks,
toolbars, the sidebar and the address bar are hidden by its profile stylesheet.
OXWM manages it like a terminal: it fills the available tile on an empty desktop
and shares the desktop with other windows. The launcher leaves size and placement
to the window manager, including its bar, borders and gaps.
The dedicated profile lives in `$XDG_STATE_HOME/newsview/firefox`, defaulting to
`~/.local/state/newsview/firefox`. Browser settings and caches persist there.
Old saved window geometry is cleared on launch. Ordinary Firefox profiles are
unaffected. On X11, the app's window class is `newsview`.

Nix provides Firefox, Node, Bash, and the command-line utilities. The first launch
needs network access for dependencies; later launches reuse the Nix store and
project-local build. The host supplies its running X11/Wayland session and GPU
drivers. Ordinary playback uses one Node server and the built frontend.

```sh
./newsview --dev                       # Vite hot reload on 3081; API on 3080
./newsview --server                    # Production server without Firefox
./newsview --connect http://127.0.0.1:3080 # Display an already running server
nix develop                           # Interactive development shell
nix run                               # Packaged production server
```

Closing the Firefox window or pressing Ctrl+C stops processes owned by that
launcher. An occupied port or a second launch of this checkout produces an error.
Connecting to an existing server leaves that server under its original owner.

## Display

- A story advances every 25 seconds. The next photograph is prefetched.
- Source, publication age, headline, and a short publisher excerpt stay visible.
- The playlist balances categories and sources, groups canonical duplicates,
  and suppresses very similar headlines. Existing per-source freshness policies
  are preserved. Undated or expired stories are excluded.
- Weather/radar, markets, and prediction odds stay visible together. Markets fill
  the available space with rows of indices, stocks and crypto quotes, adjusting
  when the window resizes. Remaining quotes and prediction contracts advance
  every 15 seconds automatically without scrolling or selecting tabs.
- Sources default to a modest selection of world, technology, science,
  DC/Virginia, and business reporting. Social sources are available in settings.
- Photographs come from feeds or the article's Open Graph/Twitter metadata.
  While a photograph loads, or if none is available, a bundled Blake News Now
  logo fills the image area on black. Publisher HTML is never displayed.
- Valid cached stories survive an offline restart. Data requests retry with
  backoff and refresh when connectivity returns. Cached context is labeled;
  publication and quote dates remain the original dates.

Move the pointer or tap to reveal controls. **Space** pauses/resumes,
**Left/Right** change story and **S** opens settings. Use your window manager's
usual close shortcut (**Super+Q** in Blix OXWM). Its normal move, resize and
fullscreen shortcuts work too.
Settings pause the story timer. Hidden pages pause polling, rotation and radar.
Reduced-motion preferences disable the progress animation and radar
playback. Dim mode and minute-level pixel shifts of persistent labels support
prolonged viewing.

Settings include ZIP code, timing, radar animation, and individual
sources. The ZIP code changes weather; local news follows the selected sources.
Settings are local to the dedicated browser profile.

To supply initial settings, copy `config/default.json` to `config.local.json`
and edit it. The launcher detects that file, or accepts `NEWSVIEW_CONFIG` as an
absolute filename. Browser-saved settings take precedence. Restore defaults in
the settings dialog to return to the built-in defaults.

| Variable | Purpose |
| --- | --- |
| `NEWSVIEW_PORT` | Launcher API port, default `3080`; development UI uses the next port |
| `NEWSVIEW_CONFIG` | Initial settings JSON file |
| `NEWSVIEW_CACHE_DIR` | Feed/image cache; launcher default `.newsview-cache/` |
| `NEWSVIEW_PROFILE` | Dedicated Firefox profile directory |
| `NEWSVIEW_FIREFOX` | Alternate Firefox executable |
| `HOST`, `PORT` | Packaged server bind address/port; default `127.0.0.1:3080` |
| `FEED_CONCURRENCY` | Concurrent upstream feed requests; launcher/server default `4` |

## Container

The flake provides native `x86_64-linux` and `aarch64-linux` packages and images.
Build on the target architecture or use a matching remote builder. Evaluating
an ARM output on x86 does not build an ARM image.

```sh
nix build .#container
podman load -i result
podman volume create newsview-cache
podman run --rm --name newsview \
  -p 127.0.0.1:3080:3080 \
  -v newsview-cache:/var/cache/newsview \
  newsview:0.1.0
```

Run `./newsview --connect http://127.0.0.1:3080` in the graphical session. The
container serves the application and fetches data; Firefox uses the host's
desktop and accelerated graphics. The image runs as UID/GID `10001`, contains
the production runtime, and stores writable data in `/var/cache/newsview`.
An external bind mount must be writable by that UID; a new named volume inherits
the directory's image ownership. Docker can load and run the same image.

The optional NixOS module enables Podman, imports the matching image, manages a
persistent cache directory, and publishes only a loopback port. To integrate
with a Blix flake, add a `newsview` input pointing at this project (a committed
Git revision or an absolute `path:` input), then import its module in the phone
composition:

```nix
imports = [ inputs.newsview.nixosModules.default ];
services.newsview.enable = true;
services.newsview.port = 3080;
# services.newsview.settings = builtins.fromJSON (builtins.readFile ./newsview.json);
```

Keep the application's nixpkgs input aligned with Blix using
`inputs.newsview.inputs.nixpkgs.follows = "nixpkgs"` when integrating it. The
initial standalone lock uses the same nixpkgs revision as the inspected Blix
checkout. This project does not activate or modify the phone's system configuration.
Use Blix's documented staged boot/reboot workflow when deploying host changes.

## Resource limits and reliability

Feed snapshots retain normalized records, capped at 12 MiB. Images are resized
to fit 1200×900, encoded as WebP, and cached up to 120 images / 96 MiB. Image
fetches allow two active jobs and eight queued jobs. Inputs are bounded by bytes,
dimensions, time, and redirects; each hop resolves only public IPs and pins
those addresses for the connection. SVG content is rejected before decoding.
Image/metadata failures are negatively cached for ten minutes.

The radar retains four historical frames, refreshes metadata every five minutes,
and advances at approximately half a frame per second. It uses RainViewer's
historical precipitation tiles and USGS basemaps. Source availability, image
coverage, quote freshness and API limits depend on the providers. A fresh install
without network access cannot invent a cached edition.

The OnePlus host's actual Firefox acceleration, container support, memory,
temperature, and overnight behavior still need device validation. Its documented
Wi-Fi and suspend issues are independent of this app. Newsview uses the existing
awake desktop session; it does not change power or suspend settings.

## Development and checks

```sh
nix develop
npm ci --ignore-scripts
npm run lint
npm test
npm run build
npm run test:smoke
shellcheck newsview scripts/launch.sh
nix flake check
nix flake check --all-systems --no-build
nix build .#container
```

Browser checks use a separate headless Firefox profile with the app's chrome
stylesheet and fixture data. They check hidden browser controls, landscape,
desktop, portrait and tiled layouts, plus offline recovery. Screenshots go under
ignored `test-results/`:

```sh
nix shell --inputs-from . nixpkgs#geckodriver nixpkgs#firefox \
  --command node scripts/browser-smoke.cjs
node scripts/launcher-smoke.cjs
```

On an OXWM host with `Xvfb`, `xterm` and `xprop`, check tiling in an isolated
virtual X session. This verifies the app's window class, placement beside an
existing terminal, expansion when the terminal closes, and **Super+Q** cleanup:

```sh
nix shell --inputs-from . nixpkgs#xdotool --command node scripts/window-smoke.cjs
```

Add `--live` to the browser smoke script to verify current feeds, weather, and
an actual publisher photograph instead of fixtures. This contacts upstreams.

On a configured Podman host, check the built image with
`node scripts/container-smoke.cjs result`. This tests HTTP, the unprivileged
runtime, and native image conversion into a writable cache. It removes its
temporary container and volume afterward.

The app has no live publisher-page embedding, reader, animated globe, LLM calls,
or cloud-service requirement. The retained backend adapters and policies are
credited in `UPSTREAM` and `LICENSE`.
