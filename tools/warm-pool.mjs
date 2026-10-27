// Warm browser pool: one Chrome with POOL tabs, each already loaded on the latest good build snapshot.
// Tests lease a ready tab (game already loaded, fresh state), run, and release; the pool wipes and reloads
// the tab in the background so the next lease is instant again. Snapshot files are served from disk.
// Started by the coordinator next to build-daemon.ps1.  Lease API (http://127.0.0.1:9556):
//   GET /lease          -> { id, ws, url }   (waits until a tab is ready on the newest good snapshot)
//   GET /release?id=..  -> {}                (tab is wiped + reloaded in the background)
//   GET /status         -> pool state
// cdp.mjs uses this automatically when the pool is up (set COLD=1 to force a private browser).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PROJ = 'C:/Users/mu/Desktop/New folder/tower-wizard-cocos';
const SNAPS = path.join(PROJ, 'tools/snapshots');
const STATUS = path.join(PROJ, 'BUILD_STATUS.json');
const POOL = +(process.env.POOL || 3), CDP = 9555, API = 9556;
const profile = path.join(PROJ, 'tools/warm-profile');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { html: 'text/html', js: 'application/javascript', json: 'application/json', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', wasm: 'application/wasm', bin: 'application/octet-stream' };
const READY = `(() => { const cc = window.cc; const sc = cc && cc.director && cc.director.getScene(); const cv = sc && sc.getChildByName('Canvas'); const g = cv && cv.components.find(c => cc.js.getClassName(c) === 'TowerWizardGame'); return !!(g && g.ready); })()`;

const latestUrl = () => { try { return JSON.parse(fs.readFileSync(STATUS, 'utf8').replace(/^\uFEFF/, '')).lastGoodUrl || null; } catch { return null; } };

fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--window-position=-3000,0', '--disable-extensions', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', '--window-size=800,900', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
for (let i = 0; i < 100; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }

class Tab {
  constructor(id, ws) { this.id = id; this.wsUrl = ws; this.state = 'loading'; this.url = null; this.n = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl); await new Promise(r => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Fetch.requestPaused') this.serve(m.params);
    });
    await this.send('Page.enable'); await this.send('Runtime.enable');
    await this.send('Fetch.enable', { patterns: [{ urlPattern: 'http://127.0.0.1:8150/*', requestStage: 'Request' }] });
    await this.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  send(method, params = {}) { return new Promise(r => { const i = ++this.n; this.pending.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  serve(p) {
    const u = new URL(p.request.url);
    let file = path.join(SNAPS, decodeURIComponent(u.pathname)); if (u.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) this.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: MIME[file.split('.').pop().toLowerCase()] || 'application/octet-stream' }], body: fs.readFileSync(file).toString('base64') });
    else this.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, responseHeaders: [], body: '' });
  }
  async load(url) {
    this.state = 'loading'; this.url = url;
    await this.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:8150', storageTypes: 'local_storage,indexeddb,cache_storage,service_workers' });
    await this.send('Page.navigate', { url });
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await this.send('Runtime.evaluate', { expression: READY, returnByValue: true });
      if (r.result?.result?.value) { this.state = 'ready'; this.readyMs = Date.now() - t0; return; }
      await sleep(300);
    }
    this.state = 'broken';
  }
}

// each tab gets its own window: a background tab in a shared window is frozen by Chrome and the game never loads
const browserWs = new WebSocket((await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise(r => browserWs.addEventListener('open', r));
let bn = 0; const bpending = new Map();
browserWs.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && bpending.has(m.id)) { bpending.get(m.id)(m); bpending.delete(m.id); } });
const bsend = (method, params = {}) => new Promise(r => { const i = ++bn; bpending.set(i, r); browserWs.send(JSON.stringify({ id: i, method, params })); });
const tabs = [];
for (let i = 0; i < POOL; i++) {
  const { result } = await bsend('Target.createTarget', { url: 'about:blank', newWindow: true, background: true });
  // keep the window off-screen so it never pops up on the user's desktop (but not minimized: minimized windows freeze)
  const win = await bsend('Browser.getWindowForTarget', { targetId: result.targetId });
  if (win.result) await bsend('Browser.setWindowBounds', { windowId: win.result.windowId, bounds: { left: -3000, top: 0, width: 800, height: 900, windowState: 'normal' } });
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const t = list.find(x => x.id === result.targetId);
  const tab = new Tab(t.id, t.webSocketDebuggerUrl); await tab.connect(); tabs.push(tab);
}
const refresh = tab => { const u = latestUrl(); if (u) tab.load(u + '?warm=' + Date.now()).catch(() => { tab.state = 'broken'; }); else tab.state = 'idle-nobuild'; };
tabs.forEach(refresh);

// keep tabs on the newest good snapshot; reload idle tabs as soon as a new one appears
let current = latestUrl();
setInterval(() => {
  const u = latestUrl();
  for (const t of tabs) if ((t.state === 'broken' || t.state === 'idle-nobuild') || (u !== current && t.state === 'ready')) refresh(t);
  current = u;
}, 3000);

const waiters = [];
setInterval(() => {
  while (waiters.length) {
    const t = tabs.find(x => x.state === 'ready' && x.url && current && x.url.startsWith(current));
    if (!t) break;
    t.state = 'leased'; t.leasedAt = Date.now(); waiters.shift()(t);
  }
  for (const t of tabs) if (t.state === 'leased' && Date.now() - t.leasedAt > 15 * 60000) refresh(t);   // abandoned lease
}, 100);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname === '/lease') {
    const t = await new Promise(r => waiters.push(r));
    res.end(JSON.stringify({ id: t.id, ws: t.wsUrl, url: t.url, readyMs: t.readyMs }));
  } else if (u.pathname === '/release') {
    const t = tabs.find(x => x.id === u.searchParams.get('id')); if (t) refresh(t);
    res.end('{}');
  } else res.end(JSON.stringify({ current, waiting: waiters.length, tabs: tabs.map(t => ({ id: t.id.slice(0, 6), state: t.state, readyMs: t.readyMs, url: t.url })) }));
}).listen(API, '127.0.0.1');
console.log(`warm pool: ${POOL} tabs, API http://127.0.0.1:${API}/status`);
