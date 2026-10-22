// sim/worker.mjs — 模拟器 worker：跑若干条时间线，回传统计
import { parentPort, workerData } from 'node:worker_threads';
import { simulate } from './simulate.mjs';

const { strategies, perWorker, maxHours, dt } = workerData;
const out = [];
for (const strategy of strategies) {
  for (let i = 0; i < perWorker; i++) {
    const r = simulate({ strategy, maxHours, dt });
    out.push({
      strategy,
      won: r.won,
      hours: r.playTime / 3600,
      cycles: r.cycles,
      tierTimes: r.tierTimes.map((x) => x / 3600),
      tierGuards: r.tierGuards,
      tierCollapses: r.tierCollapses,
    });
  }
}
parentPort.postMessage(out);
