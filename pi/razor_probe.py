#!/usr/bin/env python3
"""Janus probe for RPI.
 streams one CSV line per second:

    t_s,Board,PSU,Air,Ambient,V,I_A

Outputs (all optional, all at once is fine):
  --serial /dev/ttyGS0   USB gadget serial: the wire to the laptop
  --http 8080            http://<pi>:8080/stream  (Server-Sent Events)
  stdout                 always, so you can watch it in a terminal

 --builtin uses the Pi's own CPU temperature (real) and power --> compulsory for running
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
