#!/usr/bin/env python3
"""Janus probe for Raspberry Pi.

Reads up to 4+ DS18B20 temperature sensors (1-wire) and an INA219 (I2C) for
voltage and current, then streams one CSV line per second:

    t_s,Board,PSU,Air,Ambient,V,I_A

Outputs (all optional, all at once is fine):
  --serial /dev/ttyGS0   USB gadget serial: the wire to the laptop
  --http 8080            http://<pi>:8080/stream  (Server-Sent Events)
  stdout                 always, so you can watch it in a terminal

No external sensors? --builtin uses the Pi's own CPU temperature (real) and power
(real on a Pi 5, estimated from CPU load on older Pis). Or --sim idle|load|ghost for fake logs.
Needs: python3 and (for real sensors) `pip install smbus2`.
"""
import argparse, glob, math, os, random, re, subprocess, sys, threading, time, json, urllib.parse, pathlib, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAN = float("nan")


def read_ds18b20():
    vals = []
    for d in sorted(glob.glob("/sys/bus/w1/devices/28-*")):
        try:
            a, b = open(d + "/w1_slave").read().splitlines()[:2]
            vals.append(int(b.split("t=")[1]) / 1000.0 if a.endswith("YES") else NAN)
        except Exception:
            vals.append(NAN)
    return vals


def vcgen(*args):
    try:
        return subprocess.check_output(["vcgencmd", *args], text=True, timeout=2)
    except Exception:
        return ""


class Builtin:
    """The Pi's own sensors, no wiring.
    Real:      CPU temperature (always); on a Pi 5 also real input voltage and current from the PMIC.
    Estimated: on a Pi 4 / Zero 2 W the current is guessed from CPU load at a nominal 5 V."""

    def __init__(self):
        self.pmic = bool(vcgen("pmic_read_adc").strip())
        self.prev = self._stat()
        if not self.pmic:
            print("# built-in mode: current is ESTIMATED from CPU load (5 V assumed), CPU temperature is real",
                  file=sys.stderr)

    @staticmethod
    def _stat():
        p = [int(x) for x in open("/proc/stat").readline().split()[1:]]
        return sum(p), p[3] + p[4]

    def load(self):
        t, i = self._stat(); pt, pi = self.prev; self.prev = (t, i)
        return max(0.0, min(1.0, 1 - (i - pi) / (t - pt))) if t > pt else 0.0

    def read(self):
        try:
            temp = int(open("/sys/class/thermal/thermal_zone0/temp").read()) / 1000.0
        except Exception:
            temp = NAN
        ld = self.load()
        if self.pmic:
            volts, amps = {}, {}
            for line in vcgen("pmic_read_adc").splitlines():
                m = re.match(r"\s*(\S+)_([AV])\s+(?:current|volt)\(\d+\)=([-\d.]+)", line)
                if m: (volts if m.group(2) == "V" else amps)[m.group(1)] = float(m.group(3))
            vin = volts.get("EXT5V", NAN)
            # PMIC rail currents are not equivalent to total input current.
            return [temp], vin, NAN
        return [temp], NAN, NAN



def pi_diagnostics():
    """Read-only OS telemetry. Missing values remain null, never inferred."""
    def read(path):
        try: return pathlib.Path(path).read_text(errors="replace").strip()
        except (OSError, ValueError): return None
    def number(path, divisor=1):
        try: return round(float(read(path))/divisor, 4)
        except (TypeError, ValueError, ZeroDivisionError): return None
    thermal = {}
    for zone in glob.glob('/sys/class/thermal/thermal_zone*'):
        label = read(zone+'/type') or pathlib.Path(zone).name
        thermal[label] = number(zone+'/temp', 1000)
    frequency = {}
    for cpu in glob.glob('/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq'):
        frequency[pathlib.Path(cpu).parents[1].name] = number(cpu, 1000)
    try:
        uptime = float((read('/proc/uptime') or '').split()[0])
    except (ValueError, IndexError): uptime = None
    memory = {}
    for line in (read('/proc/meminfo') or '').splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            if k in ('MemTotal','MemAvailable','SwapTotal','SwapFree'):
                try: memory[k+'_kB'] = int(v.strip().split()[0])
                except (ValueError, IndexError): pass
    pmic = vcgen('pmic_read_adc')
    throttled = vcgen('get_throttled').strip() or None
    return {'timestamp': time.time(), 'model': read('/proc/device-tree/model'),
            'hostname': read('/etc/hostname'), 'cpu_temperature_c': number('/sys/class/thermal/thermal_zone0/temp',1000),
            'thermal_zones_c':thermal, 'cpu_frequency_mhz':frequency, 'uptime_seconds':uptime,
            'load_average':list(os.getloadavg()), 'memory':memory,
            'throttled_raw':throttled, 'pmic_adc_raw':pmic.strip() or None,
            'voltage_note':'PMIC rails, if present, are not necessarily board input voltage',
            'current_note':'PMIC rail current is not total board input current; unavailable values are not estimated',
            'kernel':read('/proc/version'), 'network':read('/proc/net/dev'),
            'diskstats':read('/proc/diskstats')}


