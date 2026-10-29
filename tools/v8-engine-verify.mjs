// tools/v8-engine-verify.mjs — 引擎闸门：走 src/engine.js 的真实 tick 循环跑完整程
//
// 与 v8-verify 的分工：
//   v8-verify        比「src/v8.js 的 campaign()」和参考物 —— 证明数值核移植无误
//   v8-engine-verify 比「引擎外壳一个 tick 一个 tick 推」和参考物 —— 证明外壳没有偷偷改数值
//                    （自动购买接线、换层、结算、终局、账目、轮边界全都在这条路径上）
//
// 口径：零容差逐字段。配置 = 八层自动购买科技全 22 级 + 自动结算全开 = 数值设计 §1.2 的基准。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { Engine, createInitialState, CHARACTER_ORDER } from '../src/engine.js';
import { CONFIG } from '../src/v8.js';

const require = createRequire(import.meta.url);
const ref = require('./v8-reference.cjs');

function deep(a, b, path = '') {
  if (typeof a === 'number' || typeof b === 'number') {
    if (!Object.is(a, b)) throw new Error(`${path}: ${a} !== ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
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

console.log('[v8-engine-verify] 引擎 tick 循环 vs 文档 §14 参考模拟器（零容差）');
const t0 = Date.now();
const reference = ref.campaign();
const refSegs = reference.runs.flatMap((r) => r.segments);
const refTicks = refSegs.reduce((sum, s) => sum + s.ticks, 0);

const engine = new Engine(createInitialState());
engine.headless = true;                     // 纯数值模式：剧情不阻塞
for (const id of CHARACTER_ORDER) engine.s.autoBuyLv[id] = 22;
engine.s.auto.collapse = true;
engine.s.auto.guard = true;

const segs = [];
let guard = 0;
while (engine.state.stats.ticks < refTicks && guard++ < 4e6) {
  const r = engine.tick();
  if (r) segs.push(r);
}
const elapsed = Date.now() - t0;

assert.equal(engine.state.stats.ticks, refTicks, '总 tick 数不一致');
assert.equal(segs.length, refSegs.length, `片段数不一致 ${segs.length} !== ${refSegs.length}`);
for (let i = 0; i < segs.length; i++) deep(segs[i], refSegs[i], `seg[${i}]`);

deep(engine.permanent, reference.permanent, 'permanent');
deep(engine.state.stats.failures, reference.failures, 'failures');

// 轮边界：一程内片段 ticks 相加再 ×dt；八层成功是检查点，不算一轮结束
const runTimes = [];
{
  let ticks = 0;
  for (const s of segs) {
    ticks += s.ticks;
    if (!s.win || s.stage === 8) { runTimes.push(ticks * CONFIG.dt); ticks = 0; }
  }
}
const refRunTimes = reference.runs.map((r) => r.time);
deep(runTimes, refRunTimes, 'runTimes');

// 换层顺序：引擎在八层成功后必须进终局（stage 9），且没有通关停机
assert.equal(engine.state.stage, 9, `八层成功后应在终局，实际 stage=${engine.state.stage}`);
// 「轮」= 第一层走到某片段失败；八层成功只是检查点，不结束一轮（§1.2）
const failedRounds = reference.runs.filter((r) => r.failedStage).length;
assert.equal(engine.state.stats.runs, failedRounds, `轮数 ${engine.state.stats.runs} !== ${failedRounds}`);
assert.equal(engine.state.stats.collapses, failedRounds, '覆灭次数应等于失败轮数');

const total = runTimes.reduce((a, b) => a + b, 0);
console.log(`  ✓ 片段 ${segs.length} 段 / ${reference.runs.length} 轮 / 失败 ${JSON.stringify(reference.failures)}`);
console.log(`  F=${JSON.stringify(engine.permanent.failure)} U=${JSON.stringify(engine.permanent.success)}`);
console.log(`  WF=${engine.permanent.failureWallet} WS=${engine.permanent.successWallet}`);
console.log(`  累计 ${total.toFixed(2)}s（${(total / 3600).toFixed(4)} 小时）  tick ${engine.state.stats.ticks}  耗时 ${elapsed}ms`);
console.log(`  当前 stage=${engine.state.stage}（9=终局）  stageName=${engine.view().stageName}`);
console.log('[v8-engine-verify] 通过：外壳没有改数值。');
