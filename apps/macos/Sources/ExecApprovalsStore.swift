import Foundation

/// Exec approval security mode (mirrors OpenClaw / plan).
enum ExecSecurityMode: String, Codable, CaseIterable {
    case deny = "deny"
    case askOnMiss = "ask_on_miss"
    case allowlist = "allowlist"
    case full = "full"
}

/// Exec approval ask behavior.
enum ExecAskMode: String, Codable, CaseIterable {
    case off = "off"
    case onMiss = "on_miss"
    case always = "always"
}

/// Schema for ~/.aetherclaw/exec-approvals.json
struct ExecApprovalsConfig: Codable {
    var defaults: DefaultsConfig
    var agents: [String: AgentApprovals]

    struct DefaultsConfig: Codable {
        var security: String  // deny | ask_on_miss | allowlist | full
        var ask: String      // off | on_miss | always
    }

    struct AgentApprovals: Codable {
        var allowlist: [String]  // glob patterns for resolved binary paths
    }

    static let defaultConfig = ExecApprovalsConfig(
        defaults: DefaultsConfig(security: ExecSecurityMode.askOnMiss.rawValue, ask: ExecAskMode.onMiss.rawValue),
        agents: [:]
    )
}

final class ExecApprovalsStore: ObservableObject {
    @Published var config: ExecApprovalsConfig
    private let fileURL: URL

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let dir = home.appendingPathComponent(".aetherclaw", isDirectory: true)
        self.fileURL = dir.appendingPathComponent("exec-approvals.json")
        self.config = ExecApprovalsConfig.defaultConfig
        load()
    }

    func load() {
        guard FileManager.default.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode(ExecApprovalsConfig.self, from: data) else { return }
        config = decoded
    }

    func save() {
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(config) else { return }
        try? data.write(to: fileURL)
    }

    func securityMode() -> ExecSecurityMode {
        ExecSecurityMode(rawValue: config.defaults.security) ?? .askOnMiss
    }

    func setSecurityMode(_ mode: ExecSecurityMode) {
        config.defaults.security = mode.rawValue
        save()
    }

    func askMode() -> ExecAskMode {
        ExecAskMode(rawValue: config.defaults.ask) ?? .onMiss
    }

    func setAskMode(_ mode: ExecAskMode) {
        config.defaults.ask = mode.rawValue
        save()
    }

    /// Whether to show approval dialog for a command (path). Call when gateway sends node.invoke for system.run.
    func shouldAskToApprove(commandPath: String, agentId: String) -> Bool {
        switch securityMode() {
        case .deny: return false
        case .full: return askMode() == .always
        case .allowlist, .askOnMiss:
            let allowed = isAllowlisted(commandPath: commandPath, agentId: agentId)
            if allowed { return askMode() == .always }
            return securityMode() == .askOnMiss || askMode() != .off
        }
    }

    func isAllowlisted(commandPath: String, agentId: String) -> Bool {
        // Simple prefix match; could add glob later.
        let list = config.agents[agentId]?.allowlist ?? []
        let path = (commandPath as NSString).standardizingPath
        return list.contains { pattern in
            let p = (pattern as NSString).standardizingPath
            if p.hasSuffix("*") {
                return path.hasPrefix(String(p.dropLast()))
            }
            return path == p
        }
    }

    func addToAllowlist(agentId: String, path: String) {
        if config.agents[agentId] == nil {
            config.agents[agentId] = ExecApprovalsConfig.AgentApprovals(allowlist: [])
        }
        var list = config.agents[agentId]!.allowlist
        let normalized = (path as NSString).standardizingPath
        if !list.contains(normalized) { list.append(normalized) }
        config.agents[agentId]?.allowlist = list
        save()
    }

    func isDenied(commandPath: String, agentId: String) -> Bool {
        if securityMode() == .deny { return true }
        if securityMode() == .full { return false }
        return !isAllowlisted(commandPath: commandPath, agentId: agentId) && securityMode() == .allowlist
    }
}
