// server.mjs — 零依赖服务器：静态前端 + 存档 API + 排行榜
// 用法：node server.mjs [port]   默认 8080
//
// API（全部同源、JSON）：
//   GET  /api/me                 → { name, rev, hasSave, online }
//   POST /api/name  { name }     → { name }           409 = 重名
//   GET  /api/save               → { rev, save }      404 = 没存档
//   PUT  /api/save  { rev, save }→ { rev }            409 = 版本冲突（客户端重新拉取）
//   GET  /api/board?limit=50     → { rows: [...] }
//   POST /api/board { metrics }  → { ok }
//
// 身份：首次请求下发 HttpOnly cookie `dny_pid`（UUID），不需要账号。
// 存储：data/players/<id>.json（每人一个文件），data/index.json 为排行榜索引（启动时重建）。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const DATA = path.join(root, 'data');
const PLAYERS = path.join(DATA, 'players');
fs.mkdirSync(PLAYERS, { recursive: true });

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

// ───────────────────────── 存档存储 ─────────────────────────
const index = new Map(); // id → { id, name, rev, metrics, updatedAt, won }
const nameOwner = new Map(); // name(小写) → id

function playerFile(id) {
  return path.join(PLAYERS, `${id.slice(0, 2)}_${id.slice(2)}.json`);
}

function loadAll() {
  for (const f of fs.readdirSync(PLAYERS)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PLAYERS, f), 'utf8'));
      if (!p || !p.id) continue;
      index.set(p.id, p);
      if (p.name) nameOwner.set(p.name.toLowerCase(), p.id);
    } catch (e) { /* 跳过坏文件 */ }
  }
  console.log(`已载入 ${index.size} 份玩家存档`);
}

function savePlayer(p) {
  const full = playerFile(p.id);
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p));
  fs.renameSync(tmp, full);
}

const PREFIX = ['奶茶', '深渊', '耶维', '时针', '记忆', '覆灭', '净化', '糖霜', '黑糖', '抹茶', '白夜', '恒温', '夜航', '龙骨', '珍珠', '霜降'];
const SUFFIX = ['学徒', '店主', '骑士', '少女', '旅人', '拾荒者', '观测者', '守夜人', '调度员', '机长'];

function genName() {
  for (let i = 0; i < 200; i++) {
    const pre = PREFIX[crypto.randomInt(PREFIX.length)];
    const suf = SUFFIX[crypto.randomInt(SUFFIX.length)];
    const name = `${pre}${suf}-${String(crypto.randomInt(1000, 9999))}`;
    if (!nameOwner.has(name.toLowerCase())) return name;
  }
  return `无名旅人-${crypto.randomInt(100000, 999999)}`;
}

function badName(name) {
  if (typeof name !== 'string') return '用户名必须是字符串';
  const s = name.trim();
  if (s.length < 2 || s.length > 16) return '用户名长度 2–16 个字符';
  if (/[\u0000-\u001f\u007f<>]/.test(s)) return '用户名含有非法字符';
  return null;
}

