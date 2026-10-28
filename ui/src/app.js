'use strict';
//   state that survives a reload
const ST = (() => { const d = { last: null, lastHead: null, lastItems: 0, lastWarn: 0, hosts: ['192.168.50.2', 'januspi.local', 'raspberrypi.local'], host: '192.168.50.2', logins: ['arnav@192.168.50.2', 'pi@raspberrypi.local'], login: 'arnav@192.168.50.2', hist: [] };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('janus.st') || '{}')); } catch (e) { return d; } })();
const saveSt = () => { try { localStorage.setItem('janus.st', JSON.stringify({ ...ST, hist: ST.hist.slice(-60) })); } catch (e) {} };
let LINK = LIVE ? 'wait' : 'offline';

//   screen stack
let scr = null; const stack = [];
const go = s => { if (scr) stack.push(scr); scr = s; s.enter && s.enter(); syncTerm(); };
const swap = s => { scr = s; s.enter && s.enter(); syncTerm(); };
const back = () => { const p = stack.pop(); if (p) { scr = p; p.resume && p.resume(); SFX.back(); syncTerm(); } };
const home = () => { stack.length = 0; scr = Menu; Menu.enter(); syncTerm(); };
onKey = k => scr && scr.key && scr.key(k);
onType = e => !!(scr && scr.type && scr.type(e));
let toastS = '', toastT = 0; const toast = s => { toastS = s; toastT = performance.now() + 2200; };
const blink = (t, ms = 520) => ((t / ms) | 0) % 2 === 0;
const spin = t => '|/-\\'[((t / 120) | 0) % 4];

function bar(title, right, t) { rect(0, 0, W, 11, 3); text(4, 2, title, 0, 'b'); if (right) textR(156, 3, right, 0); }
function foot(s) { rect(0, 137, W, 7, 1); text(3, 138, s, 3); }
function dot(x, y, c) { rect(x + 1, y, 3, 5, c); rect(x, y + 1, 5, 3, c); }
const fmtN = (v, d) => v == null || !Number.isFinite(v) ? null : v.toFixed(d);
const q = a => /[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
const cmdline = args => 'janus ' + args.map(q).join(' ');

const IC = {
  plug: ['...33....33.....', '...33....33.....', '...33....33.....', '.333333333333...', '.322222222223...', '.321111111123...', '.322222222223...', '..3222222223....', '...32222223.....', '....333333......', '......33........', '......33........', '......33...333..', '.......33.3...3.', '........33.....3', '...............3'],
  term: ['3333333333333333', '3222222222222223', '3333333333333333', '3000000000000003', '3030000000000003', '3003000000000003', '3000300000000003', '3003000000000003', '3030003333000003', '3000000000000003', '3000000000000003', '3333333333333333', '.....333333.....', '...3333333333...'],
};
const inv = [3, 2, 1, 0];

//   boot
function syncTerm() { if (typeof Term !== 'undefined') Term.visible(scr === Term); }

const Boot = {
  enter() { this.t0 = performance.now(); this.rang = false; },
  key() { home(); },
  draw(t) {
    const e = t - this.t0; cls(0);
    const y = Math.min(52, -16 + Math.floor(e / 14));
    text(40, y, 'JANUS', 3, 'b', 2);
    if (y >= 52) { if (!this.rang) { this.rang = true; SFX.boot(); } if (e > 1300) textC(74, 'FIELD UNIT  JN-1', 2); if (e > 1600) textC(84, 'HANDHELD DEVICE', 2); }
    if (e > 2300) home();
  },
};

//   main menu
const Menu = {
  sel: 0,
  items: [
    { name: 'EXTRACT', icon: 'plug', d: ['READINGS, LOGS AND TELEMETRY', 'ARCADE PCB OVER ETHERNET'], open: () => go(Setup) },
    { name: 'TERMINAL', icon: 'term', d: ['COMMAND LINE','HANDHELD CLI'], open: () => go(Term) },
  ],
  enter() {}, resume() {},
  key(k) {
    if (k === 'up' || k === 'down') { this.sel = (this.sel + (k === 'down' ? 1 : 2)) % 3; SFX.move(); }
    else if (k === 'a' || k === 'start') { SFX.ok(); if (this.sel === 2) go(CollectionList); else this.items[this.sel].open(); }
    else if (k === 'select') { SFX.ok(); go(Options); }
  },
  draw(t) {
    cls(0); rect(0, 0, W, 17, 3); text(5, 5, 'JANUS', 0, 'b'); text(50, 7, 'FIELD UNIT', 1);
    if (LINK === 'offline') { if (blink(t, 700)) { win(122, 3, 34, 11, 0, 0); text(127, 6, 'OFFLINE', 3); } }
    else if (LINK === 'ok') { text(118, 7, 'LINKED', 1); dot(150, 7, 0); }
    else if (LINK === 'lost') { if (blink(t)) text(118, 7, 'NOT LINKED', 0); }
    this.items.forEach((it, i) => {
      const y = 22 + i * 40, on = this.sel === i, bg = on ? 3 : 0, fg = on ? 0 : 3;
      win(4, y, 152, 36, bg, on ? 3 : 2);
      icon(12, y + 10, IC[it.icon], on ? inv : null);
      text(34, y + 7, it.name, fg, 'b'); text(34, y + 19, it.d[0], on ? 1 : 2); text(34, y + 26, it.d[1], on ? 1 : 2);
      if (on && blink(t)) text(148, y + 15, '◄', 0);
    });
    const hc = this.sel === 2;
    win(4, 103, 152, 16, hc ? 3 : 0, 3);
    text(11, 108, 'COLLECTION HISTORY', hc ? 0 : 3, 's');
    textR(150, 108, 'A OPEN', hc ? 0 : 2);
    if (ST.last) { text(4, 123, 'LAST', 2); text(24, 123, clip(ST.last.split(/[\\/]/).pop(), 33), 3); }
    else text(4, 123, 'COLLECTIONS ARE SAVED ON UNIT', 2);
    if (LINK === 'offline') text(4, 130, 'START LOCAL SERVER FIRST', 2);
    foot('A OPEN   SELECT OPTIONS');
  },
};

//   forms (setup and options use same)
function drawForm(rows, sel, top, t) {
  rows.forEach((r, i) => {
    const y = top + i * 10, on = i === sel;
    if (r.button) { const w = tw(r.label) + 16, x = (W - w) >> 1; win(x, y - 2, w, 10, on ? 3 : 0, 3); text(x + 8, y, r.label, on ? 0 : 3); if (on && blink(t)) text(x + 2, y, '►', 0); return; }
    if (on) { rect(2, y - 2, 156, 9, 1); text(4, y, '►', 3); }
    text(10, y, r.label, on ? 3 : 2);
    const v = clip(r.value(), on ? 21 : 23); if (on && r.opts) { text(54, y, '◄', 3); text(60, y, v, 3); text(60 + tw(v) + 2, y, '►', 3); } else text(60, y, v, 3);
  });
}
function formKey(f, k) {
  const rows = f.rows(), r = rows[f.sel];
  if (k === 'up') { f.sel = (f.sel + rows.length - 1) % rows.length; SFX.move(); }
  else if (k === 'down') { f.sel = (f.sel + 1) % rows.length; SFX.move(); }
  else if ((k === 'left' || k === 'right') && r.opts) { r.step(k === 'left' ? -1 : 1); SFX.move(); }
  else if (k === 'a' || k === 'start') { if (r.act) { r.act(); } else if (r.opts) { r.step(1); SFX.move(); } }
  else if (k === 'b') back();
  f.sel = Math.min(f.sel, f.rows().length - 1);
}
const cyc = (list, cur, d) => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length];

