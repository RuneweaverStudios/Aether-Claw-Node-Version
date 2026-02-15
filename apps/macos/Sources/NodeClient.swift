import Foundation

/// WebSocket client that connects to the gateway as a **node** (system.run, system.notify).
/// Handles incoming invoke requests and sends invoke_res.
final class NodeClient: ObservableObject {
    @Published var isConnected = false
    @Published var lastError: String?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var url: URL?
    private var token: String?

    init() {}

    func connect(wsURL: String, token: String? = nil) {
        self.token = token
        guard let u = URL(string: wsURL.hasPrefix("ws") ? wsURL : "ws://\(wsURL)") else {
            lastError = "Invalid URL"
            return
        }
        url = u
        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config)
        task = session?.webSocketTask(with: u)
        task?.resume()
        receive()
        sendConnect()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    private func sendConnect() {
        var params: [String: Any] = [
            "role": "node",
            "caps": ["screen", "canvas"],
            "commands": ["system.run", "system.notify", "canvas.navigate"],
            "permissions": PermissionsProvider.currentPermissions().mapValues { $0 }
        ]
        if let t = token, !t.isEmpty {
            params["auth"] = ["token": t]
        }
        let body: [String: Any] = ["type": "req", "id": "node_connect_\(Int(Date().timeIntervalSince1970))", "method": "connect", "params": params]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        task?.send(.string(String(data: data, encoding: .utf8)!)) { [weak self] err in
            if let e = err { self?.lastError = e.localizedDescription }
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let msg):
                switch msg {
                case .string(let s):
                    self?.handleMessage(s)
                case .data(let d):
                    if let s = String(data: d, encoding: .utf8) { self?.handleMessage(s) }
                @unknown default: break
                }
            case .failure: break
            }
            self?.receive()
        }
    }

    private func handleMessage(_ s: String) {
        guard let data = s.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        if json["type"] as? String == "res", let id = json["id"] as? String, id.hasPrefix("node_connect") {
            let ok = json["ok"] as? Bool ?? false
            if ok, (json["payload"] as? [String: Any])?["type"] as? String == "hello-ok" {
                DispatchQueue.main.async { [weak self] in
                    self?.isConnected = true
                    self?.lastError = nil
                }
            } else {
                DispatchQueue.main.async { [weak self] in
                    self?.isConnected = false
                    self?.lastError = (json["error"] as? [String: Any])?["error"] as? String ?? "Node connect failed"
                }
            }
            return
        }

        if json["type"] as? String == "invoke", let invokeId = json["id"] as? String, let command = json["command"] as? String, let params = json["params"] as? [String: Any] {
            handleInvoke(id: invokeId, command: command, params: params)
        }
    }

    private func sendInvokeRes(id: String, ok: Bool, result: [String: Any]? = nil, error: String? = nil) {
        var body: [String: Any] = ["type": "invoke_res", "id": id, "ok": ok]
        if ok, let r = result { body["result"] = r }
        if let e = error { body["error"] = e }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        task?.send(.string(String(data: data, encoding: .utf8)!)) { _ in }
    }

    private func handleInvoke(id: String, command: String, params: [String: Any]) {
        switch command {
        case "system.run":
            NodeInvokeHandler.handleSystemRun(invokeId: id, params: params) { [weak self] ok, result, err in
                self?.sendInvokeRes(id: id, ok: ok, result: result, error: err)
            }
        case "system.notify":
            NodeInvokeHandler.handleNotify(params: params)
            sendInvokeRes(id: id, ok: true, result: ["delivered": true])
        default:
            sendInvokeRes(id: id, ok: false, error: "Unsupported command: \(command)")
        }
    }
}
