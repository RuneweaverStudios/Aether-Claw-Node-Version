import Foundation
import ApplicationServices
import CoreGraphics

/// Builds the permissions map to send in node `connect.params.permissions` so the gateway knows what this node can do.
enum PermissionsProvider {
    static func currentPermissions() -> [String: Bool] {
        [
            "accessibility": AXIsProcessTrusted(),
            "screenRecording": hasScreenRecordingAccess(),
        ]
    }

    private static func hasScreenRecordingAccess() -> Bool {
        if #available(macOS 11.0, *) {
            return CGPreflightScreenCaptureAccess()
        }
        return false
    }
}
