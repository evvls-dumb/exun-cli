'use strict';
// Read-only access to acquisitions in the current JANUS working directory.
// Never accept a filesystem path from a browser: only a direct child folder name,
// and only files explicitly enumerated in that acquisition's manifest.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SCHEMA = 'janus.acquisition/1';
const LIMIT = 300;
const MAX_TEXT = 256 * 1024;
const MAX_MANIFEST = 8 * 1024 * 1024;

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function validName(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 180 &&
    id !== '.' && id !== '..' && !id.includes('..') && !/[\\/\x00-\x1f]/.test(id);
}
function collection(root, id) {
  if (!validName(id)) fail('Invalid collection name');
  const dir = path.join(root, id);
  let st;
  try { st = fs.lstatSync(dir); } catch { fail('Collection not found', 404); }
  if (!st.isDirectory() || st.isSymbolicLink()) fail('Collection not found', 404);
  // A symlink elsewhere in the parent hierarchy should never become a path shortcut.
  if (path.dirname(fs.realpathSync(dir)) !== fs.realpathSync(root)) fail('Invalid collection location', 403);
  const mf = path.join(dir, 'manifest.json');
  let raw;
  try {
    const s = fs.lstatSync(mf);
    if (!s.isFile() || s.isSymbolicLink() || s.size > MAX_MANIFEST) fail('Invalid manifest');
    raw = JSON.parse(fs.readFileSync(mf, 'utf8'));
  } catch (err) {
    if (err.status) throw err;
    fail('Missing or unreadable acquisition manifest', 404);
  }
  if (raw.schema !== SCHEMA || !Array.isArray(raw.items) || raw.target?.kind !== 'raspberry-pi') fail('Not a Raspberry Pi acquisition', 404);
  return { id, dir, manifest: raw };
}
function overview({ id, manifest: m }) {
  const files = m.items.filter(x => x.path?.startsWith('pi/files/')).length;
  const logs = m.items.filter(x => /^pi\/logs\/.*\.txt$/i.test(x.path || '')).length;
  return { id, created: m.created, host: m.target.address || '', count: m.items.length,
    warnings: m.warnings?.length || 0, files, logs,
    graph: m.items.some(x => x.path === 'pi-stream.csv'),
    chainHead: m.chain_head || null };
}
function list(root) {
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return dirs.filter(x => x.isDirectory() && !x.isSymbolicLink()).slice(0, 1500)
    .map(d => { try { return overview(collection(root, d.name)); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)) || b.id.localeCompare(a.id))
    .slice(0, LIMIT);
}
function describe(root, id) {
  const c = collection(root, id);
  return { ...overview(c), examiner: c.manifest.examiner, case: c.manifest.case,
    note: c.manifest.note, warningsText: (c.manifest.warnings || []).slice(0, 100),
    items: c.manifest.items.map(({ path: p, bytes, kind, sha256 }) => ({ path: p, bytes, kind, sha256 })) };
}
function file(root, id, rel) {
  const c = collection(root, id);
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0') ||
      rel.split('/').some(p => !p || p === '.' || p === '..')) fail('Invalid file path');
  const item = c.manifest.items.find(x => x.path === rel);
  if (!item) fail('File not recorded in this acquisition', 404);
  const full = path.join(c.dir, ...rel.split('/'));
  let s;
  try { s = fs.lstatSync(full); } catch { fail('Recorded file is missing', 404); }
  if (!s.isFile() || s.isSymbolicLink()) fail('Not a regular file', 403);
  const real = fs.realpathSync(full), base = fs.realpathSync(c.dir) + path.sep;
  if (!real.startsWith(base)) fail('Invalid file location', 403);
  return { full, item, size: s.size };
}
function text(root, id, rel) {
  const f = file(root, id, rel);
  // Read the first portion, not the entire binary or multi-megabyte system log.
  const n = Math.min(f.size, MAX_TEXT), handle = fs.openSync(f.full, 'r');
  const data = Buffer.alloc(n);
  try { fs.readSync(handle, data, 0, n, 0); } finally { fs.closeSync(handle); }
  return { path: rel, text: data.toString('utf8'), truncated: f.size > MAX_TEXT, bytes: f.size };
}
function downsample(points) {
  if (points.length <= 900) return points;
  const out = [];
  for (let i = 0; i < points.length; i += 2) out.push(points[i]);
  return out;
}
async function graph(root, id) {
  const f = file(root, id, 'pi-stream.csv');
  const stream = fs.createReadStream(f.full, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let columns = [], points = [], rows = 0;
  try {
    for await (const line of lines) {
      if (!columns.length) { columns = line.replace(/^\uFEFF/, '').split(',').map(x => x.trim()).slice(0, 32); continue; }
      if (!line.trim()) continue;
      const parts = line.split(',');
      const vals = columns.map((_, i) => {
        const t = (parts[i] || '').trim();
        if (!t || t.toLowerCase() === 'nan' || t.toLowerCase() === 'null') return null;
        const v = Number(t);
        return Number.isFinite(v) ? v : null;
      });
      points.push(vals); rows++;
      if (points.length > 1800) points = downsample(points);
    }
  } finally { lines.close(); stream.destroy(); }
  return { columns, points: downsample(points), totalRows: rows };
}
module.exports = { list, describe, file, text, graph, collection };
