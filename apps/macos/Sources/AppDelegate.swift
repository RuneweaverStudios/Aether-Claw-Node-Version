import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusBar = StatusBarController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBar.setup()
    }
}