//   EXTRACT: set up
const TIMES = [[30, '30 S'], [60, '1 MIN'], [120, '2 MIN'], [300, '5 MIN'], [600, '10 MIN'], [1800, '30 MIN'], [0, 'UNTIL STOPPED']];
const GETS = [['stream', 'LIVE READINGS'], ['info', 'INFO + LOGS'], ['all', 'EXTRACTION FROM PCB'], ['files', 'LOGS FROM ARCADE PCB'], ['ssh', 'SSH COMMANDS']];
const Setup = {
  sel: 0, secs: 60, get: 'stream', folder: 'new',
  enter() { this.sel = 0; }, resume() {},
  rows() {
    const ssh = this.get === 'ssh';
    const R = [
      { label: 'SOURCE', value: () => 'ARCADE PCB' },
      ssh
        ? { label: 'LOGIN', value: () => ST.login, opts: 1, step: d => { ST.login = cyc(ST.logins, ST.login, d); }, act: () => { SFX.ok(); KB.open('SSH LOGIN  USER@HOST', ST.login, v => { v = v.trim(); if (v) { ST.login = v; if (!ST.logins.includes(v)) ST.logins.unshift(v); saveSt(); } }); } }
        : { label: 'HOST', value: () => ST.host, opts: 1, step: d => { ST.host = cyc(ST.hosts, ST.host, d); }, act: () => { SFX.ok(); KB.open('PI ADDRESS[:PORT]', ST.host, v => { v = v.trim(); if (v) { ST.host = v; if (!ST.hosts.includes(v)) ST.hosts.unshift(v); ST.hosts = ST.hosts.slice(0, 6); saveSt(); } }); } },
      { label: 'GET', value: () => GETS.find(g => g[0] === this.get)[1], opts: 1, step: d => { this.get = cyc(GETS.map(g => g[0]), this.get, d); } }
    ];
    if (this.get === 'stream' || this.get === 'all') R.push(this.timeRow());
    R.push({ label: 'FOLDER', value: () => this.folder === 'new' || !ST.last ? 'NEW' : 'ADD TO LAST', opts: 1, step: () => { this.folder = this.folder === 'new' && ST.last ? 'last' : 'new'; } });
    R.push({ button: 1, label: 'START', act: () => this.start() });
    return R;
  },
  timeRow() { return { label: 'TIME', value: () => TIMES.find(x => x[0] === this.secs)[1], opts: 1, step: d => { this.secs = cyc(TIMES.map(x => x[0]), this.secs, d); } }; },
  cmds() {
    const o = this.folder === 'last' && ST.last ? ['-o', ST.last] : [], s = this.secs ? ['--seconds', String(this.secs)] : [];
    const h = ST.host;
    return { stream: [['pcb', 'stream', h, ...s, ...o, '-q']], info: [['pcb', 'info', h, ...o], ['pcb', 'logs', h, '-o', '$DIR']], all: [['pcb', 'all', h, '--seconds', String(this.secs || 0), ...o, '-q']], files: [['pcb', 'fetch', h, ...o]], ssh: [['pcb', 'ssh', ST.login, ...o]] }[this.get];
  },
  start() {
    SFX.ok(); saveSt(); go(Run.make(this.cmds(), 'PI', ['info', 'files', 'ssh'].includes(this.get) ? 0 : this.secs));
  },
  key(k) { formKey(this, k); },
  draw(t) {
    cls(0); bar('EXTRACT', LINK === 'offline' ? 'OFFLINE' : 'HTTP/SSH');
    drawForm(this.rows(), this.sel, 17, t);
    win(3, 95, 154, 40, 0, 2); text(7, 98, 'SAME AS TYPING:', 2);
    const c = this.cmds().map(cmdline).join(' && ').replace('$DIR', '<same>');
    wrap(c, 36).slice(0, 4).forEach((l, i) => text(7, 105 + i * 7, l, 3));
    foot('◄► CHANGE   A EDIT/GO   B BACK');
  },
};

