// sim/simulate.mjs — 全流程模拟：跑一整程（第一层 → 覆灭 / 第四层成功）
//
// V5 之后只有一种购买策略：**全局最便宜优先，每 tick 反复购买直到买不起**（数值设计 §1
// 冻结版基准）。所以这里没有"机器人"可调，simulate 就是把 Engine 一路 tick 到底，
// 再把每轮/每档的账目整理出来。结果必须与 docs/数值设计.md §10.2 的表一致。
//
// 用法：node sim/simulate.mjs [maxHours]

import { Engine, createInitialState } from '../src/engine.js';
import { CONFIG, snapshot } from '../src/v5.js';

const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export function simulate({ maxHours = 12 } = {}) {
  const engine = new Engine(createInitialState());
  const limit = Math.floor((maxHours * 3600) / CONFIG.dt);
  const runs = [];
  const segments = [];
  let ticks = 0, runSegs = [];
  let guard = 0;
  while (!engine.state.finished && guard++ < limit) {
    const r = engine.tick();
    if (!r) continue;
    segments.push(r);
    ticks += r.ticks;
    runSegs.push(r);
    if (!r.win || r.layer === 4) {
      runs.push({
        run: runs.length + 1,
        time: ticks * CONFIG.dt,
        failedLayer: r.win ? null : r.layer,
        complete: r.win && r.layer === 4,
        segments: runSegs,
        after: snapshot(engine.state.permanent),
        wallets: { mp: engine.state.permanent.failureWallet, pp: engine.state.permanent.successWallet },
      });
      ticks = 0;
      runSegs = [];
    }
  }
  const s = engine.state;
  return {
    finished: s.finished,
    seconds: runs.reduce((a, r) => a + r.time, 0),
    runs,
    failures: s.stats.failures.slice(),
    permanent: snapshot(s.permanent),
    stats: s.stats,
  };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.mjs')) {
  const maxHours = Number(process.argv[2] || 12);
  const r = simulate({ maxHours });
  console.log('轮 | 结局        | 整轮秒数 | 最后实际力量 | 结算后 F / U        | 失败余额 / 成功余额');
  console.log('---|-------------|---------:|-------------:|---------------------|--------------------');
  for (const run of r.runs) {
    const last = run.segments.at(-1);
    const p = run.after;
    console.log(
      `${String(run.run).padStart(2)} | ${String(run.complete ? '4层成功' : `${run.failedLayer}层失败`).padEnd(11)} `
      + `| ${f(run.time).padStart(8)} | ${f(last.actualPeak, 6).padStart(12)} `
      + `| F[${p.failure}] / U[${p.success}] | ${p.failureWallet} / ${p.successWallet}`,
    );
  }
  console.log('');
  console.log(`失败次数：${JSON.stringify(r.failures)}`);
  console.log(`轮数：${r.runs.length}  累计：${f(r.seconds)}s（${f(r.seconds / 3600)} 小时）`);
  console.log(`最终失败等级：F[${r.permanent.failure}]  最终成功等级：U[${r.permanent.success}]`);
  console.log(`最终余额：失败 ${r.permanent.failureWallet} / 成功 ${r.permanent.successWallet}`);
  console.log(`通关：${r.finished ? '是' : '否（超过 maxHours）'}`);
}
