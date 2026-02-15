/**
 * WebSocket gateway (OpenClaw-style control plane).
 * Single WS server: connect handshake, RPC (health, status, chat.send, chat.history, agent), events (presence, tick).
 * Used by daemon; shared code from dashboard + gateway + tools.
 */

const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { loadConfig } = require('./config');
const { createReplyDispatcher, resolveSessionKey, buildSystemPromptForRun, buildWorkspaceSkillSnapshot } = require('./gateway');
const { runAgentLoop, runAgentLoopStream } = require('./agent-loop');
const { getSessionHistory, pushSessionMessage, setSessionHistory } = require('./tools');
const { classifyComplexity, tierFromScore } = require('./complexity');
const nodeRegistry = require('./node-registry');
const { buildHelloOk, normalizeParams } = require('./openclaw-protocol');

const ROOT_DEFAULT = path.resolve(__dirname, '..');
const PROTOCOL_VERSION = 3;
const serverStartMs = Date.now();

/** @type {Map<string, { role: string, scopes?: string[], connectedAt: number }>} */
const connections = new Map();
/** @type {Map<string, boolean>} sessionKey -> run in progress (for server-side queue) */
const runsInProgress = new Map();
let connectionIdSeq = 0;
let eventSeq = 0;
let tickIntervalMs = 15000;

function nextConnectionId() {
  return 'conn_' + (++connectionIdSeq) + '_' + Date.now();
}

