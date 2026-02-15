# Aether-Claw Heartbeat Configuration

> **Version**: 1.0.0
> **Last Updated**: 2026-02-12
> **Classification**: Proactive Task Configuration

## Heartbeat Overview

The heartbeat system enables Aether-Claw to operate proactively, performing scheduled tasks autonomously while respecting safety constraints.

**Default Interval**: 30 minutes
**Safety Mode**: Read-only by default

---

## Scheduled Tasks

### Task 1: Git Repository Scan
```yaml
name: git_repo_scan
enabled: true
interval: 30m
safety: read_only
action: |
  Scan local Git repositories for:
  - Uncommitted changes that might be lost
  - Branches that haven't been pushed
  - Stale branches older than 30 days
  - Potential merge conflicts
confirmation_required: false
notification: on_issues_found
```

### Task 2: Task List Review
```yaml
name: task_list_review
enabled: true
interval: 30m
safety: read_only
action: |
  Review task lists (Todoist/local) for:
  - High-priority items matching soul.md goals
  - Overdue tasks
  - Tasks that can be automated
confirmation_required: false
notification: on_high_priority
```

### Task 3: Memory Index Update
```yaml
name: memory_index_update
enabled: true
interval: 60m
safety: read_write
action: |
  Update brain_index.db if:
  - New entries in memory.md
  - Changes to soul.md or user.md
  - New audit log entries
confirmation_required: false
notification: silent
```

### Task 4: Skill Integrity Check
```yaml
name: skill_integrity_check
enabled: true
interval: 120m
safety: read_only
action: |
  Verify all loaded skills:
  - Check cryptographic signatures
  - Validate against known good hashes
  - Report any unsigned or modified skills
confirmation_required: false
notification: on_integrity_failure
```

### Task 5: System Health Check
```yaml
name: system_health_check
enabled: true
interval: 15m
safety: read_only
action: |
  Monitor system health:
  - Worker process status
  - Memory usage
  - Disk space in brain/ and skills/
  - Anomaly detection (CPU spikes)
confirmation_required: false
notification: on_anomaly
```

---

## Proactive Planning Rules

When heartbeat detects actionable items:

1. **Draft Plan**: Create a plan without executing
2. **Align Check**: Verify plan aligns with soul.md goals
3. **User Confirmation**: Request explicit approval
4. **Execute**: Run with full audit logging
5. **Report**: Notify user of completion

---

## Safe Proactive Actions

These actions can be performed WITHOUT user confirmation:

- Reading files in designated directories
- Scanning Git repository status (no commits)
- Indexing memory files
- Checking skill signatures
- Monitoring system health

## Actions Requiring Confirmation

These actions ALWAYS require user confirmation:

- Writing or modifying files
- Creating commits or pushes
- Network requests
- Installing packages
- Creating new skills
- Loading unsigned skills

---

## Kill Switch Triggers

Immediately halt heartbeat if:

- [ ] Unsigned skill execution detected
- [ ] Signature verification fails
- [ ] Unauthorized file access attempted
- [ ] User issues "stop_swarm" command
- [ ] Resource anomaly detected (CPU > 80% for > 60s)

---

## Next Heartbeat

**Scheduled**: [Set by gateway daemon / aetherclaw daemon]
**Tasks to Run**: [Dynamically determined]

---

*Modify this file to customize proactive behavior. Changes take effect on next heartbeat.*
