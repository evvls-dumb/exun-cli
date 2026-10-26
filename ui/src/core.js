'use strict';
// ---- 160x144, four shades. Everything is drawn into fb[] as 0 (lightest) .. 3 (darkest). ----
const W = 160, H = 144, fb = new Uint8Array(W * H), shown = new Float32Array(W * H).fill(0);
const PAL = {
  dmg:    { name: 'DMG GREEN', c: ['#c4cfa1', '#8b956d', '#4d533c', '#1f1f1f'] },
  pocket: { name: 'POCKET',    c: ['#e3ddcb', '#aaa292', '#6b665e', '#262420'] },
  lit:    { name: 'BACKLIT',   c: ['#d8f1ee', '#7fb7b4', '#2f6a6f', '#0b2629'] },
  amber:  { name: 'AMBER',     c: ['#ffd27a', '#d4892a', '#7a3d0b', '#2a1203'] },
};
const OPT = (() => { const d = { pal: 'dmg', shell: 'grey', sound: true, grid: true, ghost: true }; try { return Object.assign(d, JSON.parse(localStorage.getItem('janus.opt') || '{}')); } catch (e) { return d; } })();
const saveOpt = () => { try { localStorage.setItem('janus.opt', JSON.stringify(OPT)); } catch (e) {} };

const cls = (c = 0) => fb.fill(c);
const px = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = c; };
function rect(x, y, w, h, c) { const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0); for (let j = y0; j < y1; j++) fb.fill(c, j * W + x0, j * W + x1); }
function hl(x, y, w, c) { rect(x, y, w, 1, c); } function vl(x, y, h, c) { rect(x, y, 1, h, c); }
function box(x, y, w, h, c) { hl(x, y, w, c); hl(x, y + h - 1, w, c); vl(x, y, h, c); vl(x + w - 1, y, h, c); }
/** rounded window frame, the kind every handheld RPG menu used */
function win(x, y, w, h, bg = 0, fg = 3) { rect(x + 1, y + 1, w - 2, h - 2, bg); hl(x + 2, y, w - 4, fg); hl(x + 2, y + h - 1, w - 4, fg); vl(x, y + 2, h - 4, fg); vl(x + w - 1, y + 2, h - 4, fg); px(x + 1, y + 1, fg); px(x + w - 2, y + 1, fg); px(x + 1, y + h - 2, fg); px(x + w - 2, y + h - 2, fg); }
function dith(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if ((i + j) & 1) px(i, j, c); }
function line(x0, y0, x1, y1, c) { x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy; for (;;) { px(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } }

// small font: 3x5 in a 4x6 cell (40 columns). big font: 8x8.
const CW = { s: 4, b: 8 }, CH = { s: 6, b: 8 };
function text(x, y, s, c = 3, f = 's', sc = 1) {
  s = String(s); const cw = CW[f] * sc;
  for (let k = 0; k < s.length; k++) {
    let g = (f === 's' ? FS : FB)[s.charCodeAt(k)];
    if (!g && f === 'b') g = FB[s.toUpperCase().charCodeAt(k)];
    if (!g) g = (f === 's' ? FS : FB)[63];
    const bw = f === 's' ? 3 : 8;
    for (let r = 0; r < g.length; r++) { const row = g[r]; if (!row) continue; for (let b = 0; b < bw; b++) if (row & (1 << (bw - 1 - b))) { if (sc === 1) px(x + b, y + r, c); else rect(x + b * sc, y + r * sc, sc, sc, c); } }
    x += cw;
  }
  return x;
}
const tw = (s, f = 's', sc = 1) => String(s).length * CW[f] * sc;
const textR = (xr, y, s, c, f, sc) => text(xr - tw(s, f, sc) + (f === 'b' ? 0 : 1), y, s, c, f, sc);
const textC = (y, s, c, f, sc) => text(((W - tw(s, f, sc)) / 2) | 0, y, s, c, f, sc);
function wrap(s, cols) {
  const out = []; String(s).split('\n').forEach(par => {
    let l = par; if (!l.length) { out.push(''); return; }
    while (l.length > cols) { let i = l.lastIndexOf(' ', cols); if (i < cols * 0.5) i = cols; out.push(l.slice(0, i)); l = l.slice(i).replace(/^ /, ''); }
    out.push(l);
  }); return out;
}
const clip = (s, n) => (s = String(s), s.length > n ? s.slice(0, n - 1) + '…' : s);

/** 16-ish pixel icons: '.' clear, 0-3 shades */
function icon(x, y, rows, map = null) { rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch !== '.') px(x + i, y + j, map ? map[+ch] : +ch); } }); }

