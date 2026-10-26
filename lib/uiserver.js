'use strict';
// `janus ui`: serves the handheld page on 127.0.0.1 and runs janus commands for it.
// It only ever spawns this same bin/janus.js with an argument list (no shell), and only the
// commands below. A random token in the page stops other websites in the browser from using it,
// and the Host check stops DNS-rebinding tricks.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn, execFile } = require('child_process');
const pkg = require('../package.json');
const collections = require('./collections');
const CLI = path.join(__dirname, '../bin/janus.js'), PAGE = path.join(__dirname, '../ui/janus.html');
const ALLOWED = new Set(['pcb', 'show', 'verify', 'pack', '--help', '--version']);

function start({ port = 7777, host = '127.0.0.1', open = true, say = console.log, cwd = process.cwd() } = {}) {
  const token = crypto.randomBytes(16).toString('hex'), runs = new Map(); let seq = 0;
  const okHost = h => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h || '');
  const json = (res, code, o) => { const b = JSON.stringify(o); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); };
  const body = req => new Promise((ok, no) => { let b = ''; req.on('data', d => { b += d; if (b.length > 65536) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(e); } }); });

  function run(args, ndjson) {
    const id = String(++seq), r = { id, args, buf: [], subs: new Set(), done: false };
    const p = spawn(process.execPath, [CLI, ...args, ...(ndjson ? ['--ndjson'] : [])], { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    r.proc = p; runs.set(id, r);
    p.on('error', err => push({ k: 'e', s: 'Unable to launch Janus: ' + err.message }));
    const push = ev => { r.buf.push(ev); if (r.buf.length > 20000) r.buf.splice(0, 5000); r.subs.forEach(s => s.write(`data: ${JSON.stringify(ev)}\n\n`)); };
    const lines = k => { let rest = ''; return d => { rest += d; let i; while ((i = rest.indexOf('\n')) >= 0) { push({ k, s: rest.slice(0, i) }); rest = rest.slice(i + 1); } }; };
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); p.stdout.on('data', lines('o')); p.stderr.on('data', lines('e'));
    p.on('close', code => { r.done = true; push({ k: 'x', code }); r.subs.forEach(s => s.end()); r.subs.clear(); setTimeout(() => runs.delete(id), 10 * 60000); });
    return r;
  }

  const srv = http.createServer(async (req, res) => {
    if (!okHost(req.headers.host)) { res.writeHead(403); return res.end('bad host'); }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const html = fs.readFileSync(PAGE, 'utf8').replace('__JANUS_TOKEN__', token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); return res.end(html);
    }
    if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    if ((req.headers['x-janus-token'] || u.searchParams.get('t')) !== token) return json(res, 401, { error: 'bad token: reload the page' });
    if (u.pathname === '/api/hello') return json(res, 200, { version: pkg.version, cwd, platform: process.platform });
    if (u.pathname === '/api/collections' && req.method === 'GET') {
      return json(res, 200, { collections: collections.list(cwd) });
    }
    if (['/api/collection', '/api/collection/text', '/api/collection/graph', '/api/collection/download'].includes(u.pathname) && req.method === 'GET') {
      const id = u.searchParams.get('id'), rel = u.searchParams.get('path');
      try {
        if (u.pathname === '/api/collection') return json(res, 200, collections.describe(cwd, id));
        if (u.pathname === '/api/collection/text') return json(res, 200, collections.text(cwd, id, rel));
        if (u.pathname === '/api/collection/graph') return json(res, 200, await collections.graph(cwd, id));
        const f = collections.file(cwd, id, rel);
        const name = path.basename(rel).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${name}"`,
          'Content-Length': f.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(f.full).pipe(res);
      } catch (err) { return json(res, err.status || 500, { error: err.status ? err.message : 'Could not read saved acquisition' }); }
    }

    if (u.pathname === '/api/run' && req.method === 'POST') {
      let b; try { b = await body(req); } catch (e) { return json(res, 400, { error: 'bad json' }); }
      const args = b.args;
      if (!Array.isArray(args) || !args.length || args.some(a => typeof a !== 'string' || a.length > 2000) || !ALLOWED.has(args[0])) return json(res, 400, { error: `not a janus command. Allowed: ${[...ALLOWED].join(' ')}` });
      return json(res, 200, { id: run(args, !!b.ndjson).id });
    }
    if (u.pathname === '/api/events') {
      const r = runs.get(u.searchParams.get('id')); if (!r) return json(res, 404, { error: 'no such run' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      r.buf.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`)); if (r.done) return res.end();
      r.subs.add(res); req.on('close', () => r.subs.delete(res)); return;
    }
    if (u.pathname === '/api/stop' && req.method === 'POST') {
      const b = await body(req).catch(() => ({})), r = runs.get(String(b.id)); if (!r) return json(res, 404, { error: 'no such run' });
      if (!r.done) stopRun(r); return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'unknown' });
  });
  const stopRun = r => {
    if (r.done || r.stopping) return;
    r.stopping = true;
    if (r.proc.connected) r.proc.send({ type: 'stop' });
    else r.proc.kill('SIGINT');
    const timeout = setTimeout(() => { if (!r.done) r.proc.kill(); }, 10000);
    timeout.unref();
  };
  const kill = () => { runs.forEach(r => { if (!r.done) stopRun(r); }); };
  process.on('exit', kill); process.on('SIGTERM', () => { kill(); setTimeout(() => process.exit(0), 300); });
  process.removeAllListeners('SIGINT'); process.on('SIGINT', () => { kill(); setTimeout(() => process.exit(0), 300); });
  return new Promise((ok, no) => {
    srv.on('error', e => no(e.code === 'EADDRINUSE' ? new Error(`port ${port} is busy. Try: janus ui --port ${port + 1}`) : e));
    srv.listen(port, host, () => {
      const url = `http://127.0.0.1:${srv.address().port}/`;
      say(`janus handheld: ${url}\nacquisition folders are written to ${cwd}\nCtrl-C to quit.`);
      if (open) { const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'; execFile(cmd, process.platform === 'win32' ? ['/c', 'start', '', url] : [url], () => {}); }
      ok({ url, token, port: srv.address().port, close: () => { kill(); srv.close(); } });
    });
  });
}
module.exports = { start };
