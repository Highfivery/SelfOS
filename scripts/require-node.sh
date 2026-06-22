#!/usr/bin/env sh
# Fail fast with an actionable message if the active Node is too old for the toolchain.
# pnpm needs Node >=18.12 and CI runs Node 24; the shell's default `node` can be older than .nvmrc
# (nvm doesn't auto-switch in a hook's non-interactive shell), which otherwise surfaces as a cryptic
# "pnpm requires at least Node.js v18.12" mid-push. This turns it into a clear fix.
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "${major:-0}" -lt 20 ]; then
  echo "✗ Node $(node -v 2>/dev/null || echo '(none found)') is too old for this repo (needs >=20; .nvmrc pins 24)." >&2
  echo "  Run 'nvm use' (or otherwise switch your Node), then retry." >&2
  exit 1
fi
