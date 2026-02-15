import AppKit
import SwiftUI

/// Shared connection state for the status bar menu (read by StatusBarController).
enum GatewayConnectionStatus {
    static var isConnected: Bool = false
    static var lastError: String?
}

/// Creates and manages the menu bar (status bar) item — OpenClaw-style.
final class StatusBarController: NSObject {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem?.button else { return }
        button.image = NSImage(systemSymbolName: "bolt.circle", accessibilityDescription: "Aether-Claw")
        button.image?.isTemplate = true

        menu = NSMenu()
        let openItem = NSMenuItem(title: "Open Chat", action: #selector(openChat), keyEquivalent: "")
        openItem.target = self
        menu?.addItem(openItem)
        menu?.addItem(NSMenuItem.separator())
        gatewayStatusItem = NSMenuItem(title: "Gateway: …", action: nil, keyEquivalent: "")
        gatewayStatusItem?.isEnabled = false
        menu?.addItem(gatewayStatusItem!)
        menu?.addItem(NSMenuItem.separator())
        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu?.addItem(settingsItem)
        menu?.addItem(NSMenuItem.separator())
        let quitItem = NSMenuItem(title: "Quit Aether-Claw", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu?.addItem(quitItem)

        statusItem?.menu = menu
        updateGatewayLabel()
        NotificationCenter.default.addObserver(self, selector: #selector(connectionDidChange), name: .gatewayConnectionDidChange, object: nil)
    }

    @objc private func connectionDidChange() {
        updateGatewayLabel()
    }

    private var gatewayStatusItem: NSMenuItem?

    func updateGatewayLabel() {
        DispatchQueue.main.async { [weak self] in
            guard let item = self?.gatewayStatusItem else { return }
            if GatewayConnectionStatus.isConnected {
                item.title = "Gateway: Connected"
            } else if let err = GatewayConnectionStatus.lastError, !err.isEmpty {
                item.title = "Gateway: \(err.prefix(40))…"
            } else {
                item.title = "Gateway: Disconnected"
            }
        }
    }

    @objc private func openChat() {
        NSApp.activate(ignoringOtherApps: true)
        for w in NSApp.windows {
            if w.canBecomeMain { w.makeKeyAndOrderFront(nil); break }
        }
    }

    @objc private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        for w in NSApp.windows {
            if w.canBecomeMain { w.makeKeyAndOrderFront(nil); break }
        }
        NotificationCenter.default.post(name: .switchToSettingsTab, object: nil)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

extension Notification.Name {
    static let switchToSettingsTab = Notification.Name("switchToSettingsTab")
    static let gatewayConnectionDidChange = Notification.Name("gatewayConnectionDidChange")
}
