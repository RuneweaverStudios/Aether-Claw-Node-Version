import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var gateway = GatewayClient()
    @StateObject private var nodeClient = NodeClient()
    @AppStorage("gatewayURL") private var storedGatewayURL = "ws://127.0.0.1:18789"
    @AppStorage("gatewayToken") private var gatewayToken = ""
    @AppStorage("nodeModeEnabled") private var nodeModeEnabled = false
    @State private var gatewayURLInput: String = ""
    @State private var selectedTab = 0
    @State private var messageText = ""
    @State private var messages: [ChatMessage] = []
    @State private var messageQueue: [String] = []
    @State private var isAgentBusy = false
    @State private var planMode = false
    @State private var statusBannerMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            connectionIndicatorBar
            TabView(selection: $selectedTab) {
                chatView
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                    .tag(0)
                settingsView
                    .tabItem { Label("Settings", systemImage: "gear") }
                    .tag(1)
            }
        }
        .onAppear {
            applyDetectedGatewayURLIfNeeded()
            if storedGatewayURL.isEmpty { storedGatewayURL = "ws://127.0.0.1:18789" }
            if gatewayURLInput.isEmpty { gatewayURLInput = storedGatewayURL }
            // Auto-connect to gateway on launch when we have a URL
            if !gateway.isConnected && !storedGatewayURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                gateway.connect(wsURL: storedGatewayURL, token: gatewayToken.isEmpty ? nil : gatewayToken)
            }
            if nodeModeEnabled && !nodeClient.isConnected {
                nodeClient.connect(wsURL: storedGatewayURL, token: gatewayToken.isEmpty ? nil : gatewayToken)
            }
        }
        .onChange(of: storedGatewayURL) { newVal in
            if gatewayURLInput != newVal { gatewayURLInput = newVal }
        }
        .onReceive(NotificationCenter.default.publisher(for: .switchToSettingsTab)) { _ in
            selectedTab = 1
        }
        .onChange(of: gateway.isConnected) { connected in
            if connected {
                loadHistory()
                fetchStatusBanner()
            } else {
                statusBannerMessage = nil
            }
        }
        .onChange(of: gateway.agentIdleSessionKey) { sk in
            if sk != nil {
                if !messageQueue.isEmpty && !isAgentBusy {
                    let next = messageQueue.removeFirst()
                    runAgent(message: next)
                }
                gateway.clearAgentIdleSessionKey()
            }
        }
        .onChange(of: nodeModeEnabled) { enabled in
            if enabled {
                nodeClient.connect(wsURL: storedGatewayURL, token: gatewayToken.isEmpty ? nil : gatewayToken)
            } else {
                nodeClient.disconnect()
            }
        }
    }

    private var connectionIndicatorBar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(gateway.isConnected ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(gateway.isConnected ? "Gateway: Connected" : "Gateway: Disconnected")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let err = gateway.lastError, !gateway.isConnected {
                Text("·")
                    .foregroundStyle(.secondary)
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color(nsColor: .separatorColor))
                .frame(height: 1)
        }
    }

    private var chatView: some View {
        VStack(spacing: 0) {
            if let banner = statusBannerMessage {
                Text(banner)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(6)
                    .frame(maxWidth: .infinity)
                    .background(Color.orange.opacity(0.15))
            }
            if let err = gateway.lastError, !gateway.isConnected {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(4)
            }
            if gateway.isConnected {
                HStack {
                    Text("Connected")
                        .font(.caption)
                        .foregroundStyle(.green)
                    if isAgentBusy { Text("Thinking…").font(.caption).foregroundStyle(.secondary) }
                    if !messageQueue.isEmpty { Text("\(messageQueue.count) queued").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                }
                .padding(4)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { msg in
                            HStack(alignment: .top, spacing: 8) {
                                if msg.role == "user" { Spacer(minLength: 40) }
                                ChatBubbleView(message: msg)
                                    .frame(maxWidth: 500, alignment: msg.role == "user" ? .trailing : .leading)
                                if msg.role == "assistant" { Spacer(minLength: 40) }
                            }
                        }
                    }
                    .padding()
                }
            }
            HStack(spacing: 8) {
                Toggle("Plan", isOn: $planMode)
                    .toggleStyle(.checkbox)
                    .help("Read-only mode: no exec or file writes")
                TextField("Message...", text: $messageText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                Button("Send") { sendOrEnqueue() }
                    .disabled(!gateway.isConnected)
                Menu {
                    Button("Save chat…") { saveChat() }
                    Button("Load chat…") { loadChat() }
                } label: { Image(systemName: "ellipsis.circle") }
            }
            .padding()
        }
        .frame(minWidth: 400, minHeight: 300)
    }

    private func sendOrEnqueue() {
        let t = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        messageText = ""
        if isAgentBusy {
            messageQueue.append(t)
            return
        }
        runAgent(message: t)
    }

    private func runAgent(message: String) {
        isAgentBusy = true
        let userMsg = ChatMessage(role: "user", content: message)
        messages.append(userMsg)
        let assistantId = UUID()
        let assistantMsg = ChatMessage(id: assistantId, role: "assistant", content: "", steps: [], isStreaming: true)
        messages.append(assistantMsg)

        gateway.sendAgent(message: message, sessionKey: "mac", readOnly: planMode, onChunk: { delta in
            if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                var m = messages[idx]
                m.content += delta
                messages[idx] = m
            }
        }, onStep: { stepPayload in
            let step = AgentStep(
                type: stepPayload["type"] as? String ?? "",
                name: stepPayload["name"] as? String,
                args: (stepPayload["args"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { String(data: $0, encoding: .utf8) },
                result: (stepPayload["result"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { String(data: $0, encoding: .utf8) },
                error: stepPayload["error"] as? String
            )
            if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                var m = messages[idx]
                m.steps.append(step)
                messages[idx] = m
            }
        }, onComplete: { reply, modelUsed, error, usage in
            if error == "busy" {
                if let lastAssistantIdx = messages.lastIndex(where: { $0.role == "assistant" }) {
                    messages.remove(at: lastAssistantIdx)
                }
                if let lastUserContent = messages.last(where: { $0.role == "user" })?.content {
                    messageQueue.insert(lastUserContent, at: 0)
                }
                isAgentBusy = false
                return
            }
            let usageSummary: String? = usage.flatMap { u in
                let p = (u["prompt_tokens"] as? NSNumber)?.intValue
                let c = (u["completion_tokens"] as? NSNumber)?.intValue
                let t = (u["total_tokens"] as? NSNumber)?.intValue
                if let p = p, let c = c { return "prompt: \(p), completion: \(c)" }
                if let t = t { return "\(t) tokens" }
                return nil
            }
            if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                var m = messages[idx]
                m.content = reply ?? (error ?? "")
                m.modelUsed = modelUsed
                m.usageSummary = usageSummary
                m.isStreaming = false
                messages[idx] = m
            }
            isAgentBusy = false
            if !messageQueue.isEmpty {
                let next = messageQueue.removeFirst()
                runAgent(message: next)
            }
        })
    }

    private func loadHistory() {
        guard gateway.isConnected else { return }
        gateway.chatHistory(sessionKey: "mac") { result in
            switch result {
            case .success(let list):
                messages = list.compactMap { m in
                    guard let role = m["role"] as? String, let content = m["content"] as? String else { return nil }
                    return ChatMessage(role: role, content: content)
                }
            case .failure: break
            }
        }
    }

    private func fetchStatusBanner() {
        guard gateway.isConnected else { return }
        gateway.fetchStatus { result in
            switch result {
            case .success(let payload):
                if let firstRun = payload["first_run"] as? Bool, firstRun {
                    statusBannerMessage = "Complete setup: run aetherclaw onboard"
                } else if let err = payload["error"] as? String, !err.isEmpty {
                    statusBannerMessage = err
                } else {
                    statusBannerMessage = nil
                }
            case .failure: statusBannerMessage = nil
            }
        }
    }

    private func saveChat() {
        gateway.chatExport(sessionKey: "mac") { result in
            switch result {
            case .success(let payload):
                guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
                let panel = NSSavePanel()
                panel.allowedContentTypes = [.json]
                panel.nameFieldStringValue = "chat-export.json"
                panel.begin { resp in
                    if resp == .OK, let url = panel.url {
                        try? data.write(to: url)
                    }
                }
            case .failure: break
            }
        }
    }

    private func loadChat() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.begin { resp in
            if resp == .OK, let url = panel.url, let data = try? Data(contentsOf: url),
               let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let list = payload["messages"] as? [[String: Any]] {
                let newMessages = list.compactMap { m -> ChatMessage? in
                    guard let role = m["role"] as? String, let content = m["content"] as? String else { return nil }
                    return ChatMessage(role: role, content: content)
                }
                messages = newMessages
                let dicts = list.map { m in
                    ["role": m["role"] ?? "user", "content": m["content"] ?? ""]
                }
                gateway.chatReplace(sessionKey: "mac", messages: dicts) { _ in }
            }
        }
    }

    private var settingsView: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Gateway URL", text: $gatewayURLInput, prompt: Text("ws://127.0.0.1:18789"))
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled(true)
                        .onSubmit { storedGatewayURL = gatewayURLInput }
                        .onChange(of: gatewayURLInput) { newVal in
                            storedGatewayURL = newVal
                        }
                        .help("e.g. ws://127.0.0.1:18789 — auto-detected from ~/.aether-claw-node/swarm_config.json if present")
                    if let detected = SwarmConfigDetector.detectGatewayURL(), detected != gatewayURLInput.trimmingCharacters(in: .whitespacesAndNewlines) {
                        Button("Use detected (\(detected))") {
                            let url = detected
                            storedGatewayURL = url
                            gatewayURLInput = url
                        }
                        .buttonStyle(.borderless)
                    }
                    SecureField("Token (optional)", text: $gatewayToken)
                        .textFieldStyle(.roundedBorder)
                    if gateway.isConnected {
                        Button("Disconnect") { gateway.disconnect() }
                    } else {
                        Button("Connect") {
                            storedGatewayURL = gatewayURLInput
                            gateway.connect(wsURL: storedGatewayURL, token: gatewayToken.isEmpty ? nil : gatewayToken)
                        }
                    }
                }
                Section("Node") {
                    Toggle("Enable node (system.run, notifications)", isOn: $nodeModeEnabled)
                        .help("Connect as a node so the agent can run commands and send notifications on this Mac")
                    if nodeModeEnabled {
                        if nodeClient.isConnected {
                            Text("Node connected")
                                .font(.caption)
                                .foregroundStyle(.green)
                        } else if let err = nodeClient.lastError {
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                }
                Section("Permissions & security") {
                    NavigationLink("Permissions (TCC)") { PermissionsView() }
                    NavigationLink("Exec approvals") { ExecApprovalsView() }
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 350, minHeight: 200)
            .onAppear {
                applyDetectedGatewayURLIfNeeded()
                if gatewayURLInput.isEmpty { gatewayURLInput = storedGatewayURL }
                if nodeModeEnabled && !nodeClient.isConnected {
                    nodeClient.connect(wsURL: storedGatewayURL, token: gatewayToken.isEmpty ? nil : gatewayToken)
                }
            }
        }
    }

    /// If stored URL is default or empty, try to set from swarm_config.json (~/.aether-claw-node or clone).
    private func applyDetectedGatewayURLIfNeeded() {
        let current = storedGatewayURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let isDefault = current.isEmpty || current == "ws://127.0.0.1:18789"
        guard isDefault, let detected = SwarmConfigDetector.detectGatewayURL() else { return }
        storedGatewayURL = detected
        gatewayURLInput = detected
    }
}
