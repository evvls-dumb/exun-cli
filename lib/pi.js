'use strict';
// Getting data off a Raspberry Pi. Two routes, both read-only:
//   1. HTTP: the janus_probe.py script on the Pi (Ethernet/USB-gadget/Wi-Fi). Streams readings, serves
//      diagnostics, allowlisted logs and, if the Pi owner turned it on, a read-only folder.
//   2. SSH:  a fixed list of read-only commands, or `cat` of named files. janus never runs anything else.
// Everything received is saved as received and hashed. Nothing is written to the Pi.
const http = require('http'), https = require('https'), path = require('path'), { spawn } = require('child_process');
const { StreamRecorder } = require('./stream');
const mod = u => u.protocol === 'https:' ? https : http;

function baseUrl(host) {
  let h = String(host).trim(); if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
  const u = new URL(h); if (!u.port && u.protocol === 'http:') u.port = '8080';
  return u.origin;
}
function request(url, { timeout = 15000, onResponse } = {}) {
  return new Promise((ok, no) => {
    const u = new URL(url);
    const req = mod(u).get(u, { timeout }, res => onResponse(res, ok, no));
    req.on('timeout', () => req.destroy(new Error(`timed out talking to ${u.host}`)));
    req.on('error', e => no(e.code === 'ECONNREFUSED' ? new Error(`${u.host} refused the connection. Is janus_probe.py running on the Pi (with --http)?`) : e));
  });
}
/** GET into memory (small things: JSON). */
const getBuf = (url, o) => request(url, { ...o, onResponse: (res, ok, no) => {
  const c = []; res.on('data', d => c.push(d)); res.on('error', no);
  res.on('end', () => res.statusCode === 200 ? ok({ buf: Buffer.concat(c), headers: res.headers }) : no(new Error(`HTTP ${res.statusCode} for ${new URL(url).pathname}${res.statusCode === 404 ? ' (is that feature switched on on the Pi?)' : ''}`)));
} });
/** GET straight into the acquisition (any size), hashing as it goes. */
const getItem = (url, acq, rel, itemOpts, { maxBytes = Infinity, ...options } = {}) =>
  request(url, { ...options, timeout: 30000, onResponse: (res, ok, no) => {
    if (res.statusCode !== 200) {
      res.resume();
      return no(new Error(`HTTP ${res.statusCode} for ${new URL(url).pathname}`));
    }
    const contentLength = Number(res.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      res.resume();
      return no(new Error(`file is ${contentLength} bytes, exceeding the ${maxBytes} byte collection limit`));
    }
    const writer = acq.stream(rel, itemOpts);
    let received = 0, finished = false;
    const fail = async error => {
      if (finished) return;
      finished = true;
      res.destroy();
      try { await writer.abort(); } catch {}
      no(error);
    };
    res.on('data', chunk => {
      if (finished) return;
      received += chunk.length;
      if (received > maxBytes) return void fail(new Error(`file exceeds the ${maxBytes} byte collection limit`));
      writer.write(chunk);
    });
    res.on('error', error => fail(error));
    res.on('end', async () => {
      if (finished) return;
      finished = true;
      try {
        const item = await writer.end();
        if (Number.isFinite(contentLength) && item.bytes !== contentLength) {
          acq.warn(`${item.path}: received ${item.bytes} bytes but the Pi announced ${contentLength}`);
        }
        ok(item);
      } catch (error) { no(error); }
    });
  } });

/** Follow Server-Sent Events. Returns { close() }. onLine gets each data line. */
function sse(url, { onLine, onEnd = () => {}, onError = () => {} }) {
  const u = new URL(url); let ended = false;
  const req = mod(u).get(u, { headers: { Accept: 'text/event-stream' } }, res => {
    if (res.statusCode !== 200) { res.resume(); return onError(new Error('HTTP ' + res.statusCode)); }
    let b = ''; res.setEncoding('utf8');
    res.on('data', d => { b += d; let i; while ((i = b.indexOf('\n\n')) >= 0) { const ev = b.slice(0, i); b = b.slice(i + 2); ev.split('\n').forEach(l => { if (l.startsWith('data:')) onLine(l.slice(5).trim()); }); } });
    res.on('end', () => { if (!ended) { ended = true; onEnd(); } }); res.on('aborted', () => { if (!ended) { ended = true; onEnd(); } });
  });
  req.on('error', e => { if (!ended) { ended = true; onError(e); } });
  return { close: () => { ended = true; req.destroy(); } };
}