def read_system_logs(logroot, requested, lines=150):
    allowed = {'syslog','kern.log','messages','daemon.log','auth.log','dpkg.log','boot.log'}
    if requested == 'journal':
        try:
            r = subprocess.run(['journalctl','--no-pager','-n',str(min(lines,500)),'--output=short-iso'],
                               capture_output=True,text=True,timeout=5)
            return {'source':'journal','text':r.stdout[-100000:], 'error':r.stderr.strip() if r.returncode else None}
        except (OSError, subprocess.TimeoutExpired) as e: return {'source':'journal','error':str(e),'text':''}
    if requested not in allowed: raise ValueError('Log not allowlisted')
    target = (logroot/requested).resolve()
    if not target.is_relative_to(logroot) or not target.is_file():
        raise FileNotFoundError(requested)
    # Tail without loading entire potentially large log into memory.
    from collections import deque
    with target.open('r',encoding='utf-8',errors='replace') as stream:
        tail = deque(stream, maxlen=min(lines,500))
    return {'source':requested,'text':''.join(tail)[-100000:]}

class INA219:
    """Minimal INA219 driver. Measures a DC rail up to 26 V and 3.2 A (0.1 ohm shunt)."""

    def __init__(self, bus=1, addr=0x40, shunt=0.1):
        from smbus2 import SMBus
        self.b, self.a, self.lsb = SMBus(bus), addr, 0.0001
        self._w(0x05, int(0.04096 / (self.lsb * shunt)))

    def _w(self, reg, v):
        self.b.write_word_data(self.a, reg, ((v & 0xFF) << 8) | (v >> 8))

    def _r(self, reg):
        v = self.b.read_word_data(self.a, reg)
        return ((v & 0xFF) << 8) | (v >> 8)

    def volts(self):
        return (self._r(0x02) >> 3) * 0.004

    def amps(self):
        v = self._r(0x04)
        return (v - 65536 if v > 32767 else v) * self.lsb


