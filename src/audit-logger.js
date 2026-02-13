/**
 * Aether-Claw Audit Logger (Node)
 * Structured append-only audit log to brain/audit_log.md.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = ['INFO', 'WARN', 'ERROR', 'SECURITY', 'AUDIT'];

function getDefaultAuditPath(rootDir) {
  return path.join(rootDir || path.resolve(__dirname, '..'), 'brain', 'audit_log.md');
}

function ensureFile(auditPath) {
  if (fs.existsSync(auditPath)) return;
  const dir = path.dirname(auditPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const created = new Date().toISOString().slice(0, 10);
  const header = `# Aether-Claw Audit Log

> **Classification**: Immutable Audit Trail
> **Created**: ${created}
> **Warning**: DO NOT MODIFY EXISTING ENTRIES

## Log Format

\`\`\`
[TIMESTAMP] [LEVEL] [AGENT] [ACTION] - Details
\`\`\`

Levels: INFO | WARN | ERROR | SECURITY | AUDIT

---

## Audit Entries

`;
  fs.writeFileSync(auditPath, header, 'utf8');
}

function formatEntry(entry) {
  let out = `### ${entry.timestamp} | ${entry.level} | ${entry.agent} | ${entry.action}\n- ${entry.details}\n`;
  if (entry.outcome) out += `- Result: ${entry.outcome}\n`;
  return out + '\n';
}

class AuditLogger {
  constructor(auditFileOrRoot) {
    this.auditPath = typeof auditFileOrRoot === 'string' && auditFileOrRoot.endsWith('.md')
      ? auditFileOrRoot
      : getDefaultAuditPath(auditFileOrRoot);
    ensureFile(this.auditPath);
  }

  log(level, agent, action, details, outcome = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVELS.includes(level) ? level : 'INFO',
      agent,
      action,
      details,
      outcome
    };
    fs.appendFileSync(this.auditPath, formatEntry(entry), 'utf8');
  }

  logAction(level, agent, action, details, outcome = null) {
    this.log(level, agent, action, details, outcome);
  }

  logSkillExecution(skillName, agent, outcome, details = null) {
    this.log('AUDIT', agent, 'SKILL_EXECUTION', details || `Executed skill: ${skillName}`, outcome);
  }

  logSecurityEvent(eventType, details, agent = 'SYSTEM', outcome = null) {
    this.log('SECURITY', agent, `SECURITY_${eventType.toUpperCase()}`, details, outcome);
  }

  logAnomaly(anomalyType, severity, resolution = null) {
    this.log('WARN', 'SYSTEM', 'ANOMALY_DETECTED', `[${severity.toUpperCase()}] ${anomalyType}`, resolution || 'pending');
  }

  logKillSwitch(trigger, initiatedBy = 'SYSTEM') {
    this.log('SECURITY', initiatedBy, 'KILL_SWITCH_ACTIVATED', `Trigger: ${trigger}`, 'all_operations_halted');
  }

  getRecentEntries(count = 10) {
    if (!fs.existsSync(this.auditPath)) return [];
    const content = fs.readFileSync(this.auditPath, 'utf8');
    const entries = [];
    let current = [];
    for (const line of content.split('\n')) {
      if (line.startsWith('### ')) {
        if (current.length) {
          entries.push(current.join('\n'));
          if (entries.length >= count) break;
        }
        current = [line];
      } else if (current.length) current.push(line);
    }
    if (current.length && entries.length < count) entries.push(current.join('\n'));
    return entries;
  }

  search(query) {
    if (!fs.existsSync(this.auditPath)) return [];
    const content = fs.readFileSync(this.auditPath, 'utf8');
    const q = query.toLowerCase();
    const matches = [];
    let current = [];
    for (const line of content.split('\n')) {
      if (line.startsWith('### ')) {
        if (current.length) {
          const text = current.join('\n');
          if (text.toLowerCase().includes(q)) matches.push(text);
        }
        current = [line];
      } else if (current.length) current.push(line);
    }
    if (current.length && current.join('\n').toLowerCase().includes(q)) matches.push(current.join('\n'));
    return matches;
  }
}

let _globalLogger = null;

function getLogger(rootDir) {
  if (!_globalLogger) _globalLogger = new AuditLogger(rootDir || path.resolve(__dirname, '..'));
  return _globalLogger;
}

function logAction(level, agent, action, details, outcome = null, rootDir = null) {
  getLogger(rootDir).logAction(level, agent, action, details, outcome);
}

function logSecurityEvent(eventType, details, agent = 'SYSTEM', outcome = null, rootDir = null) {
  getLogger(rootDir).logSecurityEvent(eventType, details, agent, outcome);
}

module.exports = {
  AuditLogger,
  getLogger,
  logAction,
  logSecurityEvent,
  LOG_LEVELS
};