//   EXTRACT: running
const Run = {
  make(cmds, label, secs) { const r = Object.create(Run.proto); Object.assign(r, { cmds, label, secs, idx: 0, dir: null, items: [], warns: [], cols: null, row: null, series: [], raw: [], lines: 0, err: [], doneEv: null, code: null, view: null, picked: false, confirm: false, h: null }); return r; },
  proto: {
    enter() { this.t0 = performance.now(); this.next(); },
    next() {
      const args = this.cmds[this.idx].map(a => a === '$DIR' ? this.dir : a);
      this.h = run(args, { ndjson: true, on: ev => this.on(ev) });
    },
    on(ev) {
      if (ev.k === 'e') { if (ev.s.trim()) { this.err.push(ev.s); if (this.err.length > 60) this.err.shift(); } return; }
      if (ev.k === 'x') { this.code = ev.code; if (ev.code === 0 && this.idx < this.cmds.length - 1) { this.idx++; this.doneEv = null; return this.next(); } return this.finish(); }
      let j; try { j = JSON.parse(ev.s); } catch (e) { return; }
      if (j.event === 'acquisition') this.dir = j.dir;
      else if (j.event === 'item') this.items.push(j);
      else if (j.event === 'warning') { this.warns.push(j.text); SFX.tick(); }
      else if (j.event === 'done') this.doneEv = j;
      else if (j.event === 'line') {
        this.lines++; blip(); this.raw.push(j.line); if (this.raw.length > 200) this.raw.shift();
        if (j.row && j.cols) { this.cols = j.cols; this.row = j.row.map(v => v == null ? NaN : v); const k = this.gi(); if (k >= 0) { this.series.push(this.row[k]); if (this.series.length > 146) this.series.shift(); } if (!this.picked) this.view = 'gauge'; }
        else if (!this.picked && !this.cols && this.lines > 3) this.view = 'raw';
      }
    },
    idx2(names) { if (!this.cols) return -1; const lc = this.cols.map(c => c.toLowerCase()); for (const n of names) { const i = lc.indexOf(n); if (i >= 0) return i; } return -1; },
    vi() { return this.idx2(['v', 'volts', 'voltage', 'vin']); }, ii() { return this.idx2(['i_a', 'i', 'amps', 'current', 'a']); },
    gi() {
      if (!this.cols || !this.row) return -1;
      const order = [this.ii(), this.vi(), ...this.cols.map((_, i) => i).filter(i => i > 0)];
      const chosen = order.find(i => i > 0 && Number.isFinite(this.row[i]));
      const index = chosen === undefined ? -1 : chosen;
      if (this.graphIndex !== index) { this.graphIndex = index; this.series = []; }
      return index;
    },
    finish() {
      if (this.doneEv) { ST.last = this.doneEv.dir; ST.lastHead = this.doneEv.chain_head; ST.lastItems = this.doneEv.items; ST.lastWarn = this.doneEv.warnings; saveSt(); this.code === 0 ? SFX.seal() : SFX.err(); swap(Done.make(this)); }
      else { SFX.err(); swap(Fail.make(this)); }
    },
    views() { return [this.cols && 'gauge', this.lines && 'raw', 'items'].filter(Boolean); },
    key(k) {
      if (this.confirm) { if (k === 'a') { this.confirm = false; this.stopping = true; this.h && this.h.stop(); SFX.ok(); } else if (k === 'b') { this.confirm = false; SFX.back(); } return; }
      if (k === 'b' || k === 'start') { if (!this.stopping) { this.confirm = true; SFX.move(); } }
      else if (k === 'left' || k === 'right') { const v = this.views(); this.view = cyc(v, this.view || v[0], k === 'left' ? -1 : 1); this.picked = true; SFX.move(); }
    },
    draw(t) {
      cls(0); rect(0, 0, W, 11, 3);
      const el = (t - this.t0) / 1000, mm = String((el / 60) | 0).padStart(2, '0'), ss = String((el | 0) % 60).padStart(2, '0');
      if (this.stopping) text(4, 3, 'SEALING ' + spin(t), 0);
      else { if (blink(t, 400)) dot(4, 3, 0); text(12, 3, `REC ${mm}:${ss}`, 0); }
      textR(156, 3, this.label + (this.cmds.length > 1 ? ` ${this.idx + 1}/${this.cmds.length}` : ''), 0);
      const v = this.view || (this.dir ? this.views()[0] : null);
      if (!this.dir) {
        textC(52, 'CONNECTING ' + spin(t), 3);
        const last = this.err[this.err.length - 1]; if (last) wrap(last.trim(), 38).slice(0, 4).forEach((l, i) => text(4, 66 + i * 7, l, 2));
      } else if (v === 'gauge') this.gauge(t); else if (v === 'raw') this.rawv(); else this.itemsv(t);
      if (this.secs && !this.stopping && this.dir) { const p = Math.min(1, el / this.secs); box(3, 131, 154, 4, 2); rect(4, 132, Math.round(152 * p), 2, 3); }
      foot(`B STOP   ◄► ${(v || 'items').toUpperCase()}   ${this.lines} LINES`);
      if (this.confirm) { win(14, 46, 132, 44, 0, 3); textC(52, 'STOP AND SEAL?', 3, 'b'); textC(64, 'WHAT ARRIVED IS KEPT', 2); textC(71, 'AND HASHED.', 2); textC(81, 'A  YES        B  NO', 3); }
    },
    gauge(t) {
      const r = this.row || [], vi = this.vi(), ii = this.ii();
      const slot = (y, label, unit, idx, d) => {
        const val = idx >= 0 ? fmtN(r[idx], d) : null; text(4, y + 2, label, 2);
        if (val == null) { text(4, y + 9, idx >= 0 ? 'NOT MEASURED' : 'NO SUCH COLUMN', 2); textR(148, y, '--', 2, 'b', 2); }
        else { textR(146, y, val, 3, 'b', 2); text(149, y + 9, unit, 3); }
      };
      if (vi >= 0 || ii >= 0) { slot(15, 'VOLTS', 'V', vi, 2); slot(35, 'AMPS', 'A', ii, 3); }
      else { const a = this.cols[1], b = this.cols[2]; slot(15, clip((a || '').toUpperCase(), 9), '', a ? 1 : -1, 2); slot(35, clip((b || '').toUpperCase(), 9), '', b ? 2 : -1, 2); }
      // chart 
      box(3, 55, 154, 36, 2); const gi = this.gi(), name = gi >= 0 ? this.cols[gi].toUpperCase() : '';
      const S2 = this.series.filter(Number.isFinite);
      if (S2.length > 1) {
        let lo = Math.min(...S2), hi = Math.max(...S2); if (hi - lo < 0.1) { const m = (hi + lo) / 2; lo = m - 0.05; hi = m + 0.05; }
        const Y = v => 89 - Math.round((v - lo) / (hi - lo) * 30), x0 = 156 - this.series.length;
        let prev = null; this.series.forEach((v, i) => { const x = x0 + i; if (!Number.isFinite(v)) { prev = null; return; } const y = Y(v); for (let yy = y + 1; yy < 90; yy++) if ((x + yy) & 1) px(x, yy, 1); if (prev) line(prev[0], prev[1], x, y, 3); else px(x, y, 3); prev = [x, y]; });
        rect(4, 56, tw(name) + 2, 7, 0); text(5, 57, name, 2); const rg = lo.toFixed(2) + '-' + hi.toFixed(2); rect(4, 83, tw(rg) + 2, 7, 0); text(5, 84, rg, 2);
      } else text(5, 57, name ? name + ': WAITING' : 'NO INFO YET', 2);
      // additional temperature channels reported by the RPI
      const rest = (this.cols || []).map((c, i) => [c, i]).filter(([c, i]) => i > 0 && i !== vi && i !== ii && !/^t_?s$/i.test(c)).slice(0, 4);
      rest.forEach(([c, i], k) => { const x = 4 + (k % 2) * 78, y = 95 + ((k / 2) | 0) * 7, val = fmtN(r[i], 1); text(x, y, clip(c.toUpperCase(), 8), 2); textR(x + 72, y, val == null ? '--' : val + (/temp|board|psu|air|amb|main|monitor|case/i.test(c) ? '°' : ''), val == null ? 2 : 3); });
      const w = this.warns[this.warns.length - 1];
      text(4, 110, `ITEMS ${this.items.length}   WARN ${this.warns.length}`, 3);
      if (w) { const s = '! ' + w + '     ', off = ((t / 160) | 0) % s.length; text(4, 118, (s + s).slice(off, off + 38), 3); }
      else text(4, 118, clip(this.raw[this.raw.length - 1] || '', 38), 2);
    },
    rawv() { const L = []; this.raw.slice(-24).forEach(l => wrap(l, 39).forEach(x => L.push(x))); L.slice(-17).forEach((l, i) => text(2, 14 + i * 7 - (i ? 0 : 0), l, 3)); },
    itemsv(t) {
      const L = [...this.items.map(i => ['+ ' + i.path, (i.bytes < 1024 ? i.bytes + 'B' : (i.bytes / 1024).toFixed(1) + 'K'), 3]), ...this.warns.map(w => ['! ' + w, '', 2])];
      L.slice(-15).forEach(([a, b, c], i) => { text(3, 14 + i * 7, clip(a, b ? 32 : 39), c); if (b) textR(157, 14 + i * 7, b, 2); });
      if (!this.items.length) textC(60, 'WAITING FOR THE TARGET ' + spin(t), 2);
    },
  },
};

