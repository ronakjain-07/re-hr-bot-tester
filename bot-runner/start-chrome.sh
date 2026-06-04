#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  start-chrome.sh
#  Starts Chrome with --remote-debugging-port for Playwright CDP.
#
#  Modes (set via env):
#    HR_CHROME_PARALLEL=1   DEFAULT — second Chrome window; your normal
#                           Chrome stays open for parallel work. Automation
#                           profile lives in ~/.hr-bot-chrome-automation
#                           (login copied once from your profile folder).
#
#    HR_CHROME_PARALLEL=0   Live mode — same Chrome data as daily browser;
#                           requires fully quitting Chrome first (Cmd+Q).
#
#    HR_CHROME_USE_COPY=1   Legacy fresh /tmp copy each run (not recommended).
#
#  Usage:  ./start-chrome.sh [profile-name]
#  Example: ./start-chrome.sh "Profile 3"
# ─────────────────────────────────────────────────────────────

PROFILE="${1:-${HR_CHROME_PROFILE:-Profile 3}}"
DEBUG_PORT="${HR_CHROME_DEBUG_PORT:-9222}"
# Prefer CHAT_URL from the repo .env so the automation window opens the configured DM.
if [ -z "$CHAT_URL" ]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
  if [ -f "$ENV_FILE" ]; then
    CHAT_URL="$(grep -E '^CHAT_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
  fi
fi
CHAT_URL="${CHAT_URL:-https://mail.google.com/mail/u/1/#chat/dm/1LNbeyAAAAE}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC_USER_DATA="${HR_CHROME_USER_DATA:-$HOME/Library/Application Support/Google/Chrome}"
USE_COPY="${HR_CHROME_USE_COPY:-0}"
PARALLEL="${HR_CHROME_PARALLEL:-1}"
PARALLEL_DATA="${HR_CHROME_PARALLEL_DATA:-$HOME/.hr-bot-chrome-automation}"
CDP_HOST="${HR_CHROME_CDP_HOST:-127.0.0.1}"

cdp_ok() {
  curl -sf "http://${CDP_HOST}:${DEBUG_PORT}/json/version" >/dev/null 2>&1
}

chrome_running() {
  pgrep -xq "Google Chrome" 2>/dev/null
}

port_in_use() {
  lsof -ti tcp:"$DEBUG_PORT" >/dev/null 2>&1
}

seed_parallel_profile() {
  if [ -f "$PARALLEL_DATA/Local State" ] && [ -d "$PARALLEL_DATA/$PROFILE" ]; then
    return 0
  fi
  if [ ! -d "$SRC_USER_DATA/$PROFILE" ]; then
    return 1
  fi
  echo "📋 First-time setup: copying '$PROFILE' into automation Chrome (one time)…"
  mkdir -p "$PARALLEL_DATA"
  if [ -f "$SRC_USER_DATA/Local State" ]; then
    cp "$SRC_USER_DATA/Local State" "$PARALLEL_DATA/Local State"
  fi
  cp -R "$SRC_USER_DATA/$PROFILE" "$PARALLEL_DATA/$PROFILE" 2>/dev/null
  echo "✅ Automation profile ready at $PARALLEL_DATA"
}

# ── CDP already up — attach only ─────────────────────────────
if cdp_ok; then
  echo "✅ Chrome CDP already listening on ${CDP_HOST}:${DEBUG_PORT}"
  if [ "$PARALLEL" = "1" ]; then
    echo "   Use the automation Chrome window for HR bot Chat (not your other Chrome)."
  else
    echo "   Tests attach to your open Chrome — no new window needed."
  fi
  exit 0
fi

if port_in_use; then
  echo "❌ Port $DEBUG_PORT is in use but CDP is not responding."
  echo "   Close the stuck Chrome/debug process or set HR_CHROME_DEBUG_PORT to another port."
  exit 3
fi

# ── Sanity checks ────────────────────────────────────────────
if [ ! -f "$CHROME" ]; then
  echo "❌ Chrome not found at: $CHROME"
  exit 1
fi

if [ ! -d "$SRC_USER_DATA/$PROFILE" ]; then
  echo "❌ Profile not found: $SRC_USER_DATA/$PROFILE"
  echo "   Run: node find-profile.js   to see available profiles."
  exit 1
fi

PROFILE_DIR="$PROFILE"

if [ "$USE_COPY" = "1" ]; then
  TEMP_DATA_DIR="/tmp/hr-bot-chrome-session"
  echo "⚠️  Copy mode: fresh temp profile at $TEMP_DATA_DIR"
  rm -rf "$TEMP_DATA_DIR"
  mkdir -p "$TEMP_DATA_DIR"
  if [ -f "$SRC_USER_DATA/Local State" ]; then
    cp "$SRC_USER_DATA/Local State" "$TEMP_DATA_DIR/Local State"
  fi
  cp -R "$SRC_USER_DATA/$PROFILE" "$TEMP_DATA_DIR/$PROFILE" 2>/dev/null
  USER_DATA_ARG="$TEMP_DATA_DIR"

elif [ "$PARALLEL" = "1" ]; then
  echo "🪟 Parallel mode — your normal Chrome can stay open."
  echo "   Automation opens a separate Chrome window (profile: $PROFILE)."
  echo "   Open HR bot Chat in THAT window; use your other Chrome for everything else."
  mkdir -p "$PARALLEL_DATA"
  seed_parallel_profile || true
  USER_DATA_ARG="$PARALLEL_DATA"

else
  if chrome_running; then
    echo "❌ Live mode: quit all Chrome windows first (Cmd+Q), then run Prepare Chrome again."
    echo "   Or enable parallel mode in the UI (keep Chrome open — separate automation window)."
    exit 2
  fi
  USER_DATA_ARG="$SRC_USER_DATA"
  echo "🚀 Live mode — using your main Chrome data (profile: $PROFILE)"
fi

echo "🚀 Launching automation Chrome (CDP port: $DEBUG_PORT)..."
"$CHROME" \
  --remote-debugging-port="$DEBUG_PORT" \
  --user-data-dir="$USER_DATA_ARG" \
  --profile-directory="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$CHAT_URL" >/dev/null 2>&1 &

echo "⏳ Waiting for Chrome debug port..."
for _ in {1..25}; do
  if cdp_ok; then
    echo "✅ Chrome is ready on ${CDP_HOST}:${DEBUG_PORT}"
    echo ""
    if [ "$PARALLEL" = "1" ]; then
      echo "   • Keep this automation window open with HR bot Chat."
      echo "   • Your other Chrome windows are unaffected — work in parallel."
    else
      echo "   • Keep this window open with Chat, then run tests."
    fi
    echo ""
    exit 0
  fi
  sleep 1
done

echo "❌ Chrome debug port did not respond after 25s."
exit 1
