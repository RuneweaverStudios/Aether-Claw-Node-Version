# Aether-Claw macOS Companion App

Swift/SwiftUI app that connects to the Aether-Claw Node gateway over WebSocket as an **operator** (chat, status, agent). Optionally can act as a **node** (system.run, system.notify, canvas) with permissions and Exec approvals (see Phase 6b).

## Build and run

From this directory:

```bash
swift build
swift run AetherClawMac
```

Or open in Xcode and run the `AetherClawMac` scheme (File → Open → select this directory; the Swift Package will be loaded).

## App structure

- **Connection**: WebSocket to gateway; first frame is `connect` with `role: "operator"`, optional `auth.token`. Shows Connected/Disconnected and last error.
- **Settings**: Gateway URL (default `ws://127.0.0.1:18789`), token (optional), Connect/Disconnect; Permissions (TCC) and Exec approvals.
- **Chat**: Message list with streaming, code blocks (copy), collapsible long messages, steps, queue, load/save, and status banner.

## Gateway parity

The daemon provides:

- **WebSocket gateway** on `ws://127.0.0.1:18789` (configurable via `gateway.port` in `swarm_config.json`)
- **Connect handshake**: first frame must be `connect` with `role: "operator"` or `role: "node"`, optional `auth.token` (matches `AETHERCLAW_GATEWAY_TOKEN` or `gateway.auth.token`)
- **RPC**: `health`, `status`, `chat.send`, `chat.history`, `agent` (with `params.stream: true` for streaming), `chat.export`, `chat.replace`, `node.list`, `node.invoke`
- **Events**: `presence`, `tick`, `agent.chunk`, `agent.step`, `agent`
- **HTTP dashboard** and **Web Chat** on the same port when `gateway.dashboard` is true

## Protocol summary

- **Frames**: JSON text. `{ type: "req", id, method, params }` → `{ type: "res", id, ok, payload|error }`; server push: `{ type: "event", event, payload }`.
- **Connect (operator)**:
  ```json
  { "type": "req", "id": "<id>", "method": "connect", "params": { "role": "operator", "scopes": ["operator.read","operator.write"], "auth": { "token": "<optional>" } } }
  ```
- **Connect (node)**:
  ```json
  { "type": "req", "id": "<id>", "method": "connect", "params": { "role": "node", "caps": ["camera","canvas","screen"], "commands": ["system.run","system.notify","canvas.navigate"], "auth": { "token": "<optional>" }, "permissions": { "screenRecording": true, ... } } }
  ```
- **Node invoke**: Gateway sends to node `{ type: "invoke", id, command, params }`; node replies `{ type: "invoke_res", id, ok, result?, error? }`.

## Permissions & Exec approvals (Phase 6b)

- **Permissions**: Settings → Permissions (TCC). One row per permission (Accessibility, Screen Recording, Microphone, Speech Recognition, Automation, Notifications). Each has an “Open Settings” button that opens the correct System Settings pane (`x-apple.systempreferences:com.apple.preference.security?Privacy_*`). Accessibility status is shown when detectable.
- **Exec approvals**: Settings → Exec approvals. Default behavior: **Deny** / **Ask on miss** / **Allowlist only** / **Full**; Ask: **Off** / **On miss** / **Always**. Allowlist (glob patterns) stored in `~/.aetherclaw/exec-approvals.json`. When connecting as a **node**, the app will send a `permissions` map in `connect.params` (from `PermissionsProvider.currentPermissions()`); when the gateway sends `node.invoke` for `system.run`, the app can show a native approval dialog (Allow once / Always allow / Deny) and persist “Always allow” to the allowlist.
- **Stable permissions**: For permissions to persist across updates, sign with a **real Apple Development or Developer ID certificate** (not ad-hoc), use a **fixed bundle ID** (e.g. `com.aetherclaw.mac`), and run from a **fixed path**. Ad-hoc builds get a new identity each build and macOS may forget TCC grants.
- **Recovery**: If prompts disappear or grants don’t stick: restart macOS; in Terminal run `tccutil reset All com.aetherclaw.mac` (use your app’s bundle ID); remove the app from System Settings → Privacy & Security; relaunch. The app’s Permissions screen also shows this under Recovery.

## Chat UX (Phase 7)

- **Message list**: User and assistant bubbles; assistant shows model name and steps.
- **Streaming**: Agent runs with `stream: true`; chunks append to the current assistant bubble until completion.
- **Code blocks**: Rendered with a Copy button (copies to clipboard).
- **Collapsible**: Long assistant messages get a max height and “Show more” / “Show less”.
- **Steps**: `event:agent.step` updates the current run’s steps (tool_call / tool_result).
- **Queue**: While a run is in progress, Send enqueues; when the run completes, the next queued message is sent; “N queued” is shown.
- **Load / Save**: Save calls `chat.export` and writes JSON to a file; Load opens a file, parses JSON, replaces the thread and calls `chat.replace`.
- **Banners**: On connect, `status` is fetched; if `first_run` or `error`, a banner is shown (e.g. “Complete setup: run aetherclaw onboard”).
