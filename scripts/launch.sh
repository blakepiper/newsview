#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"
MODE=production
URL=""
case ${1:-} in
  '') ;;
  --dev) MODE=development ;;
  --server) MODE=server ;;
  --connect) MODE=connect; URL=${2:?Usage: ./newsview --connect URL} ;;
  *) echo "newsview: unknown option: $1" >&2; exit 1 ;;
esac
if [[ $MODE == connect ]]; then
  [[ $# -eq 2 && $URL =~ ^https?:// ]] || { echo 'newsview: supply one HTTP(S) URL.' >&2; exit 1; }
else
  [[ $# -le 1 ]] || { echo 'newsview: unexpected arguments.' >&2; exit 1; }
fi
if [[ $MODE != server && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
  echo 'newsview: start from a graphical session, or use --server.' >&2; exit 1
fi
export PORT=${NEWSVIEW_PORT:-3080}
if [[ ! $PORT =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT >= 65535 )); then
  echo 'newsview: invalid port.' >&2; exit 1
fi
export HOST=127.0.0.1
export NEWSVIEW_CACHE_DIR=${NEWSVIEW_CACHE_DIR:-$ROOT_DIR/.newsview-cache}
[[ ! -f "$ROOT_DIR/config.local.json" ]] || export NEWSVIEW_CONFIG=${NEWSVIEW_CONFIG:-$ROOT_DIR/config.local.json}
mkdir -p "$ROOT_DIR/.newsview-state"
exec 9>"$ROOT_DIR/.newsview-state/launch.lock"
flock -n 9 || { echo 'newsview: this project is already running.' >&2; exit 1; }
PIDS=()
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${PIDS[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready() {
  node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(1500) }).then(async r => { if (!r.ok || (await r.json()).app !== "newsview") process.exit(1); }).catch(() => process.exit(1))' "$1/health" >/dev/null 2>&1
}
if [[ $MODE != connect ]]; then
  node -e 'const s=require("net").createServer(); s.once("error",e=>{console.error("newsview: port occupied:",process.argv[1]);process.exit(1)});s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close())' "$PORT"
  if [[ $MODE == development ]]; then node scripts/prepare.cjs --dev; else node scripts/prepare.cjs; fi
  setsid node server/proxy.cjs &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
  URL="http://127.0.0.1:$PORT"
  for ((attempt=0; attempt<80; attempt++)); do
    kill -0 "$SERVER_PID" 2>/dev/null || { echo 'newsview: server exited during startup.' >&2; exit 1; }
    if ready "$URL"; then break; fi
    sleep 0.25
  done
  ready "$URL" || { echo 'newsview: server did not become ready.' >&2; exit 1; }
  if [[ $MODE == development ]]; then
    export NEWSVIEW_PORT=$PORT
    setsid node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$((PORT+1))" &
    PIDS+=("$!")
    URL="http://127.0.0.1:$((PORT+1))"
    for ((attempt=0; attempt<80; attempt++)); do
      if ready "$URL"; then break; fi
      sleep 0.25
    done
    ready "$URL" || { echo 'newsview: development server did not become ready.' >&2; exit 1; }
  fi
else
  ready "${URL%/}" || { echo 'newsview: URL is not a reachable Newsview server.' >&2; exit 1; }
fi
if [[ $MODE != server ]]; then
  PROFILE=${NEWSVIEW_PROFILE:-${XDG_STATE_HOME:-$HOME/.local/state}/newsview/firefox}
  node "$ROOT_DIR/scripts/firefox-profile.cjs" "$PROFILE"
  echo "newsview: opening dedicated display at $URL"
  MOZ_APP_REMOTINGNAME=newsview setsid "${NEWSVIEW_FIREFOX:-firefox}" \
    --no-remote --profile "$PROFILE" --new-window "$URL" &
  PIDS+=("$!")
fi
wait -n "${PIDS[@]}"
