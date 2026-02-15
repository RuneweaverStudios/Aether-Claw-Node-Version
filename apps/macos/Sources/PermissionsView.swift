import SwiftUI
import ApplicationServices

/// One permission row: name, optional status, and button to open System Settings.
struct PermissionRow: View {
    let title: String
    let subtitle: String?
    let urlString: String
    let required: Bool

    init(title: String, subtitle: String? = nil, urlString: String, required: Bool = false) {
        self.title = title
        self.subtitle = subtitle
        self.urlString = urlString
        self.required = required
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                if let s = subtitle {
                    Text(s)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if required {
                Text("Required for node")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button("Open Settings") {
                if let url = URL(string: urlString) {
                    NSWorkspace.shared.open(url)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

/// TCC permissions list with deep links to System Settings (OpenClaw-style).
struct PermissionsView: View {
    /// Where we can detect status (e.g. accessibility), show it.
    @State private var accessibilityGranted: Bool = false

    var body: some View {
        List {
            Section("Privacy & Security") {
                PermissionRow(
                    title: "Accessibility",
                    subtitle: accessibilityGranted ? "Granted" : "Required for some node features",
                    urlString: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                    required: false
                )
                PermissionRow(
                    title: "Screen Recording",
                    subtitle: "Required for screen capture",
                    urlString: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                    required: false
                )
                PermissionRow(
                    title: "Microphone",
                    subtitle: "For voice input",
                    urlString: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
                    required: false
                )
                PermissionRow(
                    title: "Speech Recognition",
                    subtitle: "For dictation",
                    urlString: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
                    required: false
                )
                PermissionRow(
                    title: "Automation / AppleScript",
                    subtitle: "For automation tools",
                    urlString: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
                    required: false
                )
            }
            Section("Notifications") {
                PermissionRow(
                    title: "Notifications",
                    subtitle: "For system.notify",
                    urlString: "x-apple.systempreferences:com.apple.preference.notifications",
                    required: false
                )
            }
            Section(header: Text("Recovery"), footer: recoveryFooter) {
                Text("If permission prompts disappear or grants don’t stick: restart macOS, then in Terminal run: tccutil reset All com.aetherclaw.mac (replace with your app’s bundle ID). Remove the app from System Settings → Privacy & Security, then relaunch.")
                    .font(.caption)
            }
        }
        .onAppear { updateAccessibilityStatus() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willBecomeActiveNotification)) { _ in
            updateAccessibilityStatus()
        }
    }

    private var recoveryFooter: some View {
        Text("Stable permissions require a real Apple Developer ID signing certificate and a fixed bundle ID (e.g. com.aetherclaw.mac). Ad-hoc builds get a new identity each build and macOS may forget grants.")
            .font(.caption)
    }

    private func updateAccessibilityStatus() {
        accessibilityGranted = AXIsProcessTrusted()
    }
}
