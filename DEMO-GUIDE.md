# JANUS Arcade PCB — demonstration runbook

## Prepare before visitors arrive

1. Connect Pi 5 power and Ethernet through your USB Ethernet adapter. Keep monitor/keyboard detached after initial setup.
2. Ensure the Pi uses `192.168.50.2/24` on Ethernet; the Windows Ethernet adapter uses `192.168.50.1/24`.
3. Configure SSH and systemd once from the Pi terminal, if you need truly headless operation. Verify the Pi Python probe is already accessible on TCP 8080.
4. Do **not** open your fictional `demo-assets/logs.janus` as if it were a live device record. If you display it, say it is fictional historical material.
5. Start the Game Boy UI from Windows with `node bin/janus.js ui` and verify it opens at `http://127.0.0.1:7777`.

## Five-minute live demonstration

- **00:00 — Arcade PCB.** Show the powered headless Raspberry Pi and the Ethernet cable to the laptop. Explain no external instruments are needed for CPU temperature, memory, thermal flags and available board diagnostics.
- **00:45 — JANUS handheld.** Open the original Game Boy interface. Highlight EXTRACT, TERMINAL and COLLECTION HISTORY; press **A** in the terminal for the real CLI command deck.
- **01:30 — Connect.** Run `pcb check 192.168.50.2`. Read out Telemetry / System logs / Shared files statuses honestly; a log endpoint may be permission-limited.
- **02:15 — Collect.** Run `pcb all 192.168.50.2 --seconds 15 -o demo-live-001` in the handheld. Explain that actual readings arrive via HTTP and are written to disk. If it already exists, choose a new output name.
- **03:15 — Investigate.** Open COLLECTION HISTORY → `demo-live-001`. Show the graph of recorded CPU temperature, any available voltage, live Pi system logs and files copied from `~/logs`. Discuss unavailable current as N/A, not zero.
- **04:00 — Verification.** Run `verify demo-live-001` and show that its SHA-256 item hashes and event chain verify. Explain that a saved external chain head is needed to detect replacement of the entire manifest and history.
- **04:40 — Offline evidence.** Disconnect Ethernet only after recording ends; reopen Collection History and show the saved acquisition still exists. Reconnect before taking another capture.

## Enable headless auto-start (one-time setup on Ubuntu Pi)

Create `/etc/systemd/system/janus.service`:

```ini
[Unit]
Description=JANUS Raspberry Pi telemetry
After=network.target

[Service]
Type=simple
User=arnav
WorkingDirectory=/home/arnav/pi
ExecStart=/usr/bin/python3 /home/arnav/pi/razor_probe.py --builtin --serial "" --http 8080 --files-dir /home/arnav/logs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then on the Pi: `sudo systemctl daemon-reload && sudo systemctl enable --now janus.service`. Stop any manually running probe first so port 8080 isn't already occupied. Check `sudo systemctl status janus.service`. To enable SSH on Ubuntu if needed: `sudo apt install openssh-server && sudo systemctl enable --now ssh`.

## Troubleshooting

- `ping 192.168.50.2` works but `pcb check` fails: Pi server not running, or TCP 8080 not accessible.
- `ssh` refused: enable/install OpenSSH server on the Pi using a local console; Windows `sudo` won't configure Ubuntu.
- `MODULE_NOT_FOUND`: run the CLI from the actual JANUS folder containing `bin/janus.js`; the merged `bin/janus.js` uses `lib/pi.js`.
- No logs: `journalctl` and `/var/log` read permissions depend on Ubuntu configuration.
- Current or power shows N/A: Pi 5 PMIC rail readings do not necessarily measure total cabinet input current.
