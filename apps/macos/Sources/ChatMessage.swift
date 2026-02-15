import Foundation

struct ChatMessage: Identifiable {
    let id: UUID
    var role: String
    var content: String
    var modelUsed: String?
    var usageSummary: String?  // e.g. "prompt: 45, completion: 78"
    var steps: [AgentStep]
    var isStreaming: Bool

    init(id: UUID = UUID(), role: String, content: String, modelUsed: String? = nil, usageSummary: String? = nil, steps: [AgentStep] = [], isStreaming: Bool = false) {
        self.id = id
        self.role = role
        self.content = content
        self.modelUsed = modelUsed
        self.usageSummary = usageSummary
        self.steps = steps
        self.isStreaming = isStreaming
    }
}

struct AgentStep: Identifiable {
    let id = UUID()
    let type: String
    let name: String?
    let args: String?
    let result: String?
    let error: String?
}