/** Check reachability without writing an acquisition or altering the Pi. */
async function check(base) {
  const specs = [
    ['Telemetry', '/metrics', j => {
      const t = j.cpu_temperature_c;
      return `Pi ${String(j.hostname || 'unknown').trim()}, CPU ${typeof t === 'number' ? t.toFixed(1) + '°C' : 'N/A'}`;
    }],
    ['System logs', '/logs/list', j => `${(j.available || []).length} readable log files; journal depends on permissions`],
    ['Shared files', '/files?path=', j => `${Array.isArray(j) ? j.length : 0} entries in exposed folder`]
  ];
  return Promise.all(specs.map(async ([name, route, format]) => {
    try {
      const response = await getBuf(base + route, { timeout: 5000 });
      const json = JSON.parse(response.buf.toString('utf8'));
      return { name, ok: true, detail: format(json) };
    } catch (err) { return { name, ok: false, detail: err.message }; }
  }));
}

// vcgencmd get_throttled: bits 0-3 now, bits 16-19 have happened since boot.
const THROTTLE = [[0, 'under-voltage right now'], [1, 'ARM frequency capped right now'], [2, 'throttled right now'], [3, 'soft temperature limit active right now'],
  [16, 'under-voltage has occurred since boot'], [17, 'frequency cap has occurred since boot'], [18, 'throttling has occurred since boot'], [19, 'soft temperature limit has occurred since boot']];
function decodeThrottled(raw) {
  const m = /0x([0-9a-f]+)/i.exec(raw || ''); if (!m) return null;
  const v = parseInt(m[1], 16); return { value: '0x' + v.toString(16), flags: THROTTLE.filter(([b]) => v & (1 << b)).map(x => x[1]) };
}

async function info(base, acq) {
  const out = { notes: [] };
  const m = await getBuf(base + '/metrics'); const mi = acq.add('pi/metrics.json', m.buf, { kind: 'pi-diagnostics', source: base + '/metrics', note: 'as reported by the Pi script; values the Pi could not read are null or absent' });
  out.metrics = mi;
  try {
    const j = JSON.parse(m.buf.toString('utf8')); out.model = j.model; out.hostname = j.hostname;
    const t = decodeThrottled(j.throttled_raw);
    if (t && t.flags.length) { out.throttled = t; acq.warn(`Pi reports get_throttled=${t.value}: ${t.flags.join('; ')}. (This is what the Pi says about itself.)`); }
    else if (t) out.throttled = t;
    else if (!j.throttled_raw) out.notes.push('The Pi did not return get_throttled (vcgencmd missing or not permitted).');
  } catch (e) { acq.warn('metrics reply was not valid JSON'); }
  try { const l = await getBuf(base + '/logs/list'); out.logList = acq.add('pi/logs/list.json', l.buf, { kind: 'pi-log-list', source: base + '/logs/list' }); } catch (e) { out.notes.push('log list: ' + e.message); }
  return out;
}

async function logs(base, acq, { names = null, lines = 500 } = {}) {
  let list = names;
  if (!list) {
    try { const j = JSON.parse((await getBuf(base + '/logs/list')).buf.toString('utf8')); list = ['journal', ...(j.available || [])]; } catch (e) { list = ['journal']; }
  }
  const got = [], failed = [];
  for (const n of list) {
    const url = `${base}/logs?name=${encodeURIComponent(n)}&lines=${lines}`;
    try {
      const r = await getBuf(url); const raw = acq.add(`pi/logs/${n}.json`, r.buf, { kind: 'pi-log-raw', source: url });
      let text = null; try { const j = JSON.parse(r.buf.toString('utf8')); text = j.text; if (j.error) acq.warn(`log "${n}": ${j.error}`); } catch (e) {}
      if (text != null) acq.add(`pi/logs/${n}.txt`, text, { kind: 'pi-log-text', source: url, derivedFrom: raw.path, note: `last ${lines} lines at most (the Pi caps this at 500)` });
      got.push(n);
    } catch (e) { failed.push(`${n}: ${e.message}`); acq.warn(`log "${n}" not retrieved: ${e.message}`); }
  }
  return { got, failed };
}

