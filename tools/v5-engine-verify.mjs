// tools/v5-engine-verify.mjs — 外壳对拍：通过 src/engine.js 的实际 tick 循环跑完整程，
// 与 docs/数值设计.md §13 的参考模拟器逐字段比较（不允许任何容差）。
//
// 用法：node tools/v5-engine-verify.mjs

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { Engine, createInitialState } from '../src/engine.js';
import { CONFIG } from '../src/v5.js';

const require = createRequire(import.meta.url);
const ref = require('./v5-reference.cjs');

function deepEqualExact(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b) && a !== b) throw new Error(`${path}: ${a} !== ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) throw new Error(`${path}: array mismatch`);
    if (a.length !== b.length) throw new Error(`${path}: length ${a.length} !== ${b.length}`);
    for (let i = 0; i < a.length; i++) deepEqualExact(a[i], b[i], `${path}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka.join()} !== ${kb.join()}`);
    for (const k of ka) deepEqualExact(a[k], b[k], `${path}.${k}`);
    return;
  }
  if (a !== b) throw new Error(`${path}: ${a} !== ${b}`);
}

const SEG_FIELDS = [
  'layer', 'win', 'ticks', 'time', 'runTicks', 'peak', 'actualPeak', 'pressure', 'currency',
  'levels', 'unlocked', 'totals', 'hits', 'burstHits', 'salvageTotal', 'removedTotal',
  'purchaseCount', 'purchaseTicks', 'maxPurchaseGap', 'zeroSeconds', 'recovered',
];

const reference = ref.campaign();
const refSegs = reference.runs.flatMap((run) => run.segments);

const t0 = Date.now();
const engine = new Engine(createInitialState());
// 「基准模式」：自动购买科技全部 22 级（= 每 tick 购买最大数量）+ 自动结算开。
// 这才是 docs/数值设计.md §13 参考模拟器对应的配置；游戏默认是 0 级 + 弹窗手动。
for (const id of ['249', 'yewei', 'baiqi', 'heng']) engine.s.autoBuyLv[id] = 22;
engine.s.auto.collapse = true;
engine.s.auto.guard = true;
const segs = [];
let guard = 0;
while (!engine.state.finished && guard++ < 5e6) {
  const r = engine.tick();
  if (r) segs.push(r);
}
const elapsed = Date.now() - t0;

assert.ok(engine.state.finished, '引擎没有跑通');
assert.equal(segs.length, refSegs.length, '片段数不一致');

for (let i = 0; i < segs.length; i++) {
  for (const f of SEG_FIELDS) {
    if (f === 'unlocked') {
      deepEqualExact(segs[i].unlocked.map(Boolean), refSegs[i].unlocked.map(Boolean), `seg[${i}].unlocked`);
    } else {
      deepEqualExact(segs[i][f], refSegs[i][f], `seg[${i}].${f}`);
    }
  }
}

deepEqualExact(engine.permanent, reference.permanent, 'permanent');
deepEqualExact(engine.state.stats.failures, reference.failures, 'failures');
assert.equal(engine.state.stats.runs, reference.runs.length, '轮数不一致');

const totalTime = segs.reduce((sum, s) => sum + s.time, 0);
// 轮时间必须按 §8 的口径算：一程内所有片段 ticks 相加，再 ×dt（不是把片段秒数相加）
const runTimes = [];
{
  let ticks = 0;
  for (const s of segs) {
    ticks += s.ticks;
    if (!s.win || s.layer === 4) { runTimes.push(ticks * CONFIG.dt); ticks = 0; }
  }
}
deepEqualExact(runTimes, reference.runs.map((r) => r.time), 'runTimes');
assert.equal(runTimes.reduce((a, b) => a + b, 0), 14997.2);

console.log('[v5-engine-verify] 引擎逐 tick 跑完整程，与参考模拟器完全一致');
console.log(`  片段 ${segs.length} 段 / ${engine.state.stats.runs} 轮 / 失败 ${JSON.stringify(reference.failures)}`);
console.log(`  F=${JSON.stringify(engine.permanent.failure)} U=${JSON.stringify(engine.permanent.success)}`);
console.log(`  WF=${engine.permanent.failureWallet} WS=${engine.permanent.successWallet}`);
console.log(`  累计 ${runTimes.reduce((a, b) => a + b, 0)}s（${(runTimes.reduce((a, b) => a + b, 0) / 3600).toFixed(4)} 小时）  ${elapsed}ms`);
console.log(`  dt=${CONFIG.dt}s  目标=${JSON.stringify(CONFIG.targets)}  单位=${JSON.stringify(CONFIG.units)}`);
