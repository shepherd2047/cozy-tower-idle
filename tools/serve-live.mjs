// Phone server for tools/live (the newest good build) on the Tailscale IP.
// Sends Cache-Control: no-cache + ETag so the phone re-checks every file on load: asset files keep their names
// across builds (uuid-based), so plain caching mixed an old font texture with a new glyph map.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'C:/Users/mu/Desktop/New folder/tower-wizard-cocos/tools/live';
const HOST = process.env.HOST || '100.112.18.18', PORT = +(process.env.PORT || 8140);
const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript', json: 'application/json', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', wasm: 'application/wasm', bin: 'application/octet-stream', ico: 'image/x-icon' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(path.resolve(ROOT)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const st = fs.statSync(file), etag = '"' + crypto.createHash('md5').update(st.size + ':' + st.mtimeMs).digest('hex') + '"';
  const headers = { 'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers); fs.createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => console.log(`serving ${ROOT} on http://${HOST}:${PORT} (no-cache + ETag)`));