//   EXTRACT: sealed
function stampText(x, y, w, h, word) {
  box(x, y, w, h, 3); box(x + 2, y + 2, w - 4, h - 4, 3);
  text(x + ((w - tw(word, 'b', 2)) >> 1), y + ((h - 16) >> 1), word, 3, 'b', 2);
  let s = 7; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; if (fb[j * W + i] === 3 && s % 100 < 13) fb[j * W + i] = 1; }
}
const Done = {
  make(r) { const d = Object.create(Done.proto); Object.assign(d, { r, ev: r.doneEv, sel: 0, ver: null }); return d; },
  proto: {
    enter() {},
    opts() { return [this.ver === 'run' ? 'VERIFYING...' : this.ver === true ? 'VERIFIED: EVERY HASH MATCHES' : this.ver === false ? 'VERIFY FAILED: SEE TERMINAL' : 'VERIFY NOW', `WARNINGS (${this.r.warns.length})`, 'OPEN IN TERMINAL', 'EXTRACT AGAIN', 'MAIN MENU']; },
    key(k) {
      if (k === 'up' || k === 'down') { this.sel = (this.sel + (k === 'up' ? 4 : 1)) % 5; SFX.move(); return; }
      if (k === 'b') { home(); SFX.back(); return; }
      if (k !== 'a' && k !== 'start') return;
      SFX.ok();
      if (this.sel === 0 && this.ver !== 'run') { this.ver = 'run'; run(['verify', this.ev.dir, '--head', this.ev.chain_head], { ndjson: true, on: ev => { if (ev.k === 'x') { this.ver = ev.code === 0; this.ver ? SFX.seal() : SFX.err(); } } }); }
      else if (this.sel === 1) go(Reader.make('WARNINGS', this.r.warns.length ? this.r.warns.map(w => '! ' + w).join('\n\n') : 'NONE.'));
      else if (this.sel === 2) { stack.length = 0; scr = Menu; go(Term); Term.prefill(`show ${q(this.ev.dir)}`); }
      else if (this.sel === 3) { stack.length = 0; scr = Menu; go(Setup); }
      else if (this.sel === 4) home();
    },
    draw(t) {
      const ok = this.r.code === 0; cls(0); bar(ok ? 'SEALED' : 'NO DATA', this.r.label);
      stampText(18, 15, 124, 26, ok ? 'SEALED' : 'EMPTY');
      textC(45, `${this.ev.items} ITEMS  ·  ${this.ev.warnings} WARNING${this.ev.warnings === 1 ? '' : 'S'}`, 3);
      textC(52, clip(String(this.ev.dir).split('/').pop(), 38), 2);
      text(4, 61, 'CHAIN HEAD', 2); const h = String(this.ev.chain_head || '').toUpperCase();
      [h.slice(0, 32), h.slice(32)].forEach((l, i) => text(4, 68 + i * 7, l.match(/.{1,8}/g).join(' '), 3));
      text(4, 83, 'WRITE IT. VERIFY NEEDS IT.', 2);
      this.opts().forEach((o, i) => { const y = 93 + i * 8, on = i === this.sel; if (on) rect(2, y - 1, 156, 7, 1); text(10, y, o, 3); if (on) text(4, y, '►', 3); });
      foot('A CHOOSE   B MENU');
    },
  },
};
const Fail = {
  make(r) { const f = Object.create(Fail.proto); Object.assign(f, { r, sel: 0 }); return f; },
  proto: {
    key(k) {
      if (k === 'up' || k === 'down') { this.sel = (this.sel + (k === 'up' ? 2 : 1)) % 3; SFX.move(); }
      else if (k === 'b') home();
      else if (k === 'a' || k === 'start') { SFX.ok(); if (this.sel === 0) swap(Run.make(this.r.cmds, this.r.label, this.r.secs)); else if (this.sel === 1) { stack.length = 0; scr = Menu; go(Term); Term.prefill(this.r.cmds[0].map(q).join(' ')); } else home(); }
    },
    draw() {
      cls(0); bar('FAILED', `EXIT ${this.r.code}`);
      const L = []; [...this.r.err.slice(-8), ...this.r.warns.slice(-3)].forEach(s => wrap(s.trim(), 38).forEach(x => L.push(x)));
      (L.length ? L : ['NOTHING CAME BACK.']).slice(-12).forEach((l, i) => text(4, 15 + i * 7, l, 3));
      ['TRY AGAIN', 'OPEN IN TERMINAL', 'MAIN MENU'].forEach((o, i) => { const y = 106 + i * 9, on = i === this.sel; if (on) rect(2, y - 1, 156, 7, 1); text(10, y, o, 3); if (on) text(4, y, '►', 3); });
      foot('A CHOOSE   B MENU');
    },
  },
};
const Reader = {
  make(title, body) { const r = Object.create(Reader.proto); r.title = title; r.lines = wrap(body, 38); r.off = 0; return r; },
  proto: {
    key(k) { const max = Math.max(0, this.lines.length - 17); if (k === 'down' || k === 'wheeldown') this.off = Math.min(max, this.off + 1); else if (k === 'up' || k === 'wheelup') this.off = Math.max(0, this.off - 1); else if (k === 'b' || k === 'a') back(); },
    draw() { cls(0); bar(this.title); this.lines.slice(this.off, this.off + 17).forEach((l, i) => text(4, 14 + i * 7, l, 3)); foot(this.lines.length > 17 ? '▲▼ SCROLL   B BACK' : 'B BACK'); },
  },
};

