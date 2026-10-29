// sim/probe.mjs — 单次轨迹探针：每 5 秒打一行当前片段的关键量
//
//   node sim/probe.mjs [maxSeconds] [stage]
//
// 不带 stage 时从第一层开始按基准配置（22 级 + 自动结算）跑；带 stage 时直接开一个 demo 场景。
import { Engine, createInitialState, CHARACTER_ORDER } from '../src/engine.js';
import { CONFIG } from '../src/v8.js';

const maxSeconds = Number(process.argv[2] || 600);
const stageArg = Number(process.argv[3] || 0);
const engine = new Engine(createInitialState());
engine.headless = true;
for (const id of CHARACTER_ORDER) engine.s.autoBuyLv[id] = 22;
engine.s.auto.collapse = true;
engine.s.auto.guard = true;
if (stageArg >= 1 && stageArg <= 9) engine.scene(stageArg, { demo: 16, wallet: 5e4 });

const limit = Math.floor(maxSeconds / CONFIG.dt);
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

let lastPrint = -1;
let segments = 0;
const t0 = Date.now();
for (let n = 0; n < limit; n++) {
  const r = engine.tick();
  if (r) {
    segments++;
    console.log(`[${r.win ? '守护' : '覆灭'}] 第${r.stage}层 run#${engine.state.stats.runs} `
      + `片段 ${f(r.time)}s 峰值 ${f(r.peak, 4)} 压力 ${f(r.pressure, 4)} `
      + `购买 ${r.purchases} 释放 ${r.releases} hits=${r.hits} `
      + `F[${engine.permanent.failure}] U[${engine.permanent.success}]`);
    lastPrint = -1;
    continue;
  }
  const sec = Math.floor(engine.state.stats.playTime / 5) * 5;
  if (sec !== lastPrint && sec <= maxSeconds) {
    lastPrint = sec;
    const v = engine.view();
    const e = v.effects;
    console.log(
      `t=${String(sec).padStart(5)}s 第${v.stage}层 力量 ${f(v.power, 4)} / 目标 ${f(v.targetWork, 3)} `
      + `压力 ${f(v.pressure, 4)}（比值 ${f(v.pressureRatio, 2)}） mtc ${f(v.wallet, 3)} `
      + `P ${f(e.production, 4)} hit ${f(e.hit, 3)} SP ${f(e.sp, 3)} SD ${f(e.sd, 3)}`,
    );
  }
}
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，片段 ${segments} 段。`);
