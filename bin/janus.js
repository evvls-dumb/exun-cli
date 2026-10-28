#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { Acquisition, stamp } = require('../lib/acq'), { sha256 } = require('../lib/custody');
const PCB = require('../lib/pi');
const pkg = require('../package.json');

const HELP = `janus ${pkg.version}  Extracting logs,temperature,voltage and current over ethernet from PCB

  janus pcb check  <host>                     test the connection and available endpoints
  janus pcb info   <host>                     PCB model, temperature, power/throttle flags
  janus pcb logs   <host> [--names a,b] [--lines N]
  janus pcb ls     <host> [folder]            list the folder the PCB exposes (nothing saved)
  janus pcb get    <host> <file>...           copy file(s)
  janus pcb fetch  <host> [folder]            copy a folder tree  [--max-files N] [--max-bytes N]
  janus pcb stream <host> [--seconds N]       record the live sensor readings
  janus pcb ssh    <user@host>                read-only commands over ssh
        [--only os-release,dmesg,...] [--get /path/file]... [--ssh-port N] [--key FILE]
  janus pcb all    <host> [--seconds 30] [--ssh user@host]
                                            info + system logs + shared files + readings
        [--no-files]                        skip the shared files folder

  janus show   <folder>                      what was collected, with hashes
  janus verify <folder> [--head HASH]        recompute every hash and the log chain
  janus pack   <folder> [file.tar.gz]        verify, then archive

  janus ui [--port 7777]                     the handheld: extraction + terminal in a browser

Options for collecting commands
  -o, --out DIR     acquisition folder (new, or an existing one to add to). Default ./janus-<kind>-<time>
  --examiner NAME   --case ID   --note TEXT   stored in manifest.json
  --ndjson          one JSON object per line on stdout (for another program); text goes to stderr
  -q, --quiet       do not echo captured lines

<host> is an address like 192.168.50.2 or janusPCB.local,optionally with :port (default 8080).
Press Ctrl-C to stop a capture; what was received so far is kept and sealed.
Exit codes: 0 ok, 1 failed or verification failed, 2 bad usage.`;

const VAL = new Set(['o', 'out', 'examiner', 'case', 'note', 'seconds', 'names', 'lines', 'max-files', 'max-bytes', 'only', 'get', 'ssh-port', 'key', 'ssh', 'head', 'port']);
const MULTI = new Set(['get']);
function parse(argv) {
  const a = { _: [], f: {} };
  for (let i = 0; i < argv.length; i++) {
    let t = argv[i];
    if (t === '-o') t = '--out'; else if (t === '-q') t = '--quiet'; else if (t === '-h') t = '--help'; else if (t === '-s') t = '--seconds';
    if (t.startsWith('--')) {
      let [k, v] = t.slice(2).split(/=(.*)/s, 2);
      if (VAL.has(k)) { if (v === undefined) { v = argv[++i]; if (v === undefined) die(2, `--${k} needs a value`); } if (MULTI.has(k)) (a.f[k] = a.f[k] || []).push(v); else a.f[k] = v; }
      else if (['ndjson', 'quiet', 'help', 'version', 'no-open', 'no-files'].includes(k)) a.f[k] = true;
      else die(2, `unknown option --${k}. Try: janus --help`);
    } else a._.push(t);
  }
  if (a.f.out === undefined && a.f.o !== undefined) a.f.out = a.f.o;
  return a;
}
function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }
const num = (v, name, d) => { if (v === undefined) return d; const n = Number(v); if (!Number.isFinite(n) || n < 0) die(2, `--${name} must be a number`); return n; };

let F = {};
const say = t => (F.ndjson ? process.stderr : process.stdout).write(t + '\n');
const emit = o => { if (F.ndjson) process.stdout.write(JSON.stringify(o) + '\n'); };
const kb = n => n < 1024 ? n + ' B' : n < 1 << 20 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

