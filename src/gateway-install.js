/**
 * macOS gateway daemon install/restart for onboard step.
 * Writes LaunchAgent plist and runs launchctl load.
 * Used by cli.js onboard step 4; install.sh keeps its own inline gateway_prompt.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLIST_LABEL = 'com.aetherclaw.heartbeat';
const LOG_PATH = '/tmp/aetherclaw.log';

function getLaunchAgentsDir() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, 'Library', 'LaunchAgents');
}

function getPlistPath() {
  const dir = getLaunchAgentsDir();
  return dir ? path.join(dir, PLIST_LABEL + '.plist') : null;
}

function isPlistLoaded() {
  try {
    const out = execSync('launchctl list 2>/dev/null', { encoding: 'utf8' });
    return out.includes(PLIST_LABEL);
  } catch (_) {
    return false;
  }
}

function buildPlistContent(installDir, nodeExe) {
  const daemonPath = path.join(installDir, 'src', 'daemon.js');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeExe}</string>
        <string>${daemonPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${installDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_PATH}</string>
</dict>
</plist>
`;
}

function writePlistAndLoad(installDir) {
  const plistPath = getPlistPath();
  const dir = getLaunchAgentsDir();
  if (!dir || !plistPath) throw new Error('Could not resolve LaunchAgents path');
  const nodeExe = process.execPath;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(plistPath, buildPlistContent(installDir, nodeExe), 'utf8');
  execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
}

function unloadPlist() {
  const plistPath = getPlistPath();
  if (!plistPath || !fs.existsSync(plistPath)) return;
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
  } catch (_) {}
}

/**
 * Run interactive gateway setup on macOS.
 * @param {string} installDir - Project root (where src/daemon.js lives)
 * @param {{ ttyQuestion: (q: string, def?: string) => Promise<string> }} opts
 * @returns {{ didAction: boolean }}
 */
async function runGatewaySetup(installDir, opts = {}) {
  const { ttyQuestion } = opts;
  const plistPath = getPlistPath();
  const exists = plistPath && fs.existsSync(plistPath);
  const loaded = exists && isPlistLoaded();
  const daemonExists = fs.existsSync(path.join(installDir, 'src', 'daemon.js'));

  if (!daemonExists) {
    console.log('  ⚠ src/daemon.js not found; skipping gateway.\n');
    return { didAction: false };
  }

  if (exists) {
    if (loaded) {
      console.log('  Gateway daemon is already running.\n');
    } else {
      console.log('  Gateway daemon is installed but not running.\n');
    }
    const choice = (await ttyQuestion('  [1] Restart   [2] Reinstall   [3] Skip (default: 3): ', '3')).trim();
    if (choice === '1') {
      unloadPlist();
      writePlistAndLoad(installDir);
      console.log('  ✓ Gateway daemon restarted\n');
      return { didAction: true };
    }
    if (choice === '2') {
      unloadPlist();
      writePlistAndLoad(installDir);
      console.log('  ✓ Gateway daemon reinstalled and running\n');
      return { didAction: true };
    }
    return { didAction: false };
  }

  const install = (await ttyQuestion('  Install gateway daemon? [Y/n]: ', 'y')).trim().toLowerCase();
  if (install === 'y' || install === '') {
    writePlistAndLoad(installDir);
    console.log('  ✓ Gateway daemon installed and running\n');
    return { didAction: true };
  }
  return { didAction: false };
}

/**
 * Ensure gateway is installed (prompt if missing) or restart if already installed.
 * Used before launching any hatch option (TUI, Web UI, Telegram).
 * @param {string} installDir - Project root
 * @param {{ ttyQuestion: (q: string, def?: string) => Promise<string> }} opts
 */
async function ensureGatewayBeforeLaunch(installDir, opts = {}) {
  if (process.platform !== 'darwin') return;
  const daemonPath = path.join(installDir, 'src', 'daemon.js');
  if (!fs.existsSync(daemonPath)) return;
  const plistPath = getPlistPath();
  const exists = plistPath && fs.existsSync(plistPath);
  if (exists) {
    unloadPlist();
    writePlistAndLoad(installDir);
    console.log('  ✓ Gateway daemon restarted.\n');
    return;
  }
  const { ttyQuestion } = opts;
  if (!ttyQuestion) return;
  const install = (await ttyQuestion('  Install gateway daemon? [Y/n]: ', 'y')).trim().toLowerCase();
  if (install === 'y' || install === '') {
    writePlistAndLoad(installDir);
    console.log('  ✓ Gateway daemon installed and running\n');
  }
}

module.exports = { runGatewaySetup, ensureGatewayBeforeLaunch, getPlistPath, isPlistLoaded };