class Sim:
    """Fake probe so you can test the wire and the app before any sensors arrive."""

    def __init__(self, kind, n):
        self.kind, self.n, self.t0 = kind, n, time.time()
        self.base = [38, 41, 29, 24][:n] + [25] * max(0, n - 4)
        self.y = list(self.base)

    def read(self, event_after=60):
        t = time.time() - self.t0
        k = t - event_after
        cur, tg, tau = 0.5, list(self.base), [40, 60, 90, 1e9]
        if self.kind == "load" and 0 <= k < 120:
            tg[0] += 6; tg[1] += 4; tg[2] += 1.5; cur = 3.0
        if self.kind == "ghost" and 0 <= k < 40:
            tg[0] += 18; tg[1] += 2; tg[2] += 4; tau = [8, 60, 90, 1e9]
        self.y = [v + (g - v) / tau[i % 4] for i, (v, g) in enumerate(zip(self.y, tg))]
        temps = [v + random.uniform(-.15, .15) for v in self.y]
        return temps, 12.0 - (cur - .5) * .08 + random.uniform(-.01, .01), cur + random.uniform(-.01, .01)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", default="/dev/ttyGS0", help="USB gadget serial device ('' to disable)")
    ap.add_argument("--http", type=int, default=8080, help="HTTP stream port (0 to disable)")
    ap.add_argument("--names", default="Board,PSU,Air,Ambient", help="labels for the sensors, in 1-wire id order")
    ap.add_argument("--hz", type=float, default=1.0)
    ap.add_argument("--sim", choices=["idle", "load", "ghost"], help="no hardware: simulate")
    ap.add_argument("--builtin", action="store_true", help="no extra sensors: use the Pi's own CPU temperature and available input voltage")
    ap.add_argument("--logs-dir", default="/var/log", help="Pi system logs directory (allowlisted log names only)")
    ap.add_argument("--files-dir", default="", help="optional read-only directory to expose over Ethernet")
    ap.add_argument("--no-ina", action="store_true", help="temperature only, send V and I as 0")
    a = ap.parse_args()

    names = ["CPU"] if a.builtin else [s.strip() for s in a.names.split(",")]
    header = "t_s," + ",".join(names) + ",V,I_A"
    ina = None
    if not a.sim and not a.builtin and not a.no_ina:
        try:
            ina = INA219()
        except Exception as e:
            sys.exit(f"INA219 not found on I2C ({e}). Check wiring, or use --no-ina / --sim.")
    sim = Sim(a.sim, len(names)) if a.sim else None
    bi = Builtin() if a.builtin and not a.sim else None

    ser = None
    if a.serial:
        try:
            ser = open(a.serial, "w", buffering=1)
        except Exception as e:
            print(f"# serial {a.serial} unavailable ({e}); continuing without USB", file=sys.stderr)

    clients, lock, latest = [], threading.Lock(), {"h": header}

    files_root = pathlib.Path(a.files_dir).expanduser().resolve() if a.files_dir else None
    if files_root and not files_root.is_dir():
        ap.error("--files-dir must be an existing directory")

    logs_root = pathlib.Path(a.logs_dir).expanduser().resolve()

    if a.http:
        class H(BaseHTTPRequestHandler):
            def log_message(self, *x): pass
            def do_GET(self):
                url = urllib.parse.urlsplit(self.path)
                if url.path in ("/metrics", "/logs", "/logs/list"):
                    try:
                        if url.path == "/metrics": data = pi_diagnostics()
                        elif url.path == "/logs/list":
                            data = {'available':[x for x in ('syslog','kern.log','messages','daemon.log','auth.log','dpkg.log','boot.log') if (logs_root/x).is_file()], 'journal':'journalctl (if permitted)'}
                        else:
                            q=urllib.parse.parse_qs(url.query)
                            data=read_system_logs(logs_root,q.get('name',['journal'])[0],int(q.get('lines',['150'])[0]))
                        payload=json.dumps(data).encode()
                        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','*');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
                    except (OSError,ValueError) as e: self.send_error(400,str(e))
                    return
                if url.path == "/files":
                    if files_root is None:
                        self.send_error(404, "File access disabled"); return
                    rel = urllib.parse.parse_qs(url.query).get("path", [""])[0]
                    target = (files_root / rel).resolve()
                    if not target.is_relative_to(files_root):
                        self.send_error(403); return
                    if target.is_dir():
                        entries = [{"name": x.name, "directory": x.is_dir(), "path": str(x.relative_to(files_root))} for x in sorted(target.iterdir()) if not x.is_symlink() and not x.name.startswith(".")]
                        data = json.dumps(entries).encode()
                        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
                    if not target.is_file():
                        self.send_error(404); return
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
                    self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(target.name))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Content-Length", str(target.stat().st_size))
                    self.end_headers()
                    with target.open("rb") as f:
                        while chunk := f.read(65536): self.wfile.write(chunk)
                    return
                if url.path != "/stream":
                    self.send_response(404); self.end_headers(); return
                self.send_response(200)
                for k, v in (("Content-Type", "text/event-stream"), ("Cache-Control", "no-cache"),
                             ("Access-Control-Allow-Origin", "*")):
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(f"data: {latest['h']}\n\n".encode()); self.wfile.flush()
                with lock: clients.append(self.wfile)
                while True: time.sleep(3600)
        threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", a.http), H).serve_forever, daemon=True).start()

    def emit(line):
        if ser:
            try: ser.write(line + "\n")
            except Exception: pass
        print(line, flush=True)
        with lock:
            for w in list(clients):
                try: w.write(f"data: {line}\n\n".encode()); w.flush()
                except Exception: clients.remove(w)

    t0, last_hdr = time.time(), 0
    while True:
        now = time.time()
        if now - last_hdr > 10:  # repeat header so a late-connecting laptop still learns the columns
            emit(header); last_hdr = now
        if sim:
            temps, v, i = sim.read()
        elif bi:
            temps, v, i = bi.read()
        else:
            temps = read_ds18b20()
            v, i = (ina.volts(), ina.amps()) if ina else (0.0, 0.0)
        temps = (temps + [NAN] * len(names))[:len(names)]
        f = lambda x: "nan" if (isinstance(x, float) and math.isnan(x)) else f"{x:.3f}"
        emit(f"{now - t0:.1f}," + ",".join(f(x) for x in temps) + f",{v:.3f},{i:.4f}")
        time.sleep(max(0, 1 / a.hz - (time.time() - now)))


if __name__ == "__main__":
    main()
