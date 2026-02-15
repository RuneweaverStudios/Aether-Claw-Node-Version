# Aether-Claw macOS Companion App (placeholder)

This directory is reserved for the Aether-Claw macOS companion app. The app will connect to the Aether-Claw Node gateway over WebSocket and can act as an **operator** (chat, status, agent) and optionally as a **node** (system.run, system.notify, canvas).

## Gateway parity (Phases 1–3)

The daemon now provides:

- **WebSocket gateway** on `ws://127.0.0.1:18789` (configurable via `gateway.port` in `swarm_config.json`)
- **Connect handshake**: first frame must be `connect` with `role: "operator"` or `role: "node"`, optional `auth.token` (matches `AETHERCLAW_GATEWAY_TOKEN` or `gateway.auth.token`)
- **RPC**: `health`, `status`, `chat.send`, `chat.history`, `agent`, `node.list`, `node.invoke`
- **Events**: `presence`, `tick`
- **HTTP dashboard** on the same port when `gateway.dashboard` is true

## Protocol summary

- **Frames**: JSON text. `{ type: "req", id, method, params }` → `{ type: "res", id, ok, payload|error }`; server push: `{ type: "event", event, payload }`.
- **Connect (operator)**:
  ```json
  { "type": "req", "id": "<id>", "method": "connect", "params": { "role": "operator", "scopes": ["operator.read","operator.write"], "auth": { "token": "<optional>" } } }
  ```
- **Connect (node)**:
  ```json
  { "type": "req", "id": "<id>", "method": "connect", "params": { "role": "node", "caps": ["camera","canvas","screen"], "commands": ["system.run","system.notify","canvas.navigate"], "auth": { "token": "<optional>" } } }
  ```
- **Node invoke**: Gateway sends to node `{ type: "invoke", id, command, params }`; node replies `{ type: "invoke_res", id, ok, result?, error? }`.

## Implementation

- **Target**: Swift/SwiftUI, reference [OpenClaw apps/macos](https://github.com/openclaw/openclaw/tree/main/apps/macos) for UX and protocol patterns.
- **Operator**: Connect with `role: "operator"`, show status, chat history, send messages, run agent (streaming).
- **Node (optional)**: Connect with `role: "node"`, handle `invoke` for `system.run`, `system.notify`, and optionally `canvas.*` / `camera.*`.
- **Settings**: Gateway URL (default `ws://127.0.0.1:18789`), token (optional).

Build the app against this gateway once the repo has parity (WS gateway, node protocol, daemon) as in the plan.