const CollectionList = {
  sel: 0, off: 0, entries: [], busy: false, error: null,
  enter() { this.reload(); },
  resume() {},
  reload() {
    this.busy = true; this.error = null;
    savedRequest('collections').then(result => {
      this.entries = result.collections || [];
      this.sel = Math.min(this.sel, Math.max(0, this.entries.length - 1));
      this.off = Math.min(this.off, this.sel);
    }).catch(err => this.error = err.message).finally(() => this.busy = false);
  },
  key(k) {
    if (k === 'b') return back();
    if (k === 'select') return this.reload();
    if (!this.entries.length) return;
    if (k === 'down' || k === 'up') {
      this.sel = (this.sel + (k === 'down' ? 1 : this.entries.length - 1)) % this.entries.length;
      if (this.sel < this.off) this.off = this.sel;
      if (this.sel >= this.off + 7) this.off = this.sel - 6;
      SFX.move();
    } else if (k === 'a' || k === 'start') { SFX.ok(); go(CollectionDetail.make(this.entries[this.sel].id)); }
  },
  draw(t) {
    cls(0); bar('COLLECTIONS', `${this.entries.length} SAVED`);
    if (this.busy) textC(62, `READING FOLDERS ${spin(t)}`, 3);
    else if (this.error) wrap(this.error, 37).slice(0, 10).forEach((l, i) => text(4, 27 + 8*i, l, 3));
    else if (!this.entries.length) {
      textC(44, 'NO SAVED PCB COLLECTIONS', 3);
      textC(57, 'RUN EXTRACT TO CREATE ONE.', 2);
      textC(73, 'LOOKING IN JANUS START FOLDER', 2);
    } else {
      this.entries.slice(this.off, this.off + 7).forEach((e, i) => {
        const y = 15 + 16*i, on = this.sel === this.off + i;
        if (on) win(2, y-1, 156, 15, 3, 3);
        const c = on ? 0 : 3, sub = on ? 1 : 2;
        const dt = new Date(e.created);
        const when = Number.isNaN(dt.getTime()) ? e.id.slice(-15) : dt.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12: false }).toUpperCase();
        text(7, y+1, when, c, 's');
        textR(151, y+1, `${e.count} ITEMS`, c);
        text(7, y+8, clip(e.id, 32), sub);
      });
      if (this.entries.length > 7) textR(156, 129, `${this.sel+1}/${this.entries.length}`, 2);
    }
    foot('A OPEN  SEL REFRESH  B BACK');
  },
};
const CollectionDetail = {
  make(id) { const d = Object.create(this.proto); Object.assign(d, { id, data: null, busy: true, error: null, sel: 0, verified: null }); return d; },
  proto: {
    enter() { this.busy = true; savedRequest('collection', { id: this.id }).then(result => this.data = result).catch(err => this.error = err.message).finally(() => this.busy = false); },
    opts() { return ['GRAPH + CSV', 'SYSTEM LOGS', 'SHARED FILES', 'SUMMARY', this.verified === null ? 'VERIFY HASHES' : this.verified ? 'VERIFIED OK' : 'VERIFY FAILED', 'BACK']; },
    key(k) {
      if (k === 'b') return back();
      if (!this.data) return;
      if (k === 'up' || k === 'down') { this.sel = (this.sel + (k === 'down' ? 1 : 5)) % 6; SFX.move(); }
      if (k === 'a' || k === 'start') {
        SFX.ok();
        if (this.sel === 0) go(CollectionGraph.make(this.id));
        if (this.sel === 1) go(CollectionFiles.make(this.id, 'logs', this.data.items));
        if (this.sel === 2) go(CollectionFiles.make(this.id, 'files', this.data.items));
        if (this.sel === 3) {
          const m = this.data;
          go(Reader.make('SUMMARY', [
            `COLLECTION: ${m.id}`, `CREATED: ${m.created}`, `TARGET: ${m.host}`,
            `FILES: ${m.count}   WARNINGS: ${m.warnings}`,
            `CHAIN HEAD: ${m.chainHead || 'NONE'}`,
            ...m.warningsText.map(w => '! ' + w),
          ].join('\n\n')));
        }
        if (this.sel === 4) {
          this.verified = null;
          run(['verify', this.id, '--head', this.data.chainHead || ''], { ndjson: true,
            on: e => { if (e.k === 'x') { this.verified = e.code === 0; toast(this.verified ? 'COLLECTION VERIFIED' : 'VERIFY FAILED'); } } });
        }
        if (this.sel === 5) back();
      }
    },
    draw(t) {
      cls(0); bar('COLLECTION', 'PI');
      if (this.busy) { textC(55, `LOADING ${spin(t)}`, 3); return; }
      if (this.error) { wrap(this.error, 37).forEach((l, i) => text(4, 22 + i*8, l, 3)); foot('B BACK'); return; }
      if (!this.data) return;
      const m = this.data;
      text(5, 15, clip(m.id, 37), 3);
      text(5, 24, `HOST ${clip(m.host || 'UNKNOWN', 31)}`, 2);
      text(5, 32, `${m.count} ITEMS   ${m.warnings} WARNINGS`, 2);
      hl(4, 41, 152, 2);
      this.opts().forEach((label, i) => {
        const y = 49 + i*13, on = i === this.sel;
        if (on) rect(4, y-2, 152, 10, 1);
        text(8, y, on ? '>' : ' ', 3); text(17, y, label, 3);
        if (on && blink(t)) textR(150, y, '<', 3);
      });
      foot('A OPEN   B COLLECTIONS');
    },
  },
};
const CollectionFiles = {
  make(id, mode, items) {
    const x = Object.create(this.proto);
    x.id = id; x.mode = mode; x.sel = 0; x.off = 0;
    x.files = items.filter(v => mode === 'logs' ? /^pi\/logs\/.*\.txt$/i.test(v.path) : v.path.startsWith('pi/files/'));
    return x;
  },
  proto: {
    enter() {},
    key(k) {
      if (k === 'b') return back();
      if (!this.files.length) return;
      if (k === 'up' || k === 'down') {
        this.sel = (this.sel + (k === 'down' ? 1 : this.files.length - 1)) % this.files.length;
        if (this.sel < this.off) this.off = this.sel;
        if (this.sel >= this.off + 9) this.off = this.sel - 8;
        SFX.move();
      } else if (k === 'select') this.download();
      else if (k === 'a' || k === 'start') {
        SFX.ok(); const f = this.files[this.sel];
        if (f.bytes > 1024*1024 || !/\.(txt|log|json|csv|md|ini|conf|yaml|yml)$/i.test(f.path)) return this.download();
        go(CollectionText.make(this.id, f.path));
      }
    },
    download() { savedDownload(this.id, this.files[this.sel].path); toast('DOWNLOAD STARTED'); },
    draw() {
      cls(0); bar(this.mode === 'logs' ? 'SYSTEM LOGS' : 'SHARED FILES', `${this.files.length} FILES`);
      if (!this.files.length) { textC(52, 'NO FILES IN THIS COLLECTION', 3); textC(65, 'TRY FULL PI EXTRACTION', 2); }
      else this.files.slice(this.off, this.off+9).forEach((f, i) => {
        const y = 16 + i*12, on = this.sel === this.off+i;
        if (on) rect(3, y-2, 154, 10, 1);
        text(5, y, on ? '>' : ' ', 3);
        const p = this.mode === 'logs' ? f.path.slice(8) : f.path.slice(9);
        text(13, y, clip(p, 29), 3);
        textR(155, y, f.bytes >= 1024 ? `${Math.round(f.bytes/1024)}K` : `${f.bytes}B`, on ? 3 : 2);
      });
      foot('A VIEW   SEL SAVE   B BACK');
    },
  },
};
const CollectionText = {
  make(id, file) { const t = Object.create(this.proto); Object.assign(t, { id, file, lines: [], off: 0, busy: true, error: null, truncated: false }); return t; },
  proto: {
    enter() {
      savedRequest('collection/text', { id: this.id, path: this.file }).then(d => {
        this.lines = wrap(d.text, 38); this.truncated = d.truncated;
      }).catch(err => this.error = err.message).finally(() => this.busy = false);
    },
    key(k) {
      if (k === 'b') return back();
      if (k === 'select') { savedDownload(this.id, this.file); toast('DOWNLOAD STARTED'); }
      if (k === 'up' || k === 'down' || k === 'wheelup' || k === 'wheeldown') this.off = Math.max(0, Math.min(Math.max(0, this.lines.length-17), this.off + ((k === 'down' || k === 'wheeldown') ? 1 : -1)));
    },
    draw(t) {
      cls(0); bar(clip(this.file.split('/').pop().toUpperCase(), 24), `${this.off+1}/${Math.max(1, this.lines.length)}`);
      if (this.busy) textC(55, `READING ${spin(t)}`, 3);
      else if (this.error) text(4, 20, clip(this.error, 37), 3);
      else this.lines.slice(this.off, this.off+17).forEach((l, i) => text(4, 14+i*7, clip(l, 38), 3));
      if (this.truncated) textR(156, 131, 'PREVIEW CUT', 2);
      foot('UP/DOWN SCROLL  SEL SAVE  B BACK');
    },
  },
};
const CollectionGraph = {
  make(id) { const a = Object.create(this.proto); Object.assign(a, { id, busy: true, error: null, data: null, col: 1 }); return a; },
  proto: {
    enter() {
      savedRequest('collection/graph', { id: this.id }).then(data => {
        this.data = data;
        this.col = Math.max(1, data.columns.findIndex((c, i) => i > 0 && data.points.some(p => Number.isFinite(p[i]))));
      }).catch(err => this.error = err.message).finally(() => this.busy = false);
    },
    channels() { return this.data?.columns.map((c, i) => [c, i]).filter(([,i]) => i > 0) || []; },
    points() { return (this.data?.points || []).filter(p => Number.isFinite(p[this.col])).map((p, i) => [Number.isFinite(p[0]) ? p[0] : i, p[this.col]]); },
    key(k) {
      if (k === 'b') return back();
      if (!this.data) return;
      if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
        const a = this.channels().map(x=>x[1]);
        this.col = cyc(a, this.col, (k === 'left' || k === 'up') ? -1 : 1); SFX.move();
      }
      if (k === 'a' || k === 'start') { savedDownload(this.id, 'pi-stream.csv'); toast('CSV DOWNLOAD STARTED'); }
      if (k === 'select') this.exportPng();
    },
    exportPng() {
      const data = this.points(); if (!data.length) return toast('NO GRAPH DATA');
      const w=960, h=480, c=document.createElement('canvas'); c.width=w;c.height=h;
      const g=c.getContext('2d'), palette=PAL[OPT.pal].c;
      g.fillStyle=palette[0];g.fillRect(0,0,w,h);
      g.fillStyle=palette[3];g.font='bold 26px monospace';g.fillText('JANUS / ARCADE PCB',50,48);
      g.font='20px monospace';g.fillText(this.data.columns[this.col],50,85);
      const left=80, top=110, right=920, bottom=410;
      g.strokeStyle=palette[2];g.lineWidth=1;
      for(let i=0;i<=5;i++){let y=top+(bottom-top)*i/5;g.beginPath();g.moveTo(left,y);g.lineTo(right,y);g.stroke();}
      const xx=data.map(p=>p[0]), yy=data.map(p=>p[1]);
      let minX=Math.min(...xx),maxX=Math.max(...xx),minY=Math.min(...yy),maxY=Math.max(...yy);
      if(minX===maxX)maxX=minX+1;if(minY===maxY){maxY+=.5;minY-=.5;}
      g.strokeStyle=palette[3];g.lineWidth=3;g.beginPath();
      data.forEach(([x,y],i)=>{const px=left+(x-minX)/(maxX-minX)*(right-left),py=bottom-(y-minY)/(maxY-minY)*(bottom-top);if(i)g.lineTo(px,py);else g.moveTo(px,py);});g.stroke();
      g.fillStyle=palette[3];g.font='16px monospace';
      g.fillText(minY.toFixed(2),left,440);g.fillText(maxY.toFixed(2),left,103);
      g.fillText(`SAMPLES: ${this.data.totalRows}  |  ${this.id}`,50,465);
      c.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${this.id}-${this.data.columns[this.col].replace(/[^a-z0-9_-]/gi,'_')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);},'image/png');
      toast('GRAPH PNG SAVED');
    },
    draw() {
      cls(0);bar('GRAPH', 'ARCADE PCB');
      if(this.busy){textC(55,'LOADING RECORDING',3);return;}
      if(this.error){wrap(this.error,38).slice(0,8).forEach((l,i)=>text(4,23+i*8,l,3));foot('B BACK');return;}
      if(!this.data?.columns?.length){textC(54,'NO CSV DATA RECORDED',3);foot('B BACK');return;}
      const name=this.data.columns[this.col]||'READING';
      text(4,15,'<' + clip(name.toUpperCase(),29) + '>',3);
      textR(155,25,`${this.data.totalRows} SAMPLES`,2);
      const pts=this.points();
      box(3,35,154,76,2);
      if(pts.length<2)textC(66,'NOT ENOUGH VALUES TO GRAPH',2);
      else {
        const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
        let xmin=Math.min(...xs),xmax=Math.max(...xs),lo=Math.min(...ys),hi=Math.max(...ys);
        if(xmin===xmax)xmax=xmin+1;if(hi===lo){hi+=.5;lo-=.5;}
        for(let j=0;j<4;j++)hl(6,39+j*22,148,1);
        let last=null;
        pts.forEach(([x,y])=>{const px=Math.max(6,Math.min(153,Math.round(6+147*(x-xmin)/(xmax-xmin)))),py=Math.max(38,Math.min(106,Math.round(106-68*(y-lo)/(hi-lo))));if(last)line(last[0],last[1],px,py,3);last=[px,py];});
        rect(5,36,tw(hi.toFixed(2))+3,7,0);text(6,37,hi.toFixed(2),2);
        rect(5,102,tw(lo.toFixed(2))+3,7,0);text(6,103,lo.toFixed(2),2);
      }
      text(5,116,`RANGE ${pts.length ? Math.min(...pts.map(p=>p[1])).toFixed(2)+' - '+Math.max(...pts.map(p=>p[1])).toFixed(2):'N/A'}`,2);
      foot('LEFT/RIGHT METRIC A CSV SEL PNG');
    },
  },
};

