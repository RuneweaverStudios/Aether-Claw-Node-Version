import SwiftUI
import AppKit

/// Renders one chat message: text (markdown), code blocks with Copy, optional steps, collapsible when long.
struct ChatBubbleView: View {
    let message: ChatMessage
    @State private var expanded = false
    private let collapseThreshold: Int = 1200

    var body: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 6) {
            if !message.steps.isEmpty {
                stepsSection
            }
            if let model = message.modelUsed, !model.isEmpty {
                Text(model)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let usage = message.usageSummary, !usage.isEmpty {
                Text(usage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            contentBlock
            if message.isStreaming {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
    }

    private var stepsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Steps")
                .font(.caption)
                .fontWeight(.medium)
            ForEach(message.steps) { step in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: step.type == "tool_result" ? "checkmark.circle" : "gearshape")
                        .font(.caption)
                    Text(stepLabel(step))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(8)
        .background(Color.gray.opacity(0.15))
        .cornerRadius(8)
    }

    private func stepLabel(_ step: AgentStep) -> String {
        if step.type == "tool_call", let name = step.name {
            return "Running \(name)…"
        }
        if step.type == "tool_result", let name = step.name {
            return "\(name) done"
        }
        return step.type
    }

    @ViewBuilder
    private var contentBlock: some View {
        let segments = splitContent(message.content)
        let isLong = message.content.count > collapseThreshold
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                switch seg {
                case .text(let s):
                    if !s.isEmpty {
                        Text(parseMarkdown(s))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                case .code(let lang, let code):
                    CodeBlockView(code: code, language: lang)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
        .padding(10)
        .background(message.role == "user" ? Color.blue.opacity(0.2) : Color.gray.opacity(0.2))
        .cornerRadius(10)
        .frame(maxHeight: (isLong && !expanded) ? 300 : nil)
        .clipped()
        .overlay(alignment: .bottom) {
            if isLong {
                Button(expanded ? "Show less" : "Show more") { expanded.toggle() }
                    .buttonStyle(.borderless)
                    .font(.caption)
            }
        }
    }

    private enum ContentSegment {
        case text(String)
        case code(lang: String, code: String)
    }

    private func splitContent(_ content: String) -> [ContentSegment] {
        var result: [ContentSegment] = []
        let pattern = #"```(\w*)\n?([\s\S]*?)```"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [.text(content)]
        }
        var lastEnd = content.startIndex
        let range = NSRange(content.startIndex..., in: content)
        regex.enumerateMatches(in: content, options: [], range: range) { match, _, _ in
            guard let m = match, let r1 = Range(m.range(at: 1), in: content), let r2 = Range(m.range(at: 2), in: content) else { return }
            let before = content[lastEnd..<content.index(content.startIndex, offsetBy: m.range.location)]
            if !before.isEmpty { result.append(.text(String(before))) }
            result.append(.code(lang: String(content[r1]).trimmingCharacters(in: .whitespaces), code: String(content[r2])))
            lastEnd = content.index(content.startIndex, offsetBy: m.range.location + m.range.length)
        }
        if lastEnd < content.endIndex {
            result.append(.text(String(content[lastEnd...])))
        }
        if result.isEmpty && !content.isEmpty { result.append(.text(content)) }
        return result
    }

    private func parseMarkdown(_ s: String) -> AttributedString {
        if let attr = try? AttributedString(markdown: s) { return attr }
        return AttributedString(s)
    }
}

struct CodeBlockView: View {
    let code: String
    let language: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if !language.isEmpty {
                    Text(language)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                }
                .buttonStyle(.borderless)
            }
            Text(code)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.black.opacity(0.08))
                .cornerRadius(6)
        }
    }
}