function openAcq(kind, target, a) {
  const dir = a.f.out || `janus-${kind}-${stamp()}`;
  const acq = new Acquisition(dir, { target: { kind, address: target }, examiner: a.f.examiner, case: a.f.case, note: a.f.note });
  acq.event('command: janus ' + process.argv.slice(2).join(' '));
  acq.on('item', it => { say(`  + ${it.path}  ${kb(it.bytes)}  ${it.sha256.slice(0, 12)}…`); emit({ event: 'item', ...it }); });
  acq.on('warning', w => { say(`  ! ${w}`); emit({ event: 'warning', text: w }); });
  say(`acquisition folder: ${acq.dir}`); emit({ event: 'acquisition', dir: acq.dir, target: acq.m.target });
  return acq;
}
function seal(acq, extra = {}) {
  acq.event('seal'); const v = Acquisition.verify(acq.dir);
  say(''); say(`${acq.m.items.length} items, ${acq.m.warnings.length} warnings. Log chain head:`); say('  ' + acq.head);
  say('Write that head down somewhere else. `janus verify ' + acq.dir + ' --head <it>` then proves the log was not rewritten.');
  emit({ event: 'done', dir: acq.dir, items: acq.m.items.length, warnings: acq.m.warnings.length, chain_head: acq.head, verified: v.ok, ...extra });
  return v.ok ? 0 : 1;
}
let stopper = null;
process.on('SIGINT', () => { if (stopper) { say('\nstopping…'); const s = stopper; stopper = null; s('interrupted'); } else process.exit(130); });

process.on('message', message => {
  if (message && message.type === 'stop' && stopper) {
    const s = stopper; stopper = null; say('\nstopping…'); s('requested by user');
  }
});
const echo = (quiet) => l => { emit({ event: 'line', time: l.time, line: l.line, row: l.row, cols: l.cols }); if (!quiet) say(l.line.length > 160 ? l.line.slice(0, 157) + '…' : l.line); };

