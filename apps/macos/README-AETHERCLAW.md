# Aether-Claw macOS App (OpenClaw)

This directory contains the **full OpenClaw macOS app** from the [official OpenClaw repo](https://github.com/openclaw/openclaw), integrated into the Aether-Claw project. You get the same robust, feature-filled menu bar app and native Mac chat UI.

## What’s included

- **OpenClaw macOS app** – menu bar app, native chat (OpenClawChatUI), settings, exec approvals, canvas, voice wake, etc.
- **OpenClawKit** – shared library (chat UI, protocol, gateway session) from `apps/shared/OpenClawKit`.
- **Swabble** – voice wake word (from repo root `Swabble/`).
- **Product name** – built executable is **AetherClawMac** (package name stays OpenClaw internally).

## Build requirements

- **Xcode 16+** (Swift 6, macOS 15 SDK)
- **macOS 15** (or latest SDK) – dependencies (Swabble, Peekaboo, Textual, ElevenLabsKit) require it

## How to build

Macro plugins used by dependencies (e.g. swiftui-math) are best handled by Xcode:

1. Open the package in Xcode:
   ```bash
   open apps/macos/Package.swift
   ```
2. Select the **AetherClawMac** scheme.
3. Build (⌘B) or Run (⌘R).

Or from the repo root:

```bash
cd apps/macos
xcodebuild -scheme AetherClawMac -configuration Debug build
```

The built app is in `.build/debug/AetherClawMac`.

## Connecting to Aether-Claw’s Node gateway

The OpenClaw app is built to talk to **OpenClaw’s** gateway (ControlChannel, GatewayConnection, their wire protocol). To use it with **Aether-Claw’s Node WebSocket gateway** you have two options:

1. **Adapter in the app** – Add a thin “Aether-Claw backend” implementation that implements the OpenClaw gateway/session interface and forwards to your Node WebSocket API (connect, agent, chat.history, etc.). The existing UI and chat then work unchanged.
2. **Protocol on the server** – Implement the OpenClaw control/chat protocol on the Node gateway so the stock app can connect without changes.

Both are follow-up work; the app and chat UI are in this repo and ready to be wired to your backend.

## Layout

- `Sources/OpenClaw/` – main app (MenuBar, GatewayConnection, settings, chat window, etc.)
- `Sources/OpenClawDiscovery/` – gateway discovery
- `Sources/OpenClawIPC/` – IPC for CLI/helpers
- `Sources/OpenClawMacCLI/` – `openclaw-mac` CLI
- `Sources/OpenClawProtocol/` – local protocol types (duplicated from OpenClawKit for the CLI)
- `../shared/OpenClawKit/` – OpenClawKit (OpenClawChatUI, OpenClawProtocol, OpenClawKit)
- `../../Swabble/` – Swabble (voice)

## Original OpenClaw README

See [README.md](./README.md) in this directory for the original OpenClaw macOS app readme.
