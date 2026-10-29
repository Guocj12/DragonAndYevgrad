// tools/v8-save-verify.mjs — 存档闸门：断点续跑 == 不间断跑完
//
// 口径来自 §11.3 的「必须保存」清单：永久等级/双钱包、runTicks、片段已执行 tick 数、
// x/h/R、levels/unlocked/totals/prices、credit/hits、energy/residual/lastRelease、
// buffer/emergency/erosion/fatigue。漏一个字段，续跑就会在这些点上分叉。
//
//   node tools/v8-save-verify.mjs
import assert from 'node:assert/strict';
import { Engine, createInitialState, CHARACTER_ORDER } from '../src/engine.js';

const TOTAL_TICKS = 891127;        // §12.1 八层检查点的 tick 数（44556.35s / 0.05）

function baselineEngine() {
  const e = new Engine(createInitialState());
  e.headless = true;
  for (const id of CHARACTER_ORDER) e.s.autoBuyLv[id] = 22;
  e.s.auto.collapse = true;
  e.s.auto.guard = true;
  return e;
}

function fingerprint(e) {
  const s = e.state, seg = e.seg;
  return {
    stage: s.stage, run: s.run, runTicks: s.runTicks,
    permanent: s.permanent,
    stats: {
      playTime: s.stats.playTime, ticks: s.stats.ticks, runs: s.stats.runs,
      guards: s.stats.guards, collapses: s.stats.collapses, endgames: s.stats.endgames,
      failures: s.stats.failures, guardsByStage: s.stats.guardsByStage,
      releases: s.stats.releases, bufferSaved: s.stats.bufferSaved,
      cleared: s.stats.cleared,
    },
    seg: {
      tickIndex: seg.tickIndex, levels: seg.levels, prices: seg.prices,
      unlocked: seg.unlocked, totals: seg.totals,
      power: seg.power, pressure: seg.pressure, wallet: seg.wallet, credit: seg.credit,
      hits: seg.hits, burstHits: seg.hits, purchases: seg.purchases,
      energy: seg.energy, residual: seg.residual, lastRelease: seg.lastRelease,
      releases: seg.releases, releaseTicks: seg.releaseTicks,
      buffer: seg.buffer, emergency: seg.emergency, bufferSpent: seg.bufferSpent,
      erosion: seg.erosion, fatigue: seg.fatigue,
      savedTicks: seg.savedTicks, zeroTicks: seg.zeroTicks, cleared: seg.cleared,
      crossedEndgameMarker: seg.crossedEndgameMarker,
    },
  };
}

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
    if (a.length !== b.length) throw new Error(`${path}: length`);
    for (let i = 0; i < a.length; i++) deep(a[i], b[i], `${path}[${i}]`);
    return;
  }
  for (const k of Object.keys(a).sort()) deep(a[k], b[k], `${path}.${k}`);
}

// ① 不间断跑完
const t0 = Date.now();
const straight = baselineEngine();
while (straight.state.stats.ticks < TOTAL_TICKS) straight.tick();
const straightFp = fingerprint(straight);
console.log(`[v8-save-verify] 不间断跑完 ${TOTAL_TICKS} ticks：${Date.now() - t0}ms`);

// ② 断点续跑：每 25000 tick 一次 save/load，另外每次换层/结算后也存一次
const BREAKS = [];
for (let t = 25000; t < TOTAL_TICKS; t += 25000) BREAKS.push(t);
const breakSet = new Set(BREAKS);

let engine = baselineEngine();
let saves = 0, lastStage = engine.state.stage;
const t1 = Date.now();
while (engine.state.stats.ticks < TOTAL_TICKS) {
  engine.tick();
  const s = engine.state;
  const stageChanged = s.stage !== lastStage;
  lastStage = s.stage;
  if (breakSet.has(s.stats.ticks) || stageChanged) {
    const text = engine.save();
    const reloaded = Engine.load(text);
    reloaded.headless = true;
    // 读回来的引擎必须能继续跑，且状态逐字段一致
    deep(fingerprint(reloaded), fingerprint(engine), `断点 @${s.stats.ticks}`);
    engine = reloaded;
    saves++;
  }
}
const resumedFp = fingerprint(engine);
console.log(`[v8-save-verify] 断点续跑 ${TOTAL_TICKS} ticks：${saves} 次存取，${Date.now() - t1}ms`);
deep(straightFp, resumedFp, 'final');
console.log(`  F=${JSON.stringify(resumedFp.permanent.failure)} U=${JSON.stringify(resumedFp.permanent.success)}`);
console.log(`  WF=${resumedFp.permanent.failureWallet} WS=${resumedFp.permanent.successWallet} `
  + `stage=${resumedFp.stage}（9=终局）`);
console.log('[v8-save-verify] 通过：存档续跑与不间断跑完逐字段一致。');