async function main() {
  const a = parse(process.argv.slice(2)); F = a.f; const [cmd, sub, ...rest] = a._;
  if (a.f.version) return say(pkg.version), 0;
  if (a.f.help || !cmd || cmd === 'help') return say(HELP), 0;

  if (cmd === 'ui') { await require('../lib/uiserver').start({ port: num(a.f.port, 'port', 7777), open: !a.f['no-open'], say }); return new Promise(() => {}); }

  if (cmd === 'pcb') {
    const host = rest[0];
    if (!['check', 'info', 'logs', 'ls', 'get', 'fetch', 'stream', 'ssh', 'all'].includes(sub) || !host) die(2, 'usage: janus pcb <check|info|logs|ls|get|fetch|stream|ssh|all> <host> …   (janus --help)');
    const base = sub === 'ssh' ? null : PCB.baseUrl(host);
    if (sub === 'check') {
      const checks = await PCB.check(base);
      for (const c of checks) {
        say(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.detail}`);
        emit({ event: 'check', ...c });
      }
      return checks.some(c => c.name === 'Telemetry' && c.ok) ? 0 : 1;
    }
    if (sub === 'ls') {
      const e = await PCB.ls(base, rest[1] || ''); emit({ event: 'ls', entries: e });
      e.forEach(x => say((x.directory ? 'd ' : '- ') + x.path + (x.directory ? '/' : ''))); if (!e.length) say('(empty)'); return 0;
    }
    const acq = openAcq('raspberry-pi', host, a);
    let code = 0;
    const need = (ok, msg) => { if (!ok) { say('! ' + msg); code = 1; } };
    if (sub === 'info' || sub === 'all') { const r = await PCB.info(base, acq); say(`${r.model ? String(r.model).replace(/\0/g, '') : 'PCB'} ${r.hostname ? '(' + String(r.hostname).trim() + ')' : ''}`); r.notes.forEach(n => say('  note: ' + n)); }
    if (sub === 'logs' || sub === 'all') { const r = await PCB.logs(base, acq, { names: a.f.names ? a.f.names.split(',') : null, lines: num(a.f.lines, 'lines', 500) }); need(r.got.length, 'no logs retrieved'); }
    if (sub === 'all' && !a.f['no-files']) {
      try {
        const r = await PCB.fetchTree(base, acq, '', {
          maxFiles: num(a.f['max-files'], 'max-files', 2000),
          maxBytes: num(a.f['max-bytes'], 'max-bytes', 1 << 30)
        });
        say(`shared folder: copied ${r.files} files, ${kb(r.bytes)}`);
        if (r.truncated || r.skipped.length) code = 1;
      } catch (e) {
        acq.warn(`shared files unavailable: ${e.message}. Live telemetry and system logs can still be captured. Use --no-files to skip this step.`);
        code = 1;
      }
    }
    if (sub === 'get') { const files = rest.slice(1); if (!files.length) die(2, 'janus pcb get <host> <file>…'); for (const f of files) { try { await PCB.getFile(base, acq, f); } catch (e) { acq.warn(`${f}: ${e.message}`); code = 1; } } }
    if (sub === 'fetch') { const r = await PCB.fetchTree(base, acq, rest[1] || '', { maxFiles: num(a.f['max-files'], 'max-files', 2000), maxBytes: num(a.f['max-bytes'], 'max-bytes', 1 << 30) }); say(`copied ${r.files} files, ${kb(r.bytes)}`); if (r.truncated || r.skipped.length) code = 1; }
    if (sub === 'stream' || sub === 'all') {
      const secs = num(a.f.seconds, 'seconds', sub === 'all' ? 30 : 0);
      const s = PCB.stream(base, acq, { seconds: secs, onLine: echo(a.f.quiet) }); stopper = s.stop;
      say(`recording ${base}/stream${secs ? ' for ' + secs + ' s' : ''}. Ctrl-C to stop.`); const r = await s.done; stopper = null;
      say(`received ${r.lines} lines`); need(r.lines, 'no readings received');
    }
    if (sub === 'ssh' || (sub === 'all' && a.f.ssh)) {
      const t = sub === 'ssh' ? host : a.f.ssh;
      try { const r = await PCB.ssh(t, acq, { commands: a.f.only ? a.f.only.split(',') : undefined, files: a.f.get || [], port: a.f['ssh-port'], key: a.f.key }); need(r.done.length, 'ssh collected nothing'); if (r.failed.length) code = 1; }
      catch (e) { die(2, e.message); }
    }
    const sc = seal(acq); return code || sc;
  }

  if (cmd === 'show') {
    const dir = sub; if (!dir) die(2, 'janus show <folder>');
    const v = Acquisition.verify(dir); if (!v.manifest) { say(v.problems.join('\n')); return 1; }
    const m = v.manifest; emit({ event: 'show', manifest: m, verified: v.ok, problems: v.problems });
    say(`target     ${m.target.kind || '?'} ${m.target.address || ''}`); say(`created    ${m.created}  by ${m.tool.name} ${m.tool.version} on ${m.host.hostname} (${m.host.platform})`);
    if (m.examiner || m.case) say(`examiner   ${m.examiner || '-'}   case ${m.case || '-'}`); if (m.note) say(`note       ${m.note}`);
    say(`\n${m.items.length} items`); m.items.forEach(i => say(`  ${i.sha256.slice(0, 16)}…  ${kb(i.bytes).padStart(9)}  ${i.path}${i.derived_from ? '   (from ' + i.derived_from + ')' : ''}`));
    if (m.warnings.length) { say('\nwarnings'); m.warnings.forEach(w => say('  ! ' + w)); }
    say(`\nlog chain head  ${m.chain_head}`); say(v.ok ? 'verification: OK, every file and the log match' : 'verification: FAILED\n  ' + v.problems.join('\n  ')); return v.ok ? 0 : 1;
  }

  if (cmd === 'verify') {
    if (!sub) die(2, 'janus verify <folder> [--head HASH]');
    const v = Acquisition.verify(sub, { expectHead: a.f.head || null }); emit({ event: 'verify', ok: v.ok, problems: v.problems, items: v.items, chain_head: v.head });
    if (v.ok) say(`OK: ${v.items} items and the log chain verify.` + (a.f.head ? ' The chain head matches the one you gave.' : ' (No --head given: this cannot detect a log rewritten as a whole.)'));
    else { say('FAILED'); v.problems.forEach(p => say('  ' + p)); } return v.ok ? 0 : 1;
  }

  if (cmd === 'pack') {
    if (!sub) die(2, 'janus pack <folder> [file.tar.gz]');
    const v = Acquisition.verify(sub); if (!v.ok) { say('Refusing to pack: verification failed.'); v.problems.forEach(p => say('  ' + p)); return 1; }
    const dir = path.resolve(sub), out = path.resolve(rest[0] || dir + '.tar.gz'); if (fs.existsSync(out)) die(1, out + ' already exists');
    const r = spawnSync('tar', ['-czf', out, '-C', path.dirname(dir), path.basename(dir)], { encoding: 'utf8' }); if (r.status) die(1, 'tar failed: ' + r.stderr);
    const h = sha256(fs.readFileSync(out)); fs.writeFileSync(out + '.sha256', `${h}  ${path.basename(out)}\n`);
    say(`${out}\nsha256 ${h}  (also in ${path.basename(out)}.sha256)`); emit({ event: 'pack', file: out, sha256: h, chain_head: v.head }); return 0;
  }
  die(2, `unknown command "${cmd}". Try: janus --help`);
}
main().then(c => process.exit(c || 0), e => { process.stderr.write('error: ' + e.message + '\n'); process.exit(1); });