//   name-entry keyboard
const KB = {
  sets: [['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ.-_/', '0123456789', ':@~=,\'"+*?'], ['abcdefghij', 'klmnopqrst', 'uvwxyz.-_/', '0123456789', ':@~=,\'"+*?']],
  open(title, value, done) { Object.assign(this, { title, v: value || '', done, r: 0, c: 0, lower: 1 }); go(this); },
  enter() {},
  put(ch) { if (this.v.length < 120) this.v += ch; },
  key(k) {
    const rows = 6;
    if (k === 'up') this.r = (this.r + rows - 1) % rows; else if (k === 'down') this.r = (this.r + 1) % rows;
    else if (k === 'left') this.c = (this.c + (this.r === 5 ? 3 : 9)) % (this.r === 5 ? 4 : 10); else if (k === 'right') this.c = (this.c + 1) % (this.r === 5 ? 4 : 10);
    else if (k === 'b') { if (this.v) { this.v = this.v.slice(0, -1); SFX.back(); } else back(); return; }
    else if (k === 'select') { this.lower ^= 1; SFX.move(); return; }
    else if (k === 'start') { this.finish(); return; }
    else if (k === 'a') {
      if (this.r < 5) { this.put(this.sets[this.lower][this.r][this.c]); SFX.move(); }
      else [() => { this.lower ^= 1; }, () => this.put(' '), () => { this.v = this.v.slice(0, -1); }, () => this.finish()][this.c](), SFX.move();
      return;
    }
    if (this.r === 5) this.c = Math.min(this.c, 3);
    SFX.move();
  },
  finish() { SFX.ok(); const v = this.v, d = this.done; back(); d && d(v); },
  type(e) {
    if (e.ctrlKey) return false;
    if (e.key === 'Enter') { this.finish(); return true; } if (e.key === 'Escape') { back(); return true; }
    if (e.key === 'Backspace') { this.v = this.v.slice(0, -1); return true; } if (e.key === 'Shift') return true;
    if (e.key.length === 1) { this.put(e.key); return true; } return false;
  },
  draw(t) {
    cls(0); bar(this.title.length > 18 ? 'ENTER' : this.title); if (this.title.length > 18) textR(156, 3, this.title, 0);
    win(4, 14, 152, 13, 0, 3); const s = this.v.slice(-35); text(8, 18, s, 3); if (blink(t)) rect(8 + tw(s), 18, 3, 5, 3);
    this.sets[this.lower].forEach((row, r) => [...row].forEach((ch, c) => { const x = 11 + c * 14, y = 33 + r * 12, on = this.r === r && this.c === c; if (on) win(x - 4, y - 3, 15, 13, 3, 3); text(x, y, ch, on ? 0 : 3, 'b'); }));
    ['aA', 'SPACE', 'DEL', 'END'].forEach((w, c) => { const x = 6 + c * 38, y = 96, on = this.r === 5 && this.c === c; win(x, y - 3, 34, 11, on ? 3 : 0, 3); text(x + ((34 - tw(w)) >> 1), y, w, on ? 0 : 3); });
    text(4, 112, 'OR JUST TYPE ON THE KEYBOARD.', 2);
    foot('A TYPE  B DEL  START END  SEL aA');
  },
};

