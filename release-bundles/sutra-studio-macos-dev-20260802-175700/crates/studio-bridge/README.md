# Sutra Studio bridge

`studio-bridge` is the authenticated local transport between the Sutra Studio desktop
process and external Codex/MCP tooling. It transports versioned RPC envelopes only;
document behavior stays in the Studio frontend and document engine.

## Discovery and authentication

Studio writes `codex-bridge-v1.json` beneath Tauri's per-user local app-data directory.
Set `SUTRA_STUDIO_BRIDGE_DESCRIPTOR` to an absolute path when a launcher or test needs a
different location. The descriptor contains the ephemeral `http://127.0.0.1:<port>`
endpoint, a process-unique 256-bit bearer token, protocol/app versions, pid, instance id,
start time, and health path.

Every request, including health, requires:

```text
Authorization: Bearer <descriptor.token>
```

Do not log or copy the token into project files. On Unix the descriptor is written with
mode `0600`. On Windows its default location inherits the current user's LocalAppData ACL.

A client treats a descriptor as stale when authenticated health cannot be reached, or
when health's `instanceId`/`pid` differs from the descriptor. Shutdown removes the file
only when it still belongs to the current process, so an older instance cannot delete a
newer instance's descriptor.

## HTTP protocol 1.0

`GET /v1/health` reports process identity, app/protocol versions, frontend readiness, and
pending request count. It never returns the bearer token.

`POST /v1/rpc` accepts:

```json
{
  "protocolVersion": "1.0",
  "method": "sutra.getProjectSummary",
  "params": {}
}
```

The bridge generates a collision-resistant request id and emits the Tauri event
`sutra://bridge-rpc-request`. Once its listener is installed, the frontend invokes
`set_bridge_frontend_ready` with `{ "ready": true }`. It completes an event by invoking
`resolve_bridge_rpc` with one of these payloads:

```json
{
  "response": {
    "requestId": "<event request id>",
    "result": { "revision": 7 }
  }
}
```

```json
{
  "response": {
    "requestId": "<event request id>",
    "error": {
      "code": "revision_conflict",
      "message": "The document changed before the operation was applied."
    }
  }
}
```

The bridge has explicit header, body, concurrency, frontend-response, and total-request
limits. Responses use stable machine-readable error codes. A future incompatible wire
protocol must get a new descriptor filename and URL prefix; compatible additions remain
under protocol `1.0`.
