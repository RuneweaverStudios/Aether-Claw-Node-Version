# Aether-Claw macOS App (AetherClaw)

This directory contains the **full AetherClaw macOS app** from the [official AetherClaw repo](https://github.com/openclaw/openclaw), integrated into the Aether-Claw project. You get the same robust, feature-filled menu bar app and native Mac chat UI.

## What’s included

- **AetherClaw macOS app** – menu bar app, native chat (AetherClawChatUI), settings, exec approvals, canvas, voice wake, etc.
- **AetherClawKit** – shared library (chat UI, protocol, gateway session) from `apps/shared/AetherClawKit`.
- **Swabble** – voice wake word (from repo root `Swabble/`).
- **Product name** – built executable is **AetherClawMac** (package name stays AetherClaw internally).

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

The AetherClaw app is built to talk to **AetherClaw’s** gateway (ControlChannel, GatewayConnection, their wire protocol). To use it with **Aether-Claw’s Node WebSocket gateway** you have two options:

1. **Adapter in the app** – Add a thin “Aether-Claw backend” implementation that implements the AetherClaw gateway/session interface and forwards to your Node WebSocket API (connect, agent, chat.history, etc.). The existing UI and chat then work unchanged.
2. **Protocol on the server** – Implement the AetherClaw control/chat protocol on the Node gateway so the stock app can connect without changes.

Both are follow-up work; the app and chat UI are in this repo and ready to be wired to your backend.

## Layout

- `Sources/AetherClaw/` – main app (MenuBar, GatewayConnection, settings, chat window, etc.)
- `Sources/AetherClawDiscovery/` – gateway discovery
- `Sources/AetherClawIPC/` – IPC for CLI/helpers
- `Sources/AetherClawMacCLI/` – `openclaw-mac` CLI
- `Sources/AetherClawProtocol/` – local protocol types (duplicated from AetherClawKit for the CLI)
- `../shared/AetherClawKit/` – AetherClawKit (AetherClawChatUI, AetherClawProtocol, AetherClawKit)
- `../../Swabble/` – Swabble (voice)

## Original AetherClaw README

See [README.md](./README.md) in this directory for the original AetherClaw macOS app readme.
