/**
 * Docker isolation (Node stub).
 * Full implementation would run tasks in containers.
 */

function runInContainer(image, command, opts = {}) {
  return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
}

module.exports = { runInContainer };