// ---- the LCD itself ----
const cv = document.getElementById('cv'), g = cv.getContext('2d');
let S = 4, img = null, dirty = true;
function sizeLcd() {
  const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  S = Math.max(1, Math.min(7, Math.floor(r.width * dpr / W)));
  cv.width = W * S; cv.height = H * S; img = g.createImageData(cv.width, cv.height); dirty = true;
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function present() {
  let moved = false; const k = OPT.ghost ? 0.42 : 1;
  for (let i = 0; i < fb.length; i++) { const d = fb[i] - shown[i]; if (d) { moved = true; shown[i] = Math.abs(d) < 0.04 ? fb[i] : shown[i] + d * k; } }
  if (!moved && !dirty) return; dirty = false;
  const P = PAL[OPT.pal].c.map(hex), D = img.data, rowLen = W * S * 4, grid = OPT.grid && S >= 3, sh = Math.max(1, Math.round(S * 0.22));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = shown[y * W + x], a = Math.floor(v), f = v - a, A = P[a], B = P[Math.min(3, a + 1)];
    const r = A[0] + (B[0] - A[0]) * f, gg = A[1] + (B[1] - A[1]) * f, b = A[2] + (B[2] - A[2]) * f;
    // the reflective backing catches a faint shadow of the pixel up and to the left
    const left = x ? shown[y * W + x - 1] : 0, up = y ? shown[(y - 1) * W + x] : 0;
    for (let j = 0; j < S; j++) {
      let o = ((y * S + j) * W * S + x * S) * 4;
      for (let i = 0; i < S; i++, o += 4) {
        let m = 1;
        if (grid && (i === S - 1 || j === S - 1)) m = 1.035;
        if ((i < sh && left - v > 1.2) || (j < sh && up - v > 1.2)) m *= 0.9;
        D[o] = Math.min(255, r * m); D[o + 1] = Math.min(255, gg * m); D[o + 2] = Math.min(255, b * m); D[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  document.querySelector('.lcd').style.background = PAL[OPT.pal].c[1];
}
window.addEventListener('resize', sizeLcd);

// ---- sound: a square wave, as it should be ----
let AC = null;
function tone(seq) {
  if (!OPT.sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  let t = AC.currentTime + 0.01;
  for (const [f, d, v = 0.06, type = 'square'] of seq) {
    if (f) { const o = AC.createOscillator(), gn = AC.createGain(); o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(gn).connect(AC.destination); o.start(t); o.stop(t + d + 0.02); }
    t += d;
  }
}
const SFX = {
  move: () => tone([[1320, 0.025, 0.035]]), ok: () => tone([[988, 0.04], [1568, 0.07]]), back: () => tone([[784, 0.04], [523, 0.06]]),
  err: () => tone([[196, 0.09, 0.07], [0, 0.03], [196, 0.12, 0.07]]), boot: () => tone([[1047, 0.07, 0.05], [0, 0.04], [2093, 0.42, 0.05]]),
  seal: () => tone([[523, 0.06], [659, 0.06], [784, 0.06], [1047, 0.22]]), tick: () => tone([[2400, 0.008, 0.012]]),
};

// ---- LED ----
const led = document.getElementById('led'); let ledT = 0;
function blip() { led.classList.add('blip'); clearTimeout(ledT); ledT = setTimeout(() => led.classList.remove('blip'), 60); }

// ---- input. Buttons on the unit, the keyboard, both press the same keys. ----
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', x: 'a', X: 'a', k: 'a', z: 'b', Z: 'b', j: 'b', Enter: 'start', Shift: 'select', Escape: 'b', Backspace: 'b' };
const unit = document.getElementById('unit'), dpad = document.querySelector('.dpad');
let onKey = () => {}, onType = () => false;
function press(k) { if (k === 'power') return togglePower(); if (unit.classList.contains('off')) return; onKey(k); }
function showDown(k, on) { const b = document.querySelector(`[data-k="${k}"]`); if (b) b.classList.toggle('down', on); if (['up', 'down', 'left', 'right'].includes(k)) { if (on) dpad.dataset.tilt = k; else if (dpad.dataset.tilt === k) delete dpad.dataset.tilt; } }
document.querySelectorAll('[data-k]').forEach(b => {
  let rep = null, hold = null; const k = b.dataset.k;
  const up = () => { clearTimeout(hold); clearInterval(rep); showDown(k, false); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); showDown(k, true); press(k);
    if (['up', 'down', 'left', 'right'].includes(k)) hold = setTimeout(() => { rep = setInterval(() => press(k), 85); }, 340); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, up));
  b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); press(k); } });
});
window.addEventListener('keydown', e => {
  if (e.metaKey || e.altKey) return;
  if (e.target && e.target.closest && e.target.closest('#janus-terminal')) return;
  if (unit.classList.contains('off')) return;
  if (onType(e)) { e.preventDefault(); return; }
  const k = KEYMAP[e.key]; if (!k) return;
  if (e.target && e.target.closest && e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
  e.preventDefault(); showDown(k, true); press(k);
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) showDown(k, false); });
window.addEventListener('wheel', e => { if (e.target === cv && Math.abs(e.deltaY) > 4) { onKey(e.deltaY < 0 ? 'wheelup' : 'wheeldown'); e.preventDefault(); } }, { passive: false });

let powered = true, bootFn = null;
function togglePower() { powered = !powered; unit.classList.toggle('off', !powered); led.classList.toggle('on', powered); if (powered && bootFn) bootFn(); }