// ───────────────────────── HTTP 小工具 ─────────────────────────
function cookieId(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)dny_pid=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function json(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const lastSave = new Map();
const lastBoard = new Map();

function throttled(map, id, ms) {
  const now = Date.now();
  if (now - (map.get(id) || 0) < ms) return true;
  map.set(id, now);
  return false;
}

const NET_METRIC = (v, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
};

// ───────────────────────── API ─────────────────────────
async function handleApi(req, res, urlPath, query) {
  // 身份
  let id = cookieId(req);
  let player = id ? index.get(id) : null;
  const headers = {};
  if (!id || !player) {
    id = id || crypto.randomUUID();
    player = {
      id,
      name: genName(),
      rev: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      save: null,
      metrics: null,
    };
    index.set(id, player);
    nameOwner.set(player.name.toLowerCase(), id);
    savePlayer(player);
    headers['Set-Cookie'] = `dny_pid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=63072000`;
  }

  if (urlPath === '/api/me' && req.method === 'GET') {
    return json(res, 200, { name: player.name, rev: player.rev, hasSave: !!player.save }, headers);
  }

  if (urlPath === '/api/name' && req.method === 'POST') {
    const body = await readBody(req);
    const err = badName(body.name);
    if (err) return json(res, 400, { error: err }, headers);
    const name = body.name.trim();
    const owner = nameOwner.get(name.toLowerCase());
    if (owner && owner !== id) return json(res, 409, { error: '这个名字被占用了' }, headers);
    if (player.name) nameOwner.delete(player.name.toLowerCase());
    player.name = name;
    player.updatedAt = Date.now();
    nameOwner.set(name.toLowerCase(), id);
    savePlayer(player);
    return json(res, 200, { name }, headers);
  }

  if (urlPath === '/api/save' && req.method === 'GET') {
    if (!player.save) return json(res, 404, { error: 'no save' }, headers);
    return json(res, 200, { rev: player.rev, save: player.save, updatedAt: player.updatedAt }, headers);
  }

  if (urlPath === '/api/save' && req.method === 'PUT') {
    if (throttled(lastSave, id, 2000)) return json(res, 429, { error: '太快了' }, headers);
    const body = await readBody(req);
    if (typeof body.save !== 'string' || body.save.length > 400 * 1024) {
      return json(res, 400, { error: 'save 无效或过大' }, headers);
    }
    const rev = Number(body.rev);
    if (!Number.isFinite(rev) || rev !== player.rev) {
      return json(res, 409, { error: '版本冲突', rev: player.rev }, headers);
    }
    player.save = body.save;
    player.rev = rev + 1;
    player.updatedAt = Date.now();
    savePlayer(player);
    return json(res, 200, { rev: player.rev }, headers);
  }

  if (urlPath === '/api/board' && req.method === 'POST') {
    if (throttled(lastBoard, id, 15000)) return json(res, 429, { error: '太快了' }, headers);
    const body = await readBody(req);
    const m = body.metrics || {};
    player.metrics = {
      // V8：tier 0..8（8 = 已进入终局）；purified 是真实力量的 log10，最大到 2.49e9
      tier: NET_METRIC(m.tier, 8),
      purified: Math.max(-1, Math.min(1e10, Number(m.purified) || 0)),
      purifiedExponent: Math.max(-1, Math.min(1e10, Number(m.purifiedExponent) || 0)),
      cycles: NET_METRIC(m.cycles, 1e9),
      guards: NET_METRIC(m.guards, 1e9),
      playTime: NET_METRIC(m.playTime, 1e9),
      won: !!m.won,
      cleared: NET_METRIC(m.cleared, 1e9),
    };
    player.updatedAt = Date.now();
    savePlayer(player);
    return json(res, 200, { ok: true }, headers);
  }

  if (urlPath === '/api/board' && req.method === 'GET') {
    const limit = Math.max(1, Math.min(100, Number(query.get('limit') || 50)));
    const rows = [...index.values()]
      .filter((p) => p.metrics)
      .map((p) => ({
        name: p.name,
        tier: p.metrics.tier,
        purified: p.metrics.purified,
        purifiedExponent: p.metrics.purifiedExponent,
        cycles: p.metrics.cycles,
        guards: p.metrics.guards,
        playTime: p.metrics.playTime,
        won: p.metrics.won,
        updatedAt: p.updatedAt,
      }))
      .sort((a, b) => b.tier - a.tier || b.purified - a.purified || b.cycles - a.cycles)
      .slice(0, limit);
    return json(res, 200, { rows }, headers);
  }

  return json(res, 404, { error: 'no such api' }, headers);
}

// ───────────────────────── 静态文件 ─────────────────────────
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const candidates = [path.join(root, 'web', rel), path.join(root, rel)];
  const send = (idx) => {
    if (idx >= candidates.length) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    const full = path.normalize(candidates[idx]);
    if (!full.startsWith(root) || full.includes(`${path.sep}data${path.sep}`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
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
}

loadAll();

http.createServer((req, res) => {
  const full = req.url || '/';
  const qi = full.indexOf('?');
  const urlPath = decodeURIComponent(qi < 0 ? full : full.slice(0, qi));
  const query = new URLSearchParams(qi < 0 ? '' : full.slice(qi + 1));

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath, query).catch((err) => {
      json(res, 400, { error: err.message || 'bad request' });
    });
    return;
  }
  serveStatic(res, urlPath);
}).listen(port, () => console.log(`龙与耶维城 → http://127.0.0.1:${port}`));
