/**
 * In-memory registry of connected nodes (role=node WS clients).
 * Supports node.list and node.invoke; used by ws-gateway and the nodes tool.
 */

/** @type {Map<string, { ws: import('ws'), deviceId?: string, caps: string[], commands: string[], permissions: Record<string, boolean>, connectedAt: number }>} */
const nodes = new Map();
let nodeIdSeq = 0;
const INVOKE_TIMEOUT_MS = 60000;
/** @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
const pendingInvoices = new Map();

function nextNodeId() {
  return 'node_' + (++nodeIdSeq) + '_' + Date.now();
}

/**
 * Register a node connection.
 * @param {string} nodeId - Connection/node id
 * @param {import('ws')} ws - WebSocket
 * @param {{ deviceId?: string, caps?: string[], commands?: string[], permissions?: Record<string, boolean> }} claims
 */
function registerNode(nodeId, ws, claims = {}) {
  nodes.set(nodeId, {
    ws,
    deviceId: claims.deviceId,
    caps: claims.caps || [],
    commands: claims.commands || [],
    permissions: claims.permissions || {},
    connectedAt: Date.now()
  });
}

function unregisterNode(nodeId) {
  nodes.delete(nodeId);
  pendingInvoices.forEach((pending, id) => {
    if (id.startsWith(nodeId + ':')) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Node disconnected'));
      pendingInvoices.delete(id);
    }
  });
}

/**
 * @returns {Array<{ id: string, deviceId?: string, caps: string[], commands: string[], permissions: Record<string, boolean>, connectedAt: number }>}
 */
function listNodes() {
  return Array.from(nodes.entries()).map(([id, n]) => ({
    id,
    deviceId: n.deviceId,
    caps: n.caps,
    commands: n.commands,
    permissions: n.permissions,
    connectedAt: n.connectedAt
  }));
}

/**
 * Invoke a command on a node. Sends invoke request over WS and waits for invoke_res.
 * @param {string} nodeId
 * @param {string} command - e.g. system.run, system.notify, canvas.navigate
 * @param {Record<string, any>} params
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
function invokeNode(nodeId, command, params = {}) {
  const node = nodes.get(nodeId);
  if (!node) return Promise.reject(new Error('Node not found: ' + nodeId));
  if (node.ws.readyState !== 1) return Promise.reject(new Error('Node disconnected'));

  const requestId = nodeId + ':' + Date.now() + '_' + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingInvoices.has(requestId)) {
        pendingInvoices.delete(requestId);
        reject(new Error('Node invoke timeout'));
      }
    }, INVOKE_TIMEOUT_MS);

    pendingInvoices.set(requestId, { resolve, reject, timer });

    node.ws.send(
      JSON.stringify({
        type: 'invoke',
        id: requestId,
        command,
        params
      })
    );
  });
}

/**
 * Handle a message from a node (invoke_res). Call this from ws-gateway when a node sends a frame.
 * @param {string} fromNodeId
 * @param {any} msg - { type: 'invoke_res', id, ok, result?, error? }
 */
function handleNodeMessage(fromNodeId, msg) {
  if (msg.type !== 'invoke_res' || !msg.id) return;
  const pending = pendingInvoices.get(msg.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingInvoices.delete(msg.id);
  pending.resolve({ ok: msg.ok, result: msg.result, error: msg.error });
}

module.exports = {
  nextNodeId,
  registerNode,
  unregisterNode,
  listNodes,
  invokeNode,
  handleNodeMessage,
  listNodesSync: listNodes
};
