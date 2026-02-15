import Foundation

/// Callbacks for a streaming agent run (keyed by runId after accept).
struct AgentStreamCallbacks {
    var onChunk: (String) -> Void
    var onStep: ([String: Any]) -> Void
    var onComplete: (String?, String?, String?, [String: Any]?) -> Void  // reply, modelUsed, error, usage
}

/// WebSocket client for Aether-Claw gateway (connect handshake, RPC, events).
final class GatewayClient: ObservableObject {
    @Published var isConnected = false {
        didSet {
            GatewayConnectionStatus.isConnected = isConnected
            DispatchQueue.main.async { NotificationCenter.default.post(name: .gatewayConnectionDidChange, object: nil) }
        }
    }
    @Published var lastError: String? {
        didSet {
            GatewayConnectionStatus.lastError = lastError
            DispatchQueue.main.async { NotificationCenter.default.post(name: .gatewayConnectionDidChange, object: nil) }
        }
    }
    @Published var statusBanner: String?  // first_run, missing API key, or nil
    @Published var agentIdleSessionKey: String?  // set when event agent.idle received; client clears after handling

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var url: URL?
    private var token: String?
    private var reqId = 0
    private var pending: [String: (Result<GatewayPayload, Error>) -> Void] = [:]
    private var streamCallbacksByRunId: [String: AgentStreamCallbacks] = [:]
    private var reqIdToRunId: [String: String] = [:]  // after agent accept, map reqId -> runId

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
        isConnected = false  // didSet updates GatewayConnectionStatus
    }

    func clearAgentIdleSessionKey() {
        agentIdleSessionKey = nil
    }

    private func sendConnect() {
        reqId += 1
        let id = "c\(reqId)"
        var params: [String: Any] = [
            "role": "operator",
            "scopes": ["operator.read", "operator.write"],
            "minProtocol": 3,
            "maxProtocol": 3,
        ]
        if let t = token, !t.isEmpty {
            params["auth"] = ["token": t]
        }
        sendReq(id: id, method: "connect", params: params)
        pending[id] = { [weak self] result in
            switch result {
            case .success(let p):
                if p.type == "hello-ok" {
                    self?.isConnected = true
                    self?.lastError = nil
                }
            case .failure:
                self?.isConnected = false
            }
        }
    }

    private func sendReq(id: String, method: String, params: [String: Any]) {
        let body: [String: Any] = ["type": "req", "id": id, "method": method, "params": params]
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
        if json["type"] as? String == "res", let id = json["id"] as? String {
            let ok = json["ok"] as? Bool ?? false
            let payload = json["payload"] as? [String: Any]
            let err = json["error"] as? [String: Any]
            pending[id]?(.success(GatewayPayload(type: payload?["type"] as? String, runId: payload?["runId"] as? String, ok: ok, payload: payload, error: err)))
            pending.removeValue(forKey: id)
        }
        if json["type"] as? String == "event", let event = json["event"] as? String, let payload = json["payload"] as? [String: Any] {
            let runId = payload["runId"] as? String
            switch event {
            case "agent.chunk":
                if let rid = runId, let delta = payload["delta"] as? String, let cbs = streamCallbacksByRunId[rid] {
                    DispatchQueue.main.async { cbs.onChunk(delta) }
                }
            case "agent.step":
                if let rid = runId, let step = payload["step"] as? [String: Any], let cbs = streamCallbacksByRunId[rid] {
                    DispatchQueue.main.async { cbs.onStep(step) }
                }
            case "agent":
                if let rid = runId, let cbs = streamCallbacksByRunId[rid] {
                    streamCallbacksByRunId.removeValue(forKey: rid)
                    let reply = payload["reply"] as? String
                    let modelUsed = payload["modelUsed"] as? String
                    let err = payload["error"] as? String
                    let usage = payload["usage"] as? [String: Any]
                    DispatchQueue.main.async { cbs.onComplete(reply, modelUsed, err, usage) }
                }
            case "agent.idle":
                if let sk = payload["sessionKey"] as? String {
                    DispatchQueue.main.async { [weak self] in self?.agentIdleSessionKey = sk }
                }
            default: break
            }
        }
    }

    // MARK: - Agent (streaming)

    func sendAgent(message: String, sessionKey: String = "mac", readOnly: Bool = false, onChunk: @escaping (String) -> Void, onStep: @escaping ([String: Any]) -> Void, onComplete: @escaping (String?, String?, String?, [String: Any]?) -> Void) {
        reqId += 1
        let id = "a\(reqId)"
        var params: [String: Any] = ["message": message, "sessionKey": sessionKey, "stream": true]
        if readOnly { params["readOnly"] = true }
        sendReq(id: id, method: "agent", params: params)
        let cbs = AgentStreamCallbacks(onChunk: onChunk, onStep: onStep, onComplete: onComplete)
        pending[id] = { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let p):
                if p.ok, let runId = p.runId {
                    self.reqIdToRunId[id] = runId
                    self.streamCallbacksByRunId[runId] = cbs
                } else if p.payload?["busy"] as? Bool == true {
                    DispatchQueue.main.async { onComplete(nil, nil, "busy", nil) }
                } else {
                    let err = (p.error?["message"] as? String) ?? (p.error?["error"] as? String) ?? "Request failed"
                    DispatchQueue.main.async { onComplete(nil, nil, err, nil) }
                }
            case .failure:
                DispatchQueue.main.async { onComplete(nil, nil, "Request failed", nil) }
            }
        }
    }

    // MARK: - Chat history / export / replace

    func chatHistory(sessionKey: String = "mac", completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        reqId += 1
        let id = "h\(reqId)"
        sendReq(id: id, method: "chat.history", params: ["sessionKey": sessionKey])
        pending[id] = { [weak self] result in
            switch result {
            case .success(let p):
                if p.ok, let list = p.payload?["messages"] as? [[String: Any]] {
                    DispatchQueue.main.async { completion(.success(list)) }
                } else {
                    DispatchQueue.main.async { completion(.failure(NSError(domain: "Gateway", code: -1, userInfo: [NSLocalizedDescriptionKey: "No messages"]))) }
                }
            case .failure(let e):
                DispatchQueue.main.async { completion(.failure(e)) }
            }
            self?.pending.removeValue(forKey: id)
        }
    }

    func chatExport(sessionKey: String = "mac", completion: @escaping (Result<[String: Any], Error>) -> Void) {
        reqId += 1
        let id = "e\(reqId)"
        sendReq(id: id, method: "chat.export", params: ["sessionKey": sessionKey])
        pending[id] = { [weak self] result in
            switch result {
            case .success(let p):
                if p.ok, let payload = p.payload {
                    DispatchQueue.main.async { completion(.success(payload)) }
                } else {
                    DispatchQueue.main.async { completion(.failure(NSError(domain: "Gateway", code: -1, userInfo: [NSLocalizedDescriptionKey: "Export failed"]))) }
                }
            case .failure(let e):
                DispatchQueue.main.async { completion(.failure(e)) }
            }
            self?.pending.removeValue(forKey: id)
        }
    }

    func chatReplace(sessionKey: String = "mac", messages: [[String: Any]], completion: @escaping (Result<Void, Error>) -> Void) {
        reqId += 1
        let id = "r\(reqId)"
        sendReq(id: id, method: "chat.replace", params: ["sessionKey": sessionKey, "messages": messages])
        pending[id] = { [weak self] result in
            switch result {
            case .success(let p):
                DispatchQueue.main.async { completion(p.ok ? .success(()) : .failure(NSError(domain: "Gateway", code: -1, userInfo: [NSLocalizedDescriptionKey: "Replace failed"]))) }
            case .failure(let e):
                DispatchQueue.main.async { completion(.failure(e)) }
            }
            self?.pending.removeValue(forKey: id)
        }
    }

    func fetchStatus(completion: @escaping (Result<[String: Any], Error>) -> Void) {
        reqId += 1
        let id = "s\(reqId)"
        sendReq(id: id, method: "status", params: [:])
        pending[id] = { [weak self] result in
            switch result {
            case .success(let p):
                if p.ok, let payload = p.payload {
                    DispatchQueue.main.async { completion(.success(payload)) }
                } else {
                    DispatchQueue.main.async { completion(.failure(NSError(domain: "Gateway", code: -1, userInfo: [NSLocalizedDescriptionKey: "Status failed"]))) }
                }
            case .failure(let e):
                DispatchQueue.main.async { completion(.failure(e)) }
            }
            self?.pending.removeValue(forKey: id)
        }
    }
}

struct GatewayPayload {
    let type: String?
    let runId: String?
    let ok: Bool
    let payload: [String: Any]?
    let error: [String: Any]?
}
