#!/usr/bin/env sh
set -eu

plugin_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
entry_point="$plugin_root/mcp-server/sutra-mcp.mjs"

if [ ! -f "$entry_point" ]; then
  echo 'Sutra Studio MCP bundle is missing. Rebuild the plugin package.' >&2
  exit 1
fi

exec "${SUTRA_STUDIO_MCP_NODE:-node}" "$entry_point"
