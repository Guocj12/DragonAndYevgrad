// server.mjs — 零依赖静态服务器（本作前端；部署到 2c2g 机器直接 node server.mjs）
// 用法：node server.mjs [port]   默认 8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  // 优先从 web/ 找（前端），找不到再从仓库根找（/src/*.js、/docs 等）
  const candidates = [path.join(root, 'web', rel), path.join(root, rel)];
  const send = (idx) => {
    if (idx >= candidates.length) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    const full = path.normalize(candidates[idx]);
    if (!full.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(full, (err, data) => {
      if (err) { send(idx + 1); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  };
  send(0);
}).listen(port, () => console.log(`龙与耶维城 → http://127.0.0.1:${port}`));
