import SwiftUI

/// Settings → Exec approvals: security mode, ask behavior, allowlist (OpenClaw-style).
struct ExecApprovalsView: View {
    @StateObject private var store = ExecApprovalsStore()
    @State private var newPattern = ""
    @State private var selectedAgentId = "default"

    var body: some View {
        Form {
            Section("Default behavior") {
                Picker("Security", selection: Binding(
                    get: { store.securityMode() },
                    set: { store.setSecurityMode($0) }
                )) {
                    Text("Deny").tag(ExecSecurityMode.deny)
                    Text("Ask on miss").tag(ExecSecurityMode.askOnMiss)
                    Text("Allowlist only").tag(ExecSecurityMode.allowlist)
                    Text("Full").tag(ExecSecurityMode.full)
                }
                Picker("Ask", selection: Binding(
                    get: { store.askMode() },
                    set: { store.setAskMode($0) }
                )) {
                    Text("Off").tag(ExecAskMode.off)
                    Text("On miss").tag(ExecAskMode.onMiss)
                    Text("Always").tag(ExecAskMode.always)
                }
            }
            Section("Allowlist") {
                HStack {
                    TextField("Path or pattern (e.g. /usr/bin/uptime)", text: $newPattern)
                    Button("Add") {
                        let t = newPattern.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !t.isEmpty {
                            store.addToAllowlist(agentId: selectedAgentId, path: t)
                            newPattern = ""
                        }
                    }
                }
                if let list = store.config.agents[selectedAgentId]?.allowlist, !list.isEmpty {
                    ForEach(list, id: \.self) { path in
                        Text(path)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}
