import Foundation

/// Finds swarm_config.json (e.g. in ~/.aether-claw-node) and parses gateway.port / gateway.bind to build the WebSocket URL.
enum SwarmConfigDetector {

    /// Search paths for swarm_config.json (first found wins).
    private static var searchPaths: [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        var paths = [
            home.appendingPathComponent(".aether-claw-node").appendingPathComponent("swarm_config.json"),
            home.appendingPathComponent("Aether-Claw-Node-Version").appendingPathComponent("swarm_config.json"),
        ]
        // When running from terminal (e.g. swift run from apps/macos), cwd may be repo or apps/macos.
        let cwd = FileManager.default.currentDirectoryPath
        if !cwd.isEmpty && cwd != "/" {
            let cwdURL = URL(fileURLWithPath: cwd)
            paths.insert(cwdURL.appendingPathComponent("swarm_config.json"), at: 0)
            if cwd.hasSuffix("macos") || cwd.hasSuffix("apps/macos") {
                paths.insert(cwdURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("swarm_config.json"), at: 0)
            }
        }
        return paths
    }

    /// Detect gateway WebSocket URL from swarm_config.json if present.
    /// - Returns: e.g. "ws://127.0.0.1:18790", or nil if not found / invalid.
    static func detectGatewayURL() -> String? {
        for fileURL in searchPaths {
            guard FileManager.default.fileExists(atPath: fileURL.path),
                  let data = try? Data(contentsOf: fileURL),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let gateway = json["gateway"] as? [String: Any],
                  let portNum = gateway["port"] as? NSNumber else { continue }
            let port = portNum.intValue
            let bind = gateway["bind"] as? String
            let host: String
            if let b = bind, !b.isEmpty, b != "loopback" {
                host = b
            } else {
                host = "127.0.0.1"
            }
            return "ws://\(host):\(port)"
        }
        return nil
    }
}
