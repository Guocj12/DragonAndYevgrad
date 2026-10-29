// sim/simulate.mjs — 全流程模拟：从第一层连续推进到八层检查点（可继续到终局）
//
// V8 只有一条基准策略：**八层自动购买科技全 22 级 + 自动结算全开**（数值设计 §1.2）。
// 这里用 Engine 一路 tick 到底，再把每轮的关键数字打出来，方便和 docs/数值设计.md §12 对照。
//
//   node sim/simulate.mjs            # 八层检查点（891127 ticks，约 1 分钟）
//   node sim/simulate.mjs --endgame  # 继续跑到三次终局失败
import { Engine, createInitialState, CHARACTER_ORDER } from '../src/engine.js';
import { CONFIG, forceFromWork } from '../src/v8.js';

export function simulate({ endgameRuns = 0, maxRuns = 400, verbose = true } = {}) {
  const engine = new Engine(createInitialState());
  engine.headless = true;
  for (const id of CHARACTER_ORDER) engine.s.autoBuyLv[id] = 22;
  engine.s.auto.collapse = true;
  engine.s.auto.guard = true;

  const runs = [];
  let runSegs = [], runTicks = 0, stageReached = 0, terminal = 0;
  const t0 = Date.now();
  let guard = 0;
  let done = false;
  while (!done && guard++ < 4e6) {
    const r = engine.tick();
    if (!r) continue;
    stageReached = Math.max(stageReached, r.stage);
    runSegs.push(r);
    runTicks += r.ticks;
    if (!r.win) {
      runs.push({ run: runs.length + 1, time: runTicks * CONFIG.dt, failedStage: r.stage, segments: runSegs });
      runSegs = []; runTicks = 0;
      if (r.stage === 9 && ++terminal >= (endgameRuns || Infinity)) done = true;
    } else if (r.stage === 8) {
      // 八层检查点：不是通关，只是本轮的一个检查点
      runs.push({ run: runs.length + 1, time: runTicks * CONFIG.dt, failedStage: null, segments: runSegs });
      runSegs = []; runTicks = 0;
      if (!endgameRuns) done = true;
    }
    if (runs.length >= maxRuns) done = true;
  }
  const seconds = runs.reduce((s, x) => s + x.time, 0);
  const st = engine.state.stats;
  const result = {
    runs, seconds, engine,
    failures: st.failures.slice(),
    permanent: engine.permanent,
    ticks: st.ticks,
    ms: Date.now() - t0,
  };
  if (verbose) print(result, stageReached);
  return result;
}

function print(r, stageReached) {
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  console.log(`[simulate] ${r.runs.length} 轮 / ${r.ticks} ticks / ${f(r.seconds)}s`
    + `（${f(r.seconds / 3600, 3)} 小时） / 最深第 ${stageReached} 层 —— 耗时 ${(r.ms / 1000).toFixed(1)}s`);
  console.log(`  失败次数 [${r.failures.join(',')}]`);
  console.log(`  F[${r.permanent.failure.join(',')}]  U[${r.permanent.success.join(',')}]  `
    + `WF=${r.permanent.failureWallet}  WS=${r.permanent.successWallet}`);
  console.log('');
  console.log('   轮  最后片段  整轮秒数  片段真实力量');
  for (const run of r.runs) {
    const last = run.segments.at(-1);
    const force = forceFromWork(last.stage, last.peak).toString();
    console.log(`  ${String(run.run).padStart(3)}  ${String(run.failedStage ?? '八层出口').padStart(8)}  `
      + `${f(run.time).padStart(8)}  ${force}`);
  }
  const ledger = r.engine.state.ledger;
  if (ledger && ledger.length) {
    const sum = (kind) => ledger.filter((e) => e.kind === kind).reduce((s, e) => s + e.gained, 0);
    const spent = (kind) => ledger.filter((e) => e.kind === kind).reduce((s, e) => s + e.spent, 0);
    console.log(`\n  账目：失败收入 ${sum('failure')} / 支出 ${spent('failure')}　`
      + `成功收入 ${sum('success')} / 支出 ${spent('success')}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('simulate.mjs')) {
  simulate({ endgameRuns: process.argv.includes('--endgame') ? 3 : 0 });
}