async function ls(base, remote = '') {
  const r = await getBuf(`${base}/files?path=${encodeURIComponent(remote)}`);
  try { return JSON.parse(r.buf.toString('utf8')); } catch (e) { throw new Error(`${remote || '/'} is a file, or the reply was not a listing`); }
}
async function getFile(base, acq, remote, { maxBytes = Infinity } = {}) {
  const clean = remote.replace(/^\/+/, '');
  return getItem(`${base}/files?path=${encodeURIComponent(clean)}`, acq, `pi/files/${clean}`, { kind: 'pi-file', source: `${base}/files?path=${clean}` }, { maxBytes });
}
/** Copy a folder tree. Stops, and says so, at limits. */
async function fetchTree(base, acq, remote = '', { maxFiles = 2000, maxBytes = 1 << 30, maxDepth = 8, onFile = () => {} } = {}) {
  let files = 0, bytes = 0, skipped = [], truncated = false;
  async function walk(dir, depth) {
    if (truncated) return;
    if (depth > maxDepth) { skipped.push(dir + ' (deeper than ' + maxDepth + ')'); return; }
    let entries; try { entries = await ls(base, dir); } catch (e) { skipped.push(`${dir || '/'} (${e.message})`); return; }
    for (const e of entries) {
      if (truncated) return;
      if (e.directory) { await walk(e.path, depth + 1); continue; }
      if (files >= maxFiles || bytes >= maxBytes) { truncated = true; return; }
      try { const it = await getFile(base, acq, e.path, { maxBytes: maxBytes - bytes }); files++; bytes += it.bytes; onFile(it); } catch (er) { skipped.push(`${e.path} (${er.message})`); }
    }
  }
  const asFile = remote && await ls(base, remote).then(() => false, () => true);
  if (asFile) { const it = await getFile(base, acq, remote, { maxBytes }); return { files: 1, bytes: it.bytes, skipped, truncated: false }; }
  await walk(remote.replace(/^\/+|\/+$/g, ''), 0);
  if (truncated) acq.warn(`fetch stopped at the limit (${files} files, ${bytes} bytes). The copy is incomplete.`);
  skipped.forEach(s => acq.warn('not copied: ' + s));
  return { files, bytes, skipped, truncated };
}

/** Record the Pi's /stream. Reconnects if the connection drops, and notes the gap. */
function stream(base, acq, { seconds = 0, name = 'pi-stream', onLine = () => {}, reconnect = 5 } = {}) {
  const rec = new StreamRecorder(acq, { name, source: base + '/stream' }); rec.on('line', onLine);
  let h = null, timer = null, stopped = false, tries = 0, finish, first = true, lastErr = null;
  const done = new Promise(r => { finish = r; });
  const connect = () => {
    if (stopped) return;
    acq.event(first ? 'stream connect ' + base + '/stream' : 'stream reconnect'); first = false;
    h = sse(base + '/stream', {
      onLine: l => { tries = 0; rec.line(l); },
      onEnd: () => retry('the Pi closed the stream'), onError: e => { lastErr = e; retry(e.message); }
    });
  };
  const retry = why => {
    if (stopped) return; h && h.close();
    if (++tries > reconnect) { acq.warn(`stream lost (${why}); gave up after ${reconnect} reconnect attempts`); return stop('lost'); }
    acq.warn(`stream interrupted (${why}); reconnecting (${tries}/${reconnect}). Readings are missing for that time.`); setTimeout(connect, 1000 * tries);
  };
  const stop = async (why = 'stopped') => {
    if (stopped) return done; stopped = true; clearTimeout(timer); h && h.close(); acq.event(`stream end (${why})`);
    const r = await rec.end(); if (!rec.lines) acq.warn(`No data came from ${base}/stream.${lastErr ? ' Last error: ' + lastErr.message : ''}`);
    finish({ ...r, error: !rec.lines && lastErr ? lastErr.message : null }); return done;
  };
  connect(); if (seconds > 0) timer = setTimeout(() => stop('time limit'), seconds * 1000);
  return { done, stop, mark: l => rec.mark(l) };
}

