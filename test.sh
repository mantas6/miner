#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm run lint
npm run fmt:check
npm test
npm run typecheck
npm run build

# Playwright covers what a DOM shim cannot: canvas focus, native <dialog>
# behaviour, `:focus-visible`, and the boot flow end to end. A Playwright-
# downloaded browser does not run on NixOS, so this only joins the local sequence
# when there is a system Chromium for it to drive. The probe mirrors
# `resolveChromiumExecutable()` in `agent/chromium.ts`, which `playwright.config.ts`
# uses to pick the browser: an explicit `PLAYWRIGHT_CHROMIUM_PATH` wins, otherwise
# the first of `CHROMIUM_BINARIES` on `PATH` — keep the two lists in step. The
# workflow installs the pinned download instead and does not run this script.
# An explicit path that is not executable fails the run rather than skipping it:
# Playwright would be pointed at it and fail anyway, just less legibly.
chromium_override="${PLAYWRIGHT_CHROMIUM_PATH:-}"
chromium_override="${chromium_override#"${chromium_override%%[![:space:]]*}"}"
chromium_override="${chromium_override%"${chromium_override##*[![:space:]]}"}"

has_system_chromium() {
  local binary
  for binary in chromium chromium-browser google-chrome-stable google-chrome chrome; do
    command -v "$binary" >/dev/null 2>&1 && return 0
  done
  return 1
}

if [[ -n "$chromium_override" ]]; then
  if [[ ! -x "$chromium_override" ]]; then
    echo "test.sh: PLAYWRIGHT_CHROMIUM_PATH=$chromium_override is not an executable" >&2
    exit 1
  fi
  npm run test:e2e
elif has_system_chromium; then
  npm run test:e2e
else
  echo 'test.sh: no system Chromium on PATH — skipping npm run test:e2e' >&2
fi
