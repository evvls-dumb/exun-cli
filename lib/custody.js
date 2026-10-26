'use strict';
// Acquisition log: every entry carries the SHA-256 of the one before it, so an edit made
// afterwards shows up. It detects changes; it cannot say who made them.
const crypto = require('crypto');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

class Custody {
  constructor(entries = []) { this.log = entries; }
  head() { return this.log.length ? this.log[this.log.length - 1].h : null; }
  add(action, detail = '') {
    const q = this.head() || 'genesis', s = this.log.length, t = new Date().toISOString(), p = String(detail);
    const e = { s, t, a: action, p, q, h: sha256(`${q}|${s}|${t}|${action}|${p}`) };
    this.log.push(e); return e;
  }
  verify() { return Custody.verify(this.log); }
  static verify(log) {
    let q = 'genesis';
    for (const e of log) {
      if (e.q !== q || sha256(`${q}|${e.s}|${e.t}|${e.a}|${e.p}`) !== e.h) return { ok: false, at: e.s, action: e.a };
      q = e.h;
    }
    return { ok: true, n: log.length };
  }
}
module.exports = { Custody, sha256 };
