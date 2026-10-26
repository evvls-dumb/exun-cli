'use strict';
// Browser bridge for the local Janus CLI. The browser never accesses the Pi directly;
// the CLI performs acquisition and writes the files on the laptop.
const TOKEN = document.querySelector('meta[name=janus-token]')?.content || '';
const LIVE = /^[0-9a-f]{32}$/.test(TOKEN);
const API = { version: '2.3.0', cwd: '' };
const headers = { 'X-Janus-Token': TOKEN };

async function hello() {
  if (!LIVE) return { offline: true };
  try {
    const response = await fetch('/api/hello', { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    Object.assign(API, await response.json());
    return API;
  } catch (error) {
    return { error: `Local JANUS service unavailable: ${error.message}` };
  }
}

/** Execute the same CLI command the standalone terminal uses. */
function run(args, { ndjson = false, on }) {
  if (!LIVE) {
    queueMicrotask(() => {
      on({ k: 'e', s: 'Open this screen using: node bin/janus.js ui' });
      on({ k: 'x', code: 1 });
    });
    return { stop() {} };
  }

  let events = null;
  let id = null;
  let stopped = false;
  let finished = false;

  const finish = code => {
    if (finished) return;
    finished = true;
    events?.close();
    on({ k: 'x', code });
  };
  const stop = () => {
    stopped = true;
    if (id) fetch('/api/stop', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    }).catch(error => on({ k: 'e', s: `Unable to stop capture: ${error.message}` }));
  };

  fetch('/api/run', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ args, ndjson })
  }).then(async response => {
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error(result.error || `HTTP ${response.status}`);
    id = result.id;
    events = new EventSource(`/api/events?id=${encodeURIComponent(id)}&t=${TOKEN}`);
    events.onmessage = message => {
      const event = JSON.parse(message.data);
      if (event.k === 'x') finish(event.code);
      else on(event);
    };
    events.onerror = () => {
      if (!finished) {
        on({ k: 'e', s: 'Connection to the local JANUS service was lost.' });
        finish(1);
      }
    };
    if (stopped) stop();
  }).catch(error => {
    on({ k: 'e', s: error.message });
    finish(1);
  });

  return { stop };
}

// Saved captures live on the laptop, beside the JANUS CLI. The local server
// restricts browser reads to manifest-listed files inside these folders.
async function savedRequest(route, params = {}) {
  if (!LIVE) throw new Error('Start the local JANUS server to see saved collections');
  const query = new URLSearchParams(params);
  const res = await fetch(`/api/${route}?${query}`, { headers });
  const obj = await res.json();
  if (!res.ok) throw new Error(obj.error || `HTTP ${res.status}`);
  return obj;
}
function savedDownload(id, file) {
  if (!LIVE) return;
  const query = new URLSearchParams({ id, path: file, t: TOKEN });
  const anchor = document.createElement('a');
  anchor.href = `/api/collection/download?${query}`;
  anchor.download = file.split('/').pop();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