//   terminal

const DECK = [
  ['pcb check {HOST}', 'Test the Ethernet link and available PCB endpoints'],
  ['pcb all {HOST} --seconds 30', 'Complete acquisition: info, logs, files, telemetry'],
  ['pcb info {HOST}', 'Read system and power diagnostics'],
  ['pcb logs {HOST}', 'Collect system journal and available logs'],
  ['pcb stream {HOST} --seconds 60', 'Record live telemetry for one minute'],
  ['pcb fetch {HOST}', 'Copy the shared ~/logs folder'],
  ['pcb ls {HOST}', 'List shared files without copying them'],
  ['pcb ssh {LOGIN} --only power,dmesg,journal', 'Optional read-only SSH collection'],
  ['show {DIR}', 'Show the last acquisition and hashes'],
  ['verify {DIR}', 'Verify the last acquisition'],
  ['pack {DIR}', 'Make a verified archive of the last acquisition'],
  ['history', 'Previously executed terminal commands'],
  ['help', 'JANUS command reference'],
];
const fill = s => s.replace('{HOST}', ST.host)
  .replace('{LOGIN}', ST.login).replace('{DIR}', ST.last ? q(ST.last) : '<folder>');
function tokens(s) {
  const result = []; let current = '', quote = null, quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && quote === '"' && (s[i+1] === '"' || s[i+1] === '\\')) { current += s[++i]; continue; }
    if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; quoted = true; continue; }
    if (/\s/.test(ch)) { if (current || quoted) result.push(current); current = ''; quoted = false; }
    else current += ch;
  }
  if (quote) throw new Error('Unclosed quotation mark.');
  if (current || quoted) result.push(current);
  return result;
}

const Term = {
  buf: [], line: '', off: 0, hi: -1, h: null, deck: null, started: false,
  // The earlier LCD terminal is deliberately drawn by the framebuffer, not by HTML controls.
  visible() {},
  enter() {
    if (!this.started) {
      this.started = true;
      this.out(`JANUS ${API.version} TERMINAL${LINK === 'offline' ? '  (OFFLINE)' : ''}`, 3);
      this.out(LINK === 'offline' ? 'offline preview: start with node bin/janus.js ui' : `working in ${API.cwd || '.'}`, 2);
      this.out('type a command, or A for the command deck.', 2);
      this.out('START runs it. "help" lists everything.', 2);
      this.out('', 2);
    }
    if (!this.pasteHooked) {
      this.pasteHooked = true;
      window.addEventListener('paste', event => {
        if (scr !== Term || this.h || this.deck) return;
        const value = event.clipboardData?.getData('text/plain');
        if (!value) return;
        event.preventDefault();
        this.line = (this.line + value.replace(/[\r\n]+/g, ' ')).slice(0, 300);
      });
    }
  },
  resume() {},
  prefill(s) { this.line = s; },
  out(s, c = 3) {
    const lines = wrap(s, 39);
    lines.forEach(line => this.buf.push([line, c]));
    if (this.buf.length > 800) this.buf.splice(0, this.buf.length - 800);
    if (this.off) this.off = Math.min(this.off + lines.length, this.buf.length);
  },
  exec(raw) {
    if (this.h) { this.out('A command is still running. B to stop.', 2); return; }
    const s = String(raw).trim(); this.out('janus> ' + s, 3); this.line = ''; this.hi = -1; this.off = 0;
    if (!s) return;
    if (ST.hist[ST.hist.length - 1] !== s) { ST.hist.push(s); saveSt(); }
    let a;
    try { a = tokens(s); } catch (error) { this.out(error.message, 2); return; }
    if (a[0]?.toLowerCase() === 'janus') a.shift();
    const c = (a[0] || '').toLowerCase();
    if (c === 'clear' || c === 'cls') { this.buf = []; return; }
    if (c === 'history') { ST.hist.slice(-20).forEach((line, i) => this.out(`${i+1}. ${line}`, 2)); return; }
    if (c === 'last') { this.out(ST.last ? `${ST.last}\nhead ${ST.lastHead}` : 'No previous acquisition.', 2); return; }
    if (c === 'menu' || c === 'exit' || c === 'quit') { home(); return; }
    if (c === 'extract') { stack.length = 0; scr = Menu; go(Setup); return; }
    if (c === 'ui') { this.out('You are already using JANUS handheld.', 2); return; }
    if (c === 'help' || c === '-h') a = ['--help'];
    if (a[0] === 'pcb' && a[2] && !a[2].startsWith('-')) {
      if (a[1] === 'ssh') ST.login = a[2]; else ST.host = a[2];
      saveSt();
    }
    SFX.ok(); let needHead = false;
    this.h = run(a, { ndjson: false, on: event => {
      if (event.k === 'o' || event.k === 'e') {
        const line = event.s; this.out(line, event.k === 'e' ? 2 : 3);
        const dir = /acquisition folder: (.+)$/.exec(line);
        if (dir) { ST.last = dir[1]; saveSt(); }
        if (needHead && /^\s*[0-9a-f]{64}\s*$/.test(line)) { ST.lastHead = line.trim(); needHead = false; saveSt(); }
        if (/Log chain head:/.test(line)) needHead = true;
        const items = /^(\d+) items, (\d+) warnings/.exec(line);
        if (items) { ST.lastItems = +items[1]; ST.lastWarn = +items[2]; saveSt(); }
        if (/^\s+\+ /.test(line)) blip();
      } else if (event.k === 'x') {
        this.out(`[exit ${event.code}]${event.code ? ' -- see errors above' : ' -- complete'}`, 2);
        this.h = null;
        event.code ? SFX.err() : SFX.move();
      }
    } });
  },
  hist(d) {
    const list = ST.hist; if (!list.length) return;
    this.hi = this.hi < 0 ? (d < 0 ? list.length - 1 : -1) : this.hi + d;
    if (this.hi >= list.length) { this.hi = -1; this.line = ''; return; }
    if (this.hi < 0) this.hi = 0;
    this.line = list[this.hi];
  },
  scroll(d) { this.off = Math.max(0, Math.min(Math.max(0, this.buf.length - 21), this.off + d)); },
  key(k) {
    if (this.deck) return this.deckKey(k);
    if (k === 'wheelup') return this.scroll(3);
    if (k === 'wheeldown') return this.scroll(-3);
    if (this.h) {
      if (k === 'b' || k === 'start') { this.out('^C  stopping; sealing collected files...', 2); this.h.stop(); }
      return;
    }
    if (k === 'up') this.hist(-1);
    else if (k === 'down') this.hist(1);
    else if (k === 'left') this.scroll(10);
    else if (k === 'right') this.scroll(-10);
    else if (k === 'a') { this.deck = { sel: 0 }; SFX.ok(); }
    else if (k === 'select') KB.open('TERMINAL', this.line, value => { this.line = value; });
    else if (k === 'start') this.exec(this.line);
    else if (k === 'b') { if (this.line) this.line = this.line.slice(0, -1); else back(); }
  },
  deckKey(k) {
    const d = this.deck;
    if (k === 'up') { d.sel = (d.sel + DECK.length - 1) % DECK.length; SFX.move(); }
    else if (k === 'down') { d.sel = (d.sel + 1) % DECK.length; SFX.move(); }
    else if (k === 'b') { this.deck = null; SFX.back(); }
    else if (k === 'a' || k === 'start') {
      this.line = fill(DECK[d.sel][0]); this.deck = null;
      if (k === 'start') this.exec(this.line); else SFX.ok();
    }
  },
  type(event) {
    if (this.deck) {
      if (event.key === 'Escape') { this.deck = null; return true; }
      if (event.key === 'Enter') { this.deckKey('a'); return true; }
      return false;
    }
    if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
      if (this.h) { this.out('^C', 2); this.h.stop(); }
      else { this.out('janus> ' + this.line + '^C', 2); this.line = ''; }
      return true;
    }
    if (event.ctrlKey && (event.key === 'l' || event.key === 'L')) { this.buf = []; return true; }
    if (event.ctrlKey || event.metaKey) return false;
    if (event.key === 'Shift') return true;
    if (event.key === 'F1') { this.deck = { sel: 0 }; return true; }
    if (event.key === 'PageUp') { this.scroll(10); return true; }
    if (event.key === 'PageDown') { this.scroll(-10); return true; }
    if (this.h) return event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace';
    if (event.key === 'Enter') { this.exec(this.line); return true; }
    if (event.key === 'Backspace') { this.line = this.line.slice(0, -1); return true; }
    if (event.key === 'ArrowUp') { this.hist(-1); return true; }
    if (event.key === 'ArrowDown') { this.hist(1); return true; }
    if (event.key === 'Escape') { if (this.line) this.line = ''; else back(); return true; }
    if (event.key === 'Tab') {
      const words = ['pcb','check','info','logs','stream','all','fetch','ls','ssh','show','verify','pack','history','clear','extract','--seconds','--head'];
      const m = /(\S*)$/.exec(this.line)?.[1] || '', hits = words.filter(word => m && word.startsWith(m));
      if (hits.length === 1) this.line += hits[0].slice(m.length) + ' ';
      return true;
    }
    if (event.key.length === 1) { if (this.line.length < 300) this.line += event.key; return true; }
    return false;
  },
  draw(t) {
    cls(0); rect(0, 0, W, 7, 3);
    text(2, 1, 'TERMINAL', 0);
    textR(158, 1, this.h ? 'RUNNING ' + spin(t) : LINK === 'offline' ? 'OFFLINE' : LINK === 'ok' ? 'LOCAL' : 'NO LINK', 0);
    const n = 21, end = this.buf.length - this.off, rows = this.buf.slice(Math.max(0, end - n), end);
    rows.forEach(([line, color], i) => text(2, 8 + i * 6, line, color));
    if (this.off) { rect(150, 8, 9, 7, 3); text(152, 9, '▼', 0); }
    hl(0, 135, W, 1);
    if (this.h) text(2, 137, `${spin(t)} running.  B or ctrl-c stops`, 2);
    else {
      const prompt = 'janus> ', room = 38 - prompt.length, value = this.line.slice(-room);
      text(2, 137, prompt, 2);
      const x = text(2 + tw(prompt), 137, value, 3);
      if (blink(t)) rect(x, 137, 3, 5, 3);
    }
    if (this.deck) {
      win(4, 9, 152, 124, 0, 3); text(9, 13, 'COMMAND DECK', 3);
      textR(150, 13, `${this.deck.sel + 1}/${DECK.length}`, 2); hl(8, 20, 144, 1);
      const top = Math.max(0, Math.min(this.deck.sel - 5, DECK.length - 12));
      DECK.slice(top, top + 12).forEach(([command], i) => {
        const k = top + i, y = 23 + i * 7, on = k === this.deck.sel;
        if (on) rect(6, y - 1, 148, 7, 3);
        text(10, y, clip(fill(command), 35), on ? 0 : 3);
      });
      hl(8, 108, 144, 1);
      wrap(DECK[this.deck.sel][1], 35).slice(0, 2).forEach((line, i) => text(10, 112 + i * 7, line, 2));
      text(10, 125, 'A PUT IN LINE   START RUN NOW', 2);
    }
  },
};

