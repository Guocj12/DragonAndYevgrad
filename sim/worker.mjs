// sim/worker.mjs — 保留为可选的工作线程入口（V5 是确定性的，run.mjs 已不再需要线程）
//
// workerData: { times }  → 跑 times 次，回调结果

import { parentPort, workerData } from 'node:worker_threads';
import { simulate } from './simulate.mjs';

const times = Math.max(1, workerData?.times ?? 1);
const out = [];
for (let i = 0; i < times; i++) {
  const r = simulate({ maxHours: workerData?.maxHours ?? 12 });
  out.push({
    strategy: 'frozen-cheapest',
    won: r.finished,
    hours: r.seconds / 3600,
    cycles: r.runs.length,
    failures: r.failures,
    permanent: r.permanent,
  });
}
parentPort.postMessage(out);
