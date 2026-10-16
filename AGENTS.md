# Newsview

This is a local, Nix-packaged passive display adapted from Blake News Now.
Keep the main interface readable without interaction on the OnePlus 6T's
landscape desktop. Normal use serves production assets, with Vite only in
explicit development mode.

Keep the UI minimal and terminal-style: black and white, monospace text, plain
borders. Market prices and changes use green for gains, red for losses and neutral
white for unchanged values. Article photographs and radar retain their original colors. Avoid
decorative gradients, serif type and slogans.
Use the full window: no masthead, minimal gutters and a compact single-line footer.
Weather/radar, markets and predictions must stay visible together without tabs
or user interaction. Fill the available market area with quote rows, paging any
overflow automatically. Rotate prediction contracts within their panel.

Use `nix develop` for tools. Run `npm run lint`, `npm test`, `npm run build`,
and `npm run test:smoke` for application logic changes. Launcher edits also
require ShellCheck. Nix edits require native package/container builds and
`nix flake check --all-systems --no-build`; report ARM execution separately
from evaluation. Use `scripts/browser-smoke.cjs` for meaningful UI changes.

- Preserve feed dates, source selection, freshness, failure isolation and SSRF
  protections. Keep caches, fetch queues and image dimensions bounded.
- Cache useful data across outages without presenting old observations as live.
- Default social sources to off; preserve explicit saved selections.
- Pause work on hidden pages. Preload only the next story's image.
- Keep Firefox in a dedicated profile and never modify the user's ordinary one.
- Hide browser chrome through that profile's stylesheet. Open a normal managed
  window so OXWM controls tiling and size; do not launch in fullscreen kiosk mode.
- Keep application code in this repository. Blix owns host activation, graphics,
  power policy and container runtime deployment.
- Do not imply that x86 tests or ARM evaluation prove performance on the phone.

`server/` contains copied adapters and new image handling; `shared/` owns source
policy; `src/` contains the display and playback; `nix/` owns packaging and the
optional container module. Keep README commands aligned with the launcher.
