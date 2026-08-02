# Security and troubleshooting

## Contents

- Security boundary
- Connection recovery
- Write recovery
- Diagnostic order

## Security boundary

The Studio process binds an ephemeral HTTP server to loopback only and creates a new 256-bit bearer token for every run. The descriptor is stored under the current user's application data directory with user-private permissions where the OS supports them.

Never output, log, copy, commit, or ask the user to paste the token. Never change the endpoint to a LAN address. The MCP server must reject non-loopback descriptor endpoints even if the descriptor was modified.

Read tools may run without document mutation. Write tools remain explicit, revision-checked, validated, and subject to Codex tool approval policy.

## Connection recovery

If no `sutra_*` tools are registered at all, this is not `studio_not_running`. After installing or updating the plugin, start a new Codex task so its skill and MCP registrations are loaded; only then diagnose the desktop bridge.

For `studio_not_running`:

1. Ask the user to start the Sutra Studio desktop app.
2. Retry `sutra_get_capabilities` after the status bar reports Codex bridge readiness.
3. If Studio is open, inspect only the descriptor path diagnostic—not its contents.

For `bridge_unreachable`, the descriptor may be stale. Restart Studio so it rewrites the endpoint and token. Do not reuse a token from an earlier run.

On Windows, implicit discovery checks the native LocalAppData descriptor before the configured WSL descriptor. It may continue from a stale, timed-out, or unreachable implicit candidate to the next candidate. An explicitly configured descriptor is always strict, and malformed, unsafe-endpoint, authentication, or protocol-version failures are never bypassed.

For `frontend_not_ready`, wait briefly for the React editor to initialize. Do not send writes until capabilities succeeds.

## Write recovery

- Revision conflict: refetch, rebase, retry once.
- Validation failure: correct the smallest failing operation; the batch was not committed.
- Timeout: read project summary before retrying because the response can be lost after a successful commit.
- Partial visual result: inspect outline/node details; do not assume a transport failure.
- Wrong page: pass a page ID or select the intended page explicitly before writing.

## Diagnostic order

1. `sutra_get_capabilities`
2. `sutra_get_project_summary`
3. `sutra_get_diagnostics`
4. Smallest relevant outline/node/catalog read
5. Studio bridge logs only if structured errors are insufficient

Never expose authentication material when reporting logs.
