// sim/probe.mjs — 单次轨迹探针：每 5 秒打一行当前片段的关键量
//
// 用法：node sim/probe.mjs [maxSeconds]

import { Engine, createInitialState } from '../src/engine.js';
import { CONFIG } from '../src/v5.js';

const maxSeconds = Number(process.argv[2] || 600);
const engine = new Engine(createInitialState());
const limit = Math.floor(maxSeconds / CONFIG.dt);
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

let lastPrint = -1;
let segments = 0;
const t0 = Date.now();
for (let n = 0; n < limit && !engine.state.finished; n++) {
  const r = engine.tick();
  if (r) {
    segments++;
    const v = engine.view();
    console.log(`[${r.win ? '守护' : '覆灭'}] 档${r.layer} run#${engine.state.stats.runs} `
      + `片段 ${f(r.time)}s 峰值 ${f(r.actualPeak, 4)} 压力 ${f(r.pressure, 4)} `
      + `购买 ${r.purchaseCount} 次 hits=${r.hits} F[${engine.permanent.failure}] U[${engine.permanent.success}]`);
    lastPrint = -1;
    continue;
  }
  const sec = Math.floor(engine.state.stats.playTime / 5) * 5;
  if (sec !== lastPrint && sec <= maxSeconds) {
    lastPrint = sec;
    const v = engine.view();
    const e = v.effects;
    console.log(
      `t=${String(sec).padStart(5)}s 档${v.layer} 净化力 ${f(v.powerDisplay, 4).padStart(10)}/${f(v.target, 3)} `
      + `深渊 ${f(v.pressureDisplay, 4).padStart(10)} (压迫 ${f(v.pressureRatio, 2)}) `
      + `mtc ${f(v.currencyDisplay, 3).padStart(10)} `
      + `P ${f(e.production, 4)} eta ${f(e.conversion, 3)} first ${f(e.first, 2)}`,
    );
  }
}
console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，片段 ${segments} 个`);
