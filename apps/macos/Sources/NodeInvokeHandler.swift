import Foundation
import AppKit
import UserNotifications

/// Handles node.invoke for system.run (with Exec approval) and system.notify.
enum NodeInvokeHandler {
    private static let execStore = ExecApprovalsStore()
    private static let defaultAgentId = "default"

    static func handleSystemRun(invokeId: String, params: [String: Any], reply: @escaping (Bool, [String: Any]?, String?) -> Void) {
        let command = params["command"] as? String ?? ""
        let cwd = params["cwd"] as? String
        let resolvedPath = resolveExecutablePath(command: command)

        if execStore.securityMode() == .deny {
            DispatchQueue.main.async { reply(false, nil, "SYSTEM_RUN_DENIED") }
            return
        }
        if execStore.securityMode() == .allowlist, !execStore.isAllowlisted(commandPath: resolvedPath, agentId: defaultAgentId) {
            DispatchQueue.main.async { reply(false, nil, "SYSTEM_RUN_DENIED") }
            return
        }
        if execStore.securityMode() == .full && execStore.askMode() != .always {
            runCommand(command: command, cwd: cwd, reply: reply)
            return
        }
        if execStore.isAllowlisted(commandPath: resolvedPath, agentId: defaultAgentId), execStore.askMode() != .always {
            runCommand(command: command, cwd: cwd, reply: reply)
            return
        }

        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Run command?"
            alert.informativeText = command
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Allow once")
            alert.addButton(withTitle: "Always allow")
            alert.addButton(withTitle: "Deny")

            let response = alert.runModal()
            switch response {
            case .alertFirstButtonReturn:
                runCommand(command: command, cwd: cwd, reply: reply)
            case .alertSecondButtonReturn:
                execStore.addToAllowlist(agentId: defaultAgentId, path: resolvedPath)
                runCommand(command: command, cwd: cwd, reply: reply)
            default:
                reply(false, nil, "SYSTEM_RUN_DENIED")
            }
        }
    }

    private static func resolveExecutablePath(command: String) -> String {
        let parts = command.split(separator: " ").map(String.init)
        guard let first = parts.first, !first.isEmpty else { return "/bin/sh" }
        if first.hasPrefix("/") { return first }
        let envPath = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        for dir in envPath.split(separator: ":") {
            let path = "\(dir)/\(first)"
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return "/bin/sh"
    }

    private static func runCommand(command: String, cwd: String?, reply: @escaping (Bool, [String: Any]?, String?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-c", command]
            if let cwd = cwd, !cwd.isEmpty {
                process.currentDirectoryURL = URL(fileURLWithPath: (cwd as NSString).expandingTildeInPath)
            }
            let outPipe = Pipe()
            let errPipe = Pipe()
            process.standardOutput = outPipe
            process.standardError = errPipe
            var exitCode: Int32 = -1
            do {
                try process.run()
                process.waitUntilExit()
                exitCode = process.terminationStatus
            } catch {
                DispatchQueue.main.async { reply(false, nil, error.localizedDescription) }
                return
            }
            let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let stdout = String(data: outData, encoding: .utf8) ?? ""
            let stderr = String(data: errData, encoding: .utf8) ?? ""
            let result: [String: Any] = ["stdout": stdout, "stderr": stderr, "exitCode": Int(exitCode)]
            DispatchQueue.main.async { reply(true, result, nil) }
        }
    }

    static func handleNotify(params: [String: Any]) {
        let title = params["title"] as? String ?? "Aether-Claw"
        let body = params["body"] as? String ?? ""

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.2, repeats: false)
        let request = UNNotificationRequest(identifier: "node_\(UUID().uuidString)", content: content, trigger: trigger)
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            center.add(request) { _ in }
        }
    }
}
