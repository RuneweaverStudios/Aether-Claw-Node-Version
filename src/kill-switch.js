/**
 * Aether-Claw Kill Switch (Node)
 * Flag-based halt; optional callback on trigger.
 */

const fs = require('fs');
const path = require('path');

const TriggerReason = {
  UNSIGNED_SKILL: 'unsigned_skill_execution',
  SIGNATURE_FAILURE: 'signature_verification_failure',
  USER_COMMAND: 'user_command_stop_swarm',
  CPU_THRESHOLD: 'cpu_threshold_exceeded',
  MEMORY_THRESHOLD: 'memory_threshold_exceeded',
  ANOMALY_DETECTED: 'anomaly_detected',
  MANUAL: 'manual_trigger'
};

function getDefaultFlagPath(rootDir) {
  return path.join(rootDir || path.resolve(__dirname, '..'), '.kill_switch_flag');
}

class KillSwitch {
  constructor(flagPathOrRoot, onTrigger = null) {
    this.flagPath = typeof flagPathOrRoot === 'string' && !flagPathOrRoot.endsWith('.md')
      ? flagPathOrRoot
      : getDefaultFlagPath(flagPathOrRoot);
    this._onTrigger = onTrigger;
    this._armed = false;
    this._triggered = false;
    this._triggerReason = null;
    this._triggerTime = null;
  }

  arm() {
    this._armed = true;
  }

  disarm() {
    this._armed = false;
    this._triggered = false;
    this._triggerReason = null;
    try { fs.unlinkSync(this.flagPath); } catch (e) {}
  }

  isArmed() {
    return this._armed;
  }

  isTriggered() {
    if (this._triggered) return true;
    try {
      if (fs.existsSync(this.flagPath)) {
        this._triggered = true;
        this._triggerTime = new Date().toISOString();
        return true;
      }
    } catch (e) {}
    return false;
  }

  trigger(reason, details = '') {
    if (!this._armed) return;
    this._triggered = true;
    this._triggerReason = reason;
    this._triggerTime = new Date().toISOString();
    try {
      fs.writeFileSync(this.flagPath, `${this._triggerTime}\n${reason}\n${details}`, 'utf8');
    } catch (e) {}
    if (this._onTrigger) this._onTrigger(reason);
  }

  recover() {
    this._triggered = false;
    this._triggerReason = null;
    try { fs.unlinkSync(this.flagPath); } catch (e) {}
  }
}

let _instance = null;

function getKillSwitch(rootDir = null) {
  if (!_instance) _instance = new KillSwitch(rootDir || path.resolve(__dirname, '..'));
  return _instance;
}

module.exports = { KillSwitch, TriggerReason, getKillSwitch };