// ---- SSH: fixed, read-only commands. Each is a literal string; the user can only choose which ones. ----
const SSH_COMMANDS = {
  'os-release': 'cat /etc/os-release', 'uname': 'uname -a', 'uptime': 'uptime; who -b',
  'cpuinfo': 'cat /proc/cpuinfo', 'model': 'tr -d "\\0" < /proc/device-tree/model; echo',
  'power': 'vcgencmd get_throttled; vcgencmd measure_temp; vcgencmd measure_volts; vcgencmd pmic_read_adc',
  'dmesg': 'dmesg 2>&1', 'journal': 'journalctl --no-pager -n 3000 --output=short-iso 2>&1', 'boots': 'journalctl --list-boots --no-pager 2>&1',
  'last-logins': 'last -x -F 2>&1 | head -300', 'config': 'cat /boot/firmware/config.txt /boot/config.txt 2>/dev/null',
  'disks': 'lsblk -a -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL; echo; df -h; echo; cat /proc/mounts', 'usb': 'lsusb 2>&1',
  'network': 'ip -s addr; echo; ip route', 'processes': 'ps auxww', 'services': 'systemctl list-units --no-pager --type=service --state=running 2>&1'
};
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
function runSsh(target, command, { timeout = 60000, port = null, key = null } = {}) {
  const bin = process.env.JANUS_SSH || 'ssh';
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'LogLevel=ERROR'];
  if (port) args.push('-p', String(port)); if (key) args.push('-i', key);
  args.push('--', target, command);
  return new Promise(ok => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); const out = [], err = []; let killed = false;
    const t = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, timeout);
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
    p.on('error', e => { clearTimeout(t); ok({ code: 127, out: Buffer.alloc(0), err: Buffer.from(e.code === 'ENOENT' ? 'ssh is not installed on this computer' : e.message), killed }); });
    p.on('close', code => { clearTimeout(t); ok({ code, out: Buffer.concat(out), err: Buffer.concat(err), killed }); });
  });
}
async function ssh(target, acq, { commands = Object.keys(SSH_COMMANDS), files = [], port = null, key = null } = {}) {
  const bad = commands.filter(c => !SSH_COMMANDS[c]); if (bad.length) throw new Error(`unknown ssh command "${bad[0]}". Choose from: ${Object.keys(SSH_COMMANDS).join(', ')}`);
  acq.event(`ssh to ${target}. Note: connecting adds entries to the Pi's auth log and login history. Those are caused by this collection.`);
  const done = [], failed = [];
  const one = async (rel, cmd, kind) => {
    const r = await runSsh(target, cmd, { port, key });
    if (r.code === 255 || r.code === 127 || (r.killed)) { const why = r.killed ? 'timed out' : (r.err.toString().trim() || 'ssh failed'); failed.push(`${rel}: ${why}`); acq.warn(`ssh ${rel}: ${why}`); return r.code; }
    acq.add(rel, r.out, { kind, source: `ssh ${target}: ${cmd}`, note: r.code ? `command exited ${r.code}` + (r.err.length ? '; stderr: ' + r.err.toString().trim().slice(0, 300) : '') : null });
    if (r.code) acq.warn(`ssh ${rel}: command exited ${r.code}${r.err.length ? ' (' + r.err.toString().trim().slice(0, 200) + ')' : ''}. Output saved as received.`);
    done.push(rel); return r.code;
  };
  for (const c of commands) {
    const code = await one(`pi/ssh/${c}.txt`, SSH_COMMANDS[c], 'ssh-command');
    if (code === 255 || code === 127) { acq.warn('ssh could not connect; skipping the remaining commands'); break; }
  }
  for (const f of files) {
    if (/[\0\n]/.test(f)) { failed.push(f + ': bad path'); continue; }
    const rel = 'pi/ssh-files/' + f.replace(/^\/+/, '');
    await one(rel, `cat -- ${shq(f)}`, 'ssh-file');
  }
  return { done, failed };
}
module.exports = { baseUrl, check, info, logs, ls, getFile, fetchTree, stream, ssh, SSH_COMMANDS, decodeThrottled, getBuf };
