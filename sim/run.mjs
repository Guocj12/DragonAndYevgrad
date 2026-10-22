// sim/run.mjs — 多线程批量模拟 + 统计报告
// 用法：node sim/run.mjs [每种策略的时间线数] [线程数] [maxHours] [dt]
// 输出：通关率、平均总时长、每档耗时、每轮时长、卡点位置
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const perStrategy = Number(process.argv[2] || 8);
const threads = Number(process.argv[3] || Math.min(16, Math.max(2, os.cpus().length - 1)));
const maxHours = Number(process.argv[4] || 60);
const dt = Number(process.argv[5] || 1);
const strategies = ['value', 'cheapest', 'preset'];

const perWorker = Math.max(1, Math.ceil(perStrategy / threads));
const jobs = [];
for (let i = 0; i < threads; i++) {
  jobs.push(new Promise((resolve) => {
    const w = new Worker(path.join(here, 'worker.mjs'), {
      workerData: { strategies, perWorker, maxHours, dt },
    });
    w.on('message', resolve);
    w.on('error', (e) => { console.error('worker error', e); resolve([]); });
  }));
}

const t0 = Date.now();
const results = (await Promise.all(jobs)).flat();
console.log(`跑完 ${results.length} 条时间线，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，线程 ${threads}\n`);

const byStrategy = {};
for (const r of results) (byStrategy[r.strategy] ||= []).push(r);

for (const [strategy, list] of Object.entries(byStrategy)) {
  const won = list.filter((r) => r.won);
  const avg = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : NaN);
  const hours = won.map((r) => r.hours).sort((a, b) => a - b);
  console.log(`【${strategy}】通关率 ${(won.length / list.length * 100).toFixed(0)}%  平均 ${avg(won, (r) => r.hours).toFixed(2)}h  中位 ${hours.length ? hours[Math.floor(hours.length / 2)].toFixed(2) : '-'}h  轮数 ${avg(won, (r) => r.cycles).toFixed(0)}`);
  const tierH = [0, 1, 2, 3].map((k) => avg(won, (r) => (r.tierTimes[k] || 0) * 3600) / 3600);
  console.log(`  每档耗时(h)：${tierH.map((x) => x.toFixed(2)).join(' / ')}`);
  const col = [0, 1, 2, 3].map((k) => avg(won, (r) => r.tierCollapses[k] || 0).toFixed(0));
  console.log(`  每档覆灭轮数：${col.join(' / ')}`);
  // 卡点：哪一档的覆灭轮数最多
  const stuck = col.indexOf(col.slice().sort((a, b) => b - a)[0]);
  console.log(`  卡点（覆灭最多）：档 ${stuck}`);
}
