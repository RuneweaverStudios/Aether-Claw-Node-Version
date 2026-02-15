/**
 * OpenClaw wire protocol helpers for the Node gateway.
 * Builds HelloOk (connect response) and Snapshot so the OpenClaw macOS app can connect as-is.
 * Protocol version 3; frame types: req, res, event.
 */

const path = require('path');

const PROTOCOL_VERSION = 3;

/**
 * Build presence entry for snapshot (OpenClaw PresenceEntry shape).
 */
function buildPresenceEntry(connId, role, scopes, connectedAt) {
  return {
    host: null,
    ip: null,
    version: null,
    platform: 'node',
    deviceFamily: null,
    modelIdentifier: null,
    mode: 'ui',
    lastInputSeconds: null,
    reason: null,
    tags: null,
    text: null,
    ts: Math.floor(connectedAt / 1000),
    deviceId: null,
    roles: role ? [role] : null,
    scopes: scopes && scopes.length ? scopes : null,
    instanceId: connId
  };
}

/**
 * Build Snapshot for HelloOk (OpenClaw Snapshot shape).
 */
function buildSnapshot(connections, workspaceRoot, uptimeMs) {
  const presence = Array.from(connections.entries()).map(([id, c]) =>
    buildPresenceEntry(id, c.role, c.scopes, c.connectedAt)
  );
  let configPath = null;
  let stateDir = null;
  try {
    const cfg = require('./config').loadConfig(path.join(workspaceRoot, 'swarm_config.json'));
    stateDir = cfg.gateway?.stateDir ?? undefined;
  } catch (_) {}
  return {
    presence,
    health: { ok: true },
    stateVersion: { presence: 1, health: 1 },
    uptimeMs: uptimeMs ?? 0,
    configPath: workspaceRoot || null,
    stateDir: stateDir || null,
    sessionDefaults: {},
    authMode: 'token'
  };
}

/**
 * Build full HelloOk payload for connect response (OpenClaw HelloOk shape).
 * The OpenClaw client decodes res.payload as HelloOk.
 */
function buildHelloOk(opts) {
  const {
    connections = new Map(),
    workspaceRoot = process.cwd(),
    uptimeMs = 0,
    tickIntervalMs = 15000,
    canvasHostUrl = null,
    mainSessionKey = 'main'
  } = opts;

  const snapshot = buildSnapshot(connections, workspaceRoot, uptimeMs);

  return {
    type: 'hello-ok',
    protocol: PROTOCOL_VERSION,
    server: {
      name: 'aether-claw',
      version: '1.0.0',
      node: true
    },
    features: {
      agent: true,
      chat: true,
      sessions: true,
      config: true
    },
    snapshot,
    canvasHostUrl: canvasHostUrl ?? undefined,
    auth: undefined,
    policy: { tickIntervalMs }
  };
}

/**
 * Normalize params from OpenClaw client (camelCase keys).
 * Our gateway often uses sessionKey; OpenClaw sends sessionKey in params.
 */
function normalizeParams(params) {
  if (!params || typeof params !== 'object') return params;
  const p = { ...params };
  if (p.sessionkey !== undefined && p.sessionKey === undefined) p.sessionKey = p.sessionkey;
  if (p.sessionkey !== undefined) delete p.sessionkey;
  return p;
}

module.exports = {
  PROTOCOL_VERSION,
  buildHelloOk,
  buildSnapshot,
  buildPresenceEntry,
  normalizeParams
};
