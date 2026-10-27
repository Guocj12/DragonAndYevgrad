// tools/v5-save-verify.mjs — 存档断点续跑一致性
//
// 口径：把整程在若干个断点处 save() 再 load()，续跑到底，最终状态必须与不间断跑完的一次
// **完全相同**（§9.3：hits / credit / runTicks 都是玩法状态，漏一个就会改结果）。
//
// 用法：node tools/v5-save-verify.mjs

import assert from 'node:assert/strict';
import { Engine, createInitialState } from '../src/engine.js';

// 「基准模式」：自动购买科技全 22 级 + 自动结算开（= 数值设计 §13 的参考配置）
function baselineEngine() {
  const e = new Engine(createInitialState());
  for (const id of ['249', 'yewei', 'baiqi', 'heng']) e.s.autoBuyLv[id] = 22;
  e.s.auto.collapse = true;
  e.s.auto.guard = true;
  return e;
}

function runToEnd(engine, limit = 5e6) {
  let n = 0;
  while (!engine.state.finished && n++ < limit) engine.tick();
  assert.ok(engine.state.finished, '没有跑完');
  return engine;
}

function fingerprint(engine) {
  const s = engine.state;
  const seg = engine.seg;
  return {
    permanent: s.permanent,
    layer: s.layer,
    runTicks: s.runTicks,
    runIndex: s.runIndex,
    finished: s.finished,
    stats: s.stats,
    seg: {
      tickIndex: seg.tickIndex, levels: seg.levels, prices: seg.prices,
      unlocked: seg.unlocked, totals: seg.totals, power: seg.power,
      currency: seg.currency, pressure: seg.pressure, credit: seg.credit,
      hits: seg.hits, burstHits: seg.burstHits,
    },
  };
}

// 基准：一口气跑完
const baseline = runToEnd(baselineEngine());
const expected = fingerprint(baseline);
console.log(`[v5-save-verify] 基准：${baseline.state.stats.runs} 轮 / ${baseline.state.stats.ticks} ticks / `
  + `${(baseline.state.stats.ticks * 0.05).toFixed(1)}s`);

// 断点：片段中途、结算瞬间之后、轮与轮之间
const cutPoints = [1, 123, 5000, 14999, 30000, 100000, 400001, 900000];

for (const cut of cutPoints) {
  const a = baselineEngine();
  let n = 0;
  while (n < cut && !a.state.finished) { a.tick(); n++; }
  const text = a.save();
  const b = Engine.load(text);
  if (!b.state.finished) runToEnd(b);
  assert.deepEqual(fingerprint(b), expected, `断点 ${cut} 续跑结果不一致`);
  console.log(`  断点 ${String(cut).padStart(7)} ticks → load 后跑完，状态与基准完全一致`);
}

// 存档必须是自洽的 JSON，且版本不符要明确拒绝
const bad = JSON.parse(baseline.save());
bad.v = 'v1';
assert.throws(() => Engine.load(JSON.stringify(bad)), (err) => err.code === 'VERSION_MISMATCH');
console.log('[v5-save-verify] 旧版本档被明确拒绝（不静默清零）');
console.log('[v5-save-verify] 全部通过');
