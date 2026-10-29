// tools/v8-verify.mjs — 本实现 src/v8.js vs docs/数值设计.md §14 参考模拟器
//
//   node tools/v8-verify.mjs           全部三段：前四检查点 / 八层检查点 / 终局 3 轮
//   node tools/v8-verify.mjs --four    只跑前四检查点（改代码时先用它快速回归）
//
// 口径：**零容差逐字段**（Object.is / ===）。本实现对参考物的移植是逐句的，任何末位差异
// 都说明有人"优化"了表达式或重排了顺序 —— 直接判失败，不降级成 1e-7。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as mine from '../src/v8.js';

const require = createRequire(import.meta.url);
const ref = require('./v8-reference.cjs');

function deep(a, b, path = '') {
  if (typeof a === 'number' || typeof b === 'number') {
    if (!Object.is(a, b)) throw new Error(`${path || '<root>'}: ${a} !== ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) throw new Error(`${path || '<root>'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) throw new Error(`${path}: array mismatch`);
    if (a.length !== b.length) throw new Error(`${path}: length ${a.length} !== ${b.length}`);
    for (let i = 0; i < a.length; i++) deep(a[i], b[i], `${path}[${i}]`);
    return;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('|') !== kb.join('|')) throw new Error(`${path}: keys ${ka.join('|')} !== ${kb.join('|')}`);
  for (const k of ka) deep(a[k], b[k], `${path}.${k}`);
}

const t = (label, fn) => {
  const t0 = Date.now();
  const out = fn();
  const ms = Date.now() - t0;
  console.log(`  ${label}：${ms} ms`);
  return out;
};

function compare(options, label) {
  const r = t(`参考物 ${label}`, () => ref.campaign(options));
  const m = t(`本实现 ${label}`, () => mine.campaign(options));
  deep(r, m);
  console.log(`  ✓ ${label} 逐字段完全相同（${r.runs.length} 轮）`);
  return r;
}

console.log('[v8-verify] 本实现 vs 文档 §14 参考模拟器（零容差）');

const four = compare({ through: 4 }, '前四检查点');
assert.deepEqual(four.failures.slice(0, 4), [6, 5, 7, 4]);
const fourSeconds = four.runs.reduce((s, x) => s + x.time, 0);
assert(Math.abs(fourSeconds - 15935) < 1e-9, `前四时长 ${fourSeconds}`);
console.log(`  §12.1 前四：失败 [${four.failures.slice(0, 4)}]  ${fourSeconds.toFixed(2)}s`);

if (!process.argv.includes('--four')) {
  const eight = compare({}, '八层检查点');
  assert.deepEqual(eight.failures, [6, 5, 7, 4, 7, 7, 5, 8]);
  assert.equal(eight.runs.length, 50);
  const seconds = eight.runs.reduce((s, x) => s + x.time, 0);
  assert(Math.abs(seconds - 44556.35) < 1e-6, `八层时长 ${seconds}`);
  assert.deepEqual(eight.permanent.failure, [7, 6, 8, 4, 9, 9, 8, 9]);
  assert.deepEqual(eight.permanent.success, [37, 37, 36, 36]);
  assert.equal(eight.permanent.failureWallet, 446103510);
  assert.equal(eight.permanent.successWallet, 88739910);
  console.log(`  §12.1 八层：${eight.runs.length} 轮  ${seconds.toFixed(2)}s  `
    + `F[${eight.permanent.failure}] U[${eight.permanent.success}]  `
    + `WF=${eight.permanent.failureWallet} WS=${eight.permanent.successWallet}`);

  const terminal = compare({ endgameRuns: 3, maxRuns: 100 }, '终局 3 轮');
  const rows = terminal.runs.filter((r) => r.failedStage === 9);
  assert.equal(rows.length, 3);
  console.log(`  §12.6 终局：${rows.map((r) => `${r.time.toFixed(2)}s`).join(' / ')}  `
    + `越标线 ${rows.map((r) => (r.segments.at(-1).crossedEndgameMarker ? '是' : '否')).join('/')}`);
}

console.log('[v8-verify] 全部通过：本实现与文档 §14 逐字段一致。');
