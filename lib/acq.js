'use strict';
// An acquisition is a folder: the extracted files, plus manifest.json that lists every item with its
// SHA-256 and a hash-chained log of what was done. `verify` recomputes all of it.
// It detects changes made afterwards. It cannot say who made them, and anyone who edits files AND
// rewrites the manifest consistently can fool it, so record the chain head somewhere separate.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { EventEmitter } = require('events');
const { Custody, sha256 } = require('./custody');
const pkg = require('../package.json');
const SCHEMA = 'janus.acquisition/1';

function safeRel(p) {
  const n = path.posix.normalize(String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!n || n === '.' || n === '..' || n.startsWith('../') || n.includes('\0')) throw new Error('unsafe path: ' + p);
  return n.split('/').map(s => s.replace(/[<>:"|?*\x00-\x1f]/g, '_')).join('/');
}
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

class Acquisition extends EventEmitter {
  /** meta: { target:{kind,address}, examiner, case, note } */
  constructor(dir, meta = {}) {
    super();
    this.dir = path.resolve(dir); this.mf = path.join(this.dir, 'manifest.json');
    if (fs.existsSync(this.mf)) this.m = JSON.parse(fs.readFileSync(this.mf, 'utf8'));
    else {
      if (fs.existsSync(this.dir) && fs.readdirSync(this.dir).length) throw new Error(this.dir + ' is not empty and has no manifest.json. Use a new folder.');
      fs.mkdirSync(this.dir, { recursive: true });
      this.m = { schema: SCHEMA, tool: { name: pkg.name, version: pkg.version }, created: new Date().toISOString(),
        examiner: meta.examiner || null, case: meta.case || null, note: meta.note || null, target: meta.target || {},
        host: { hostname: os.hostname(), platform: process.platform, node: process.version }, items: [], warnings: [], log: [], chain_head: null };
    }
    this.log = new Custody(this.m.log);
    if (!this.m.log.length) this.log.add('acquisition-started', `${(meta.target && (meta.target.kind + ' ' + (meta.target.address || ''))) || 'target'}`.trim());
    this.open = new Set();
  }
  _unique(rel) { let r = rel, i = 2; const ext = path.posix.extname(rel), base = rel.slice(0, rel.length - ext.length); while (fs.existsSync(path.join(this.dir, r)) || this.open.has(r)) r = `${base}-${i++}${ext}`; return r; }
  _item(rel, hash, bytes, o) {
    const it = { path: rel, kind: o.kind || 'file', sha256: hash, bytes, acquired_at: new Date().toISOString(), source: o.source || null, note: o.note || null, derived_from: o.derivedFrom || null };
    this.m.items.push(it); this.log.add('item', `${rel} sha256 ${hash} bytes ${bytes}`); this.save(); this.emit('item', it); return it;
  }
  /** Write a buffer or string as an item. */
  add(rel, data, o = {}) {
    rel = this._unique(safeRel(rel)); const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const full = path.join(this.dir, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, buf);
    return this._item(rel, sha256(buf), buf.length, o);
  }
  /** Open a file for streaming writes (long captures). The item is recorded when end() resolves. */
  stream(rel, o = {}) {
    rel = this._unique(safeRel(rel)); this.open.add(rel); const full = path.join(this.dir, rel); fs.mkdirSync(path.dirname(full), { recursive: true });
    const ws = fs.createWriteStream(full), h = crypto.createHash('sha256'); let bytes = 0, done = null;
    return {
      path: rel,
      write: d => { const b = Buffer.isBuffer(d) ? d : Buffer.from(String(d)); h.update(b); bytes += b.length; ws.write(b); },
      end: () => done || (done = new Promise((ok, no) => { ws.on('error', no); ws.end(() => { this.open.delete(rel); ok(this._item(rel, h.digest('hex'), bytes, o)); }); })),
      abort: () => new Promise(ok => {
        ws.destroy();
        ws.once('close', () => { this.open.delete(rel); fs.rmSync(full, { force: true }); ok(); });
      })
    };
  }
  warn(text) { this.m.warnings.push(text); this.log.add('warning', text); this.save(); this.emit('warning', text); }
  event(text) { this.log.add('event', text); this.save(); }
  save() { this.m.chain_head = this.log.head(); const tmp = this.mf + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.m, null, 1)); fs.renameSync(tmp, this.mf); }
  get head() { return this.log.head(); }

  /** Recompute everything in a folder. expectHead: a chain head recorded elsewhere. */
  static verify(dir, { expectHead = null } = {}) {
    const problems = []; dir = path.resolve(dir); const mf = path.join(dir, 'manifest.json');
    if (!fs.existsSync(mf)) return { ok: false, problems: ['no manifest.json in ' + dir], items: 0, head: null };
    let m; try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return { ok: false, problems: ['manifest.json is not valid JSON'], items: 0, head: null }; }
    if (m.schema !== SCHEMA) problems.push('unknown schema ' + m.schema);
    const c = Custody.verify(m.log || []); if (!c.ok) problems.push(`log chain broken at entry #${c.at} (${c.action})`);
    const last = (m.log || [])[(m.log || []).length - 1]; if ((last ? last.h : null) !== m.chain_head) problems.push('chain_head does not match the last log entry');
    if (expectHead && m.chain_head !== expectHead) problems.push(`chain head ${m.chain_head} is not the one you recorded (${expectHead})`);
    const seen = new Set(['manifest.json', 'manifest.json.tmp']);
    for (const it of m.items || []) {
      seen.add(it.path); const f = path.join(dir, it.path);
      if (!fs.existsSync(f)) { problems.push('missing: ' + it.path); continue; }
      const b = fs.readFileSync(f); if (b.length !== it.bytes) problems.push(`size changed: ${it.path}`);
      if (sha256(b) !== it.sha256) problems.push(`content changed: ${it.path}`);
      if (!(m.log || []).some(e => e.a === 'item' && e.p === `${it.path} sha256 ${it.sha256} bytes ${it.bytes}`)) problems.push(`no log entry for: ${it.path}`);
    }
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (!seen.has(r)) problems.push('not in manifest: ' + r); } };
    walk(dir);
    return { ok: !problems.length, problems, items: (m.items || []).length, head: m.chain_head, manifest: m };
  }
}
module.exports = { Acquisition, SCHEMA, safeRel, stamp };
