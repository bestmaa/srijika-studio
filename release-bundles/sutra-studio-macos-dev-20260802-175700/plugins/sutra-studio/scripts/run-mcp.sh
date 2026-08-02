#!/usr/bin/env sh
set -eu

plugin_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
entry_point="$plugin_root/mcp-server/sutra-mcp.mjs"

if [ ! -f "$entry_point" ]; then
  echo 'Sutra Studio MCP bundle is missing. Rebuild the plugin package.' >&2
  exit 1
fi

if [ -n "${SUTRA_STUDIO_MCP_NODE:-}" ]; then
  node_binary=$SUTRA_STUDIO_MCP_NODE
elif command -v node >/dev/null 2>&1; then
  node_binary=$(command -v node)
else
  node_binary=''
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    "$HOME"/.nvm/versions/node/*/bin/node
  do
    if [ -x "$candidate" ]; then
      node_binary=$candidate
    fi
  done
fi

if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo 'Node.js 22 or newer is required to start the Sutra Studio MCP server.' >&2
  echo 'Install Node with Homebrew, or set SUTRA_STUDIO_MCP_NODE to its absolute path.' >&2
  exit 1
fi

exec "$node_binary" "$entry_point"
