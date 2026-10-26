'use strict';
// The raw record is preserved as it arrives. Parsed CSV is written incrementally,
// so an unattended capture does not keep hours of samples in RAM.
const { EventEmitter } = require('events');
const { med } = require('./util');

const JSON_NAMES = ['PSU', 'Main', 'Monitor', 'Case'];
const escapeControl = text => text.replace(/[^\x20-\x7e\t]/g, ch =>
  '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
const number = value => {
  if (value == null || value === '' || /^nan$/i.test(String(value))) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = value => Number.isFinite(value) ? String(value) : 'nan';
const isHeader = parts => parts.some(part => /[a-z]/i.test(part.replace(/nan/gi, '')));

class StreamRecorder extends EventEmitter {
  constructor(acq, { name = 'stream', source = '' } = {}) {
    super();
    this.acq = acq;
    this.name = name;
    this.source = source;
    this.lines = 0;
    this.segments = [];
    this.current = null;
    this.log = acq.stream(`${name}.log`, {
      kind: 'stream-log', source,
      note: 'UTC reception timestamp, a tab, then the received line; non-printable bytes are escaped'
    });
  }

  line(raw, when = new Date()) {
    const received = String(raw).replace(/\r$/, '');
    if (!received) return;
    this.log.write(`${when.toISOString()}\t${escapeControl(received)}\n`);
    this.lines++;
    const parsed = this.parse(received);
    this.emit('line', {
      time: when.toISOString(), line: received,
      row: parsed ? parsed.map(value => Number.isFinite(value) ? value : null) : null,
      cols: parsed && this.current ? this.current.header : null
    });
  }

  mark(label = 'mark') {
    const at = new Date().toISOString();
    this.log.write(`${at}\t# MARK ${escapeControl(label)}\n`);
    this.acq.event('marker ' + label);
    this.emit('mark', { time: at, label });
    return at;
  }

  selectHeader(header) {
    if (this.current && this.current.header.join() === header.join()) return;
    const index = this.segments.length + 1;
    const filename = `${this.name}${index > 1 ? '-' + index : ''}.csv`;
    const writer = this.acq.stream(filename, {
      kind: 'readings-csv', source: this.source, derivedFrom: this.log.path,
      note: 'parsed from the raw stream; unavailable measurements are nan'
    });
    writer.write(header.join(',') + '\n');
    this.current = {
      header, writer, count: 0, measured: header.slice(1).map(() => 0),
      min: header.slice(1).map(() => null), max: header.slice(1).map(() => null),
      previousTime: null, deltaSamples: [], gaps: []
    };
    this.segments.push(this.current);
  }

  addRow(row) {
    const segment = this.current;
    if (!segment || row.length !== segment.header.length || !Number.isFinite(row[0])) return null;
    segment.writer.write(row.map(fmt).join(',') + '\n');
    segment.count++;
    row.slice(1).forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      segment.measured[i]++;
      segment.min[i] = segment.min[i] === null ? value : Math.min(segment.min[i], value);
      segment.max[i] = segment.max[i] === null ? value : Math.max(segment.max[i], value);
    });
    if (segment.previousTime !== null) {
      const dt = row[0] - segment.previousTime;
      if (dt > 0) {
        const baseline = segment.deltaSamples.length >= 3 ? med(segment.deltaSamples) : null;
        if (baseline && dt > Math.max(3 * baseline, 2)) {
          if (segment.gaps.length < 30) segment.gaps.push(`gap of ${dt.toFixed(1)} s in the readings before t=${row[0]}.`);
        }
        segment.deltaSamples.push(dt);
        if (segment.deltaSamples.length > 64) segment.deltaSamples.shift();
      }
    }
    segment.previousTime = row[0];
    return row;
  }

  parse(raw) {
    if (raw.startsWith('#')) return null;
    if (raw.startsWith('{')) {
      let payload;
      try { payload = JSON.parse(raw); } catch { return null; }
      if (!Array.isArray(payload.T)) return null;
      const header = ['t_s', ...payload.T.map((_, i) => JSON_NAMES[i] || `T${i}`), 'V', 'I_A'];
      this.selectHeader(header);
      const previous = this.current.previousTime;
      const row = [previous == null ? 0 : previous + 0.5,
        ...payload.T.map(value => number(value) <= -100 ? NaN : number(value)),
        number(payload.v), number(payload.i)];
      return this.addRow(row);
    }
    const parts = raw.split(',').map(value => value.trim());
    if (parts.length >= 2 && isHeader(parts)) { this.selectHeader(parts); return null; }
    return this.addRow(parts.map(number));
  }

  async end() {
    const raw = await this.log.end();
    const csv = [], columns = [], notes = [];
    for (let index = 0; index < this.segments.length; index++) {
      const segment = this.segments[index];
      const csvItem = await segment.writer.end();
      if (segment.count) csv.push(csvItem);
      segment.header.slice(1).forEach((name, i) => {
        const measured = segment.measured[i], missing = segment.count - measured;
        columns.push({ segment: index + 1, name, samples: segment.count,
          measured, missing, min: segment.min[i], max: segment.max[i] });
        if (segment.count && !measured) notes.push(`"${name}" reported no value in ${segment.count} samples (nan). It was not measured; it is not zero.`);
        else if (missing) notes.push(`"${name}" is missing in ${missing} of ${segment.count} samples.`);
      });
      notes.push(...segment.gaps);
    }
    notes.forEach(note => this.acq.warn(note));
    return { lines: this.lines, log: raw, csv, columns, notes };
  }
}
module.exports = { StreamRecorder };
