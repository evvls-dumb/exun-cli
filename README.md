# exun-cli
Requirements: Raspberry Pi 5, Windows laptop, Ethernet connection, Python 3 on the Pi, and Node.js on Windows.

1. Raspberry Pi (Having Ubuntu OS)

Connect the Raspberry Pi to your laptop using Ethernet.

Ensure the Raspberry Pi Ethernet IP is 192.168.50.2.

Open the Pi terminal and run:

mkdir -p ~/logs
python3 ~/pi/razor_probe.py --builtin --serial '' --http 8080 --files-dir ~/logs

Keep this terminal running. It provides telemetry, diagnostics, system logs, and access to shared files.

2. Windows Laptop

Open Command Prompt in the JANUS project folder containing bin\janus.js.

Run:

node bin\janus.js ui

Open your browser:

http://127.0.0.1:7777

The JANUS Game Boy interface should appear.

3. Connect and Extract

Open TERMINAL inside the Game Boy.

Press A to see the available commands and their descriptions.

Check the Raspberry Pi connection:

pcb check 192.168.50.2

Perform a complete 30-second extraction:

pcb all 192.168.50.2 --seconds 30

JANUS collects available telemetry, system diagnostics, logs, and files from the Pi's shared ~/logs directory.

4. View Results

Open COLLECTION HISTORY in the Game Boy to:

View previously saved acquisitions.

Inspect temperature and voltage graphs.

Read extracted logs.

Download collected files.

Verify acquisition integrity.

5. Troubleshooting

Connection failed: On Windows, run:

ping 192.168.50.2

Server unavailable: Ensure razor_probe.py is still running on the Raspberry Pi.

Game Boy won't open: Check that Node.js is installed and port 7777 isn't occupied by another JANUS instance.

To stop: Press Ctrl+C in the relevant terminal after your extraction finishes.

Connection summary

Raspberry Pi server: 192.168.50.2:8080

Windows JANUS interface: 127.0.0.1:7777

Pi script: ~/pi/razor_probe.py

Pi shared files: ~/logs