//  options
const SHELLS = ['grey', 'smoke', 'teal', 'clear'];
const Options = {
  sel: 0, enter() {},
  rows() {
    return [
      { label: 'LCD', value: () => PAL[OPT.pal].name, opts: 1, step: d => { OPT.pal = cyc(Object.keys(PAL), OPT.pal, d); dirty = true; saveOpt(); } },
      { label: 'SHELL', value: () => OPT.shell.toUpperCase(), opts: 1, step: d => { OPT.shell = cyc(SHELLS, OPT.shell, d); unit.dataset.shell = OPT.shell; saveOpt(); } },
      { label: 'SOUND', value: () => OPT.sound ? 'ON' : 'OFF', opts: 1, step: () => { OPT.sound = !OPT.sound; saveOpt(); } },
      { label: 'PIXEL GRID', value: () => OPT.grid ? 'ON' : 'OFF', opts: 1, step: () => { OPT.grid = !OPT.grid; dirty = true; saveOpt(); } },
      { label: 'LCD BLUR', value: () => OPT.ghost ? 'ON' : 'OFF', opts: 1, step: () => { OPT.ghost = !OPT.ghost; saveOpt(); } },
      { button: 1, label: 'DONE', act: () => back() },
    ];
  },
  key(k) { formKey(this, k); },
  draw(t) {
    cls(0); bar('OPTIONS'); drawForm(this.rows(), this.sel, 18, t);
    for (let i = 0; i < 4; i++) { rect(20 + i * 30, 88, 26, 14, i); box(20 + i * 30, 88, 26, 14, 3); }
    textC(106, 'FOUR SHADES OF THIS LCD', 2);
    textC(118, `JANUS ${API.version} · ${LINK === 'offline' ? 'OFFLINE PREVIEW' : 'CONNECTED TO JANUS UI'}`, 2);
    foot('◄► CHANGE   B BACK');
  },
};

//   go
unit.dataset.shell = OPT.shell; led.classList.add('on');
bootFn = () => { stack.length = 0; scr = Boot; Boot.enter(); };
sizeLcd(); bootFn();
hello().then(r => { LINK = r.offline ? 'offline' : r.error ? 'lost' : 'ok'; if (r.error) toast('JANUS UI NOT RESPONSIVE'); });
(function frame(t) {
  if (scr) scr.draw(t);
  if (toastS && t < toastT) { win(4, 122, 152, 13, 3, 3); text(8, 126, clip(toastS, 36), 0); }
  present(); requestAnimationFrame(frame);
})(performance.now());
