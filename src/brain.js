const fs = require('fs');
const path = require('path');

function getBrainDir(baseDir) {
  const brainDir = path.join(baseDir || process.cwd(), 'brain');
  if (!fs.existsSync(brainDir)) fs.mkdirSync(brainDir, { recursive: true });
  return brainDir;
}

function getIndexPath(baseDir) {
  return path.join(getBrainDir(baseDir), 'brain_index.json');
}

function readIndex(baseDir) {
  const fp = getIndexPath(baseDir);
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { files: {}, versions: {} };
  }
}

function writeIndex(index, baseDir) {
  const fp = getIndexPath(baseDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(index, null, 2), 'utf8');
}

function indexFile(filePath, baseDir) {
  const brainDir = getBrainDir(baseDir);
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(brainDir, filePath);
  if (!fs.existsSync(fullPath)) throw new Error('File not found: ' + fullPath);

  const name = path.basename(fullPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const index = readIndex(baseDir);

  index.files[name] = index.files[name] || { versions: [] };
  const versions = index.files[name].versions;
  const version = versions.length + 1;
  versions.push({ version, content: content.slice(0, 5000), timestamp: new Date().toISOString() });

  writeIndex(index, baseDir);
  return version;
}

function indexAll(baseDir) {
  const brainDir = getBrainDir(baseDir);
  const results = {};
  try {
    const names = fs.readdirSync(brainDir).filter(n => n.endsWith('.md'));
    for (const name of names) {
      results[name] = indexFile(name, baseDir);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return results;
}

function searchMemory(query, baseDir, limit = 5) {
  const index = readIndex(baseDir);
  const hits = [];
  const q = query.toLowerCase();
  for (const [name, data] of Object.entries(index.files || {})) {
    const last = data.versions?.slice(-1)[0];
    if (last && last.content && last.content.toLowerCase().includes(q)) {
      hits.push({ file_name: name, content: last.content.slice(0, 300), timestamp: last.timestamp });
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

module.exports = { getBrainDir, indexFile, indexAll, searchMemory, readIndex };