function getSystemStatus(workspaceRoot) {
  try {
    const { getSystemStatus: dashStatus } = require('./dashboard');
    return dashStatus();
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function getConfigForUI() {
  try {
    const { getConfigForUI: dashConfig } = require('./dashboard');
    return dashConfig();
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/**
 * Check auth: token from params must match config or AETHERCLAW_GATEWAY_TOKEN; localhost can bypass if no token set.
 */
function checkAuth(params, isLocal) {
  const token = process.env.AETHERCLAW_GATEWAY_TOKEN;
  const configPath = path.join(ROOT_DEFAULT, 'swarm_config.json');
  let configToken = null;
  try {
    const config = loadConfig(configPath);
    configToken = config.gateway?.auth?.token;
  } catch (_) {}
  const expectedToken = token || configToken;
  if (!expectedToken) return true; // no token configured -> allow (localhost or any)
  const provided = params?.auth?.token;
  if (!provided) return false;
  return provided === expectedToken;
}

/**
 * Create WS gateway server. Optionally attach to existing HTTP server for upgrade.
 * @param {Object} opts - { workspaceRoot?, httpServer?, port?, host?, dashboard?: boolean }
 * @returns {{ server: http.Server, wss: WebSocketServer, listen: (cb?) => void }}
 */
function createWsGateway(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || ROOT_DEFAULT;
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 18789;
  const enableDashboard = opts.dashboard !== false;

  const httpServer =
    opts.httpServer ||
    http.createServer((req, res) => {
      const url = req.url?.split('?')[0];
      if (url === '/' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ gateway: 'aether-claw', ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', 'http://' + (request.headers.host || ''));
    if (url.pathname === '/' || url.pathname === '/ws' || url.pathname === '') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  const replyDispatcher = createReplyDispatcher({ workspaceRoot });
  const config = loadConfig(path.join(workspaceRoot, 'swarm_config.json'));
  tickIntervalMs = (config.gateway?.tickIntervalMs ?? 15) * 1000;

  wss.on('connection', (ws, request) => {
    const connId = nextConnectionId();
    const isLocal =
      request.socket.remoteAddress === '127.0.0.1' ||
      request.socket.remoteAddress === '::1' ||
      request.socket.remoteAddress === '::ffff:127.0.0.1';
    let handshaken = false;
    let role = null;
    let scopes = [];

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        ws.close(1008, 'Invalid JSON');
        return;
      }

      if (!handshaken) {
        if (msg.type !== 'req' || msg.method !== 'connect') {
          ws.close(1008, 'First frame must be connect');
          return;
        }
        const params = msg.params || {};
        const clientRole = params.role || 'operator';
        if (clientRole !== 'operator' && clientRole !== 'node') {
          sendRes(ws, msg.id, false, { error: 'Unsupported role' });
          return;
        }
        if (!checkAuth(params, isLocal)) {
          sendRes(ws, msg.id, false, { error: 'Auth failed' });
          ws.close(1008, 'Auth failed');
          return;
        }
        role = clientRole;
        scopes = params.scopes || (clientRole === 'operator' ? ['operator.read', 'operator.write'] : []);
        connections.set(connId, { role, scopes, connectedAt: Date.now() });
        if (clientRole === 'node') {
          nodeRegistry.registerNode(connId, ws, {
            deviceId: params.client?.id || params.device?.id,
            caps: params.caps || [],
            commands: params.commands || [],
            permissions: params.permissions || {}
          });
        }
        handshaken = true;
        const helloOk = buildHelloOk({
          connections,
          workspaceRoot,
          uptimeMs: Date.now() - serverStartMs,
          tickIntervalMs,
          mainSessionKey: 'main'
        });
        sendRes(ws, msg.id, true, helloOk);
        broadcastPresence();
        return;
      }

      if (role === 'node' && msg.type === 'invoke_res') {
        nodeRegistry.handleNodeMessage(connId, msg);
        return;
      }

      if (msg.type !== 'req' || !msg.id) return;
      const method = msg.method;
      const params = normalizeParams(msg.params || {});

      switch (method) {
        case 'health': {
          const status = getSystemStatus(workspaceRoot);
          sendRes(ws, msg.id, true, status.error ? { error: status.error } : { ok: true, ...status });
          break;
        }
        case 'status': {
          const status = getSystemStatus(workspaceRoot);
          sendRes(ws, msg.id, true, status);
          break;
        }
        case 'chat.send': {
          const text = (params.message || params.body || '').trim();
          const sessionKey = params.sessionKey || 'web';
          if (!text) {
            sendRes(ws, msg.id, false, { error: 'Empty message' });
            break;
          }
          try {
            const result = await replyDispatcher(sessionKey, text, { channel: 'ws', sessionKey });
            pushSessionMessage(sessionKey, 'user', text);
            pushSessionMessage(sessionKey, 'assistant', result.reply || result.error || '');
            sendRes(ws, msg.id, true, { reply: result.reply || '', error: result.error });
          } catch (e) {
            sendRes(ws, msg.id, false, { error: e.message || String(e) });
          }
          break;
        }
        case 'chat.history': {
          const sessionKey = params.sessionKey || 'web';
          const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
          const history = getSessionHistory(sessionKey, limit).map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }));
          sendRes(ws, msg.id, true, { messages: history });
          break;
        }
        case 'chat.export': {
          const sessionKey = params.sessionKey || 'web';
          const limit = Math.min(500, Math.max(1, Number(params.limit) || 100));
          const messages = getSessionHistory(sessionKey, limit).map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }));
          sendRes(ws, msg.id, true, { sessionKey, messages, exportedAt: new Date().toISOString() });
          break;
        }
        case 'chat.replace': {
          const sessionKey = params.sessionKey || 'web';
          const messages = params.messages;
          if (!Array.isArray(messages)) {
            sendRes(ws, msg.id, false, { error: 'messages array required' });
            break;
          }
          setSessionHistory(sessionKey, messages);
          sendRes(ws, msg.id, true, { sessionKey, replaced: messages.length });
          break;
        }
        case 'agent': {
          const text = (params.message || params.body || '').trim();
          const sessionKey = params.sessionKey || 'web';
          const runId = params.idempotencyKey || 'run_' + Date.now();
          const wantStream = params.stream === true;
          const readOnly = params.readOnly === true || params.mode === 'plan';
          if (!text) {
            sendRes(ws, msg.id, false, { error: 'Empty message' });
            break;
          }
          if (runsInProgress.get(sessionKey)) {
            sendRes(ws, msg.id, false, { ok: false, busy: true });
            break;
          }
          runsInProgress.set(sessionKey, true);
          sendRes(ws, msg.id, true, { runId, status: 'accepted' });
          const emitIdle = () => {
            runsInProgress.delete(sessionKey);
            sendEvent(ws, 'agent.idle', { sessionKey });
          };
          try {
            const skillsSnapshot = buildWorkspaceSkillSnapshot(workspaceRoot);
            const systemPrompt = buildSystemPromptForRun(workspaceRoot, { skillsSnapshot, readOnly });
            const conversationHistory = getSessionHistory(sessionKey, 20).map((m) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            }));
            let tier = readOnly ? 'reasoning' : 'action';
            if (!readOnly) {
              try {
                const score = await classifyComplexity(text, config);
                tier = tierFromScore(score, config);
              } catch (_) {}
            }

            if (wantStream) {
              const result = await runAgentLoopStream(workspaceRoot, text, systemPrompt, config, {
                tier,
                max_tokens: 4096,
                conversationHistory,
                readOnly,
                onChunk: (delta) => sendEvent(ws, 'agent.chunk', { runId, delta }),
                onStep: (step) => sendEvent(ws, 'agent.step', { runId, step })
              });
              pushSessionMessage(sessionKey, 'user', text);
              pushSessionMessage(sessionKey, 'assistant', result.reply || result.error || '');
              sendEvent(ws, 'agent', {
                runId,
                status: 'completed',
                reply: result.reply || '',
                error: result.error,
                modelUsed: result.modelUsed,
                usage: result.usage
              });
              emitIdle();
            } else {
              const result = await runAgentLoop(workspaceRoot, text, systemPrompt, config, {
                tier,
                max_tokens: 4096,
                conversationHistory,
                readOnly
              });
              pushSessionMessage(sessionKey, 'user', text);
              pushSessionMessage(sessionKey, 'assistant', result.reply || result.error || '');
              sendEvent(ws, 'agent', {
                runId,
                status: 'completed',
                reply: result.reply || '',
                error: result.error,
                modelUsed: result.modelUsed,
                usage: result.usage
              });
              emitIdle();
            }
          } catch (e) {
            sendEvent(ws, 'agent', {
              runId,
              status: 'failed',
              error: e.message || String(e)
            });
            emitIdle();
          }
          break;
        }
        case 'node.list': {
          const list = nodeRegistry.listNodes();
          sendRes(ws, msg.id, true, { nodes: list });
          break;
        }
        case 'node.invoke': {
          const nodeId = params.nodeId;
          const command = params.command;
          const invokeParams = params.params || {};
          if (!nodeId || !command) {
            sendRes(ws, msg.id, false, { error: 'nodeId and command required' });
            break;
          }
          try {
            const result = await nodeRegistry.invokeNode(nodeId, command, invokeParams);
            sendRes(ws, msg.id, true, result);
          } catch (e) {
            sendRes(ws, msg.id, false, { error: e.message || String(e) });
          }
          break;
        }
        // OpenClaw protocol: sessions
        case 'sessions.list': {
          const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
          const sessions = [
            { key: 'main', label: 'Main', lastActivityAt: Date.now(), agentId: null },
            { key: 'mac', label: 'Mac', lastActivityAt: Date.now(), agentId: null },
            { key: 'dashboard', label: 'Dashboard', lastActivityAt: Date.now(), agentId: null }
          ];
          sendRes(ws, msg.id, true, { sessions: sessions.slice(0, limit) });
          break;
        }
        case 'sessions.resolve': {
          const key = params.key || params.sessionId || 'main';
          sendRes(ws, msg.id, true, { key, sessionKey: key });
          break;
        }
        case 'sessions.patch': {
          sendRes(ws, msg.id, true, {});
          break;
        }
        case 'sessions.preview':
        case 'sessions.usage': {
          sendRes(ws, msg.id, true, {});
          break;
        }
        // OpenClaw protocol: config
        case 'config.get': {
          try {
            const fs = require('fs');
            const configPath = path.join(workspaceRoot, 'swarm_config.json');
            let raw = '{}';
            try {
              raw = fs.readFileSync(configPath, 'utf8');
            } catch (_) {}
            sendRes(ws, msg.id, true, {
              raw,
              path: configPath,
              mainSessionKey: 'main'
            });
          } catch (e) {
            sendRes(ws, msg.id, false, { error: e.message || String(e) });
          }
          break;
        }
        // OpenClaw protocol: node pairing (stub)
        case 'node.pair.list': {
          sendRes(ws, msg.id, true, { requests: [] });
          break;
        }
        // OpenClaw protocol: usage (stub)
        case 'usage.status':
        case 'usage.cost': {
          sendRes(ws, msg.id, true, { ts: Date.now() });
          break;
        }
        // OpenClaw ControlChannel stubs
        case 'last-heartbeat': {
          sendRes(ws, msg.id, true, { ts: Date.now(), status: 'ok' });
          break;
        }
        case 'system-event': {
          sendRes(ws, msg.id, true, {});
          break;
        }
        case 'system-presence': {
          const presence = Array.from(connections.entries()).map(([id, c]) => ({
            id: id,
            role: c.role,
            scopes: c.scopes,
            connectedAt: c.connectedAt
          }));
          sendRes(ws, msg.id, true, { connections: presence });
          break;
        }
        // OpenClaw protocol: setup wizard (Mac app). Node gateway has no interactive wizard; return done immediately.
        case 'wizard.start': {
          const sessionId = 'mac-wizard-' + Date.now();
          sendRes(ws, msg.id, true, {
            sessionId,
            done: true,
            step: null,
            status: 'done',
            error: null
          });
          break;
        }
        case 'wizard.next': {
          sendRes(ws, msg.id, true, {
            done: true,
            step: null,
            status: 'done',
            error: null
          });
          break;
        }
        case 'wizard.status': {
          sendRes(ws, msg.id, true, {
            status: 'done',
            step: null,
            error: null
          });
          break;
        }
        case 'wizard.cancel': {
          sendRes(ws, msg.id, true, { status: 'cancelled', error: null });
          break;
        }
        default:
          sendRes(ws, msg.id, false, { error: 'Unknown method: ' + method });
      }
    });

    ws.on('close', () => {
      if (role === 'node') nodeRegistry.unregisterNode(connId);
      connections.delete(connId);
      broadcastPresence();
    });
  });

  let tickTimer = null;
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.readyState === 1) sendEvent(client, 'tick', { ts: Date.now() });
      });
    }, tickIntervalMs);
  }
  startTick();

  function sendRes(ws, id, ok, payloadOrError) {
    if (ws.readyState !== 1) return;
    const msg = { type: 'res', id, ok };
    if (ok) msg.payload = payloadOrError;
    else msg.error = payloadOrError;
    ws.send(JSON.stringify(msg));
  }

  function sendEvent(ws, event, payload) {
    if (ws.readyState !== 1) return;
    const seq = ++eventSeq;
    ws.send(JSON.stringify({ type: 'event', event, payload, seq }));
  }

  function broadcastPresence() {
    const presence = Array.from(connections.entries()).map(([id, c]) => ({
      id,
      role: c.role,
      scopes: c.scopes,
      connectedAt: c.connectedAt
    }));
    wss.clients.forEach((client) => {
      if (client.readyState === 1) sendEvent(client, 'presence', { connections: presence });
    });
  }

  return {
    server: httpServer,
    wss,
    listen(cb) {
      if (opts.httpServer) {
        if (typeof cb === 'function') cb();
      } else {
        httpServer.listen(port, host, () => {
          if (typeof cb === 'function') cb();
        });
      }
    }
  };
}

module.exports = { createWsGateway, getSystemStatus, getConfigForUI, PROTOCOL_VERSION };
