// sim/run.mjs — 批量确认：V5 是确定性的，同参数跑 N 次必须字节级相同
//
// 旧版这里是"多线程 × 三种机器人策略"的调参工具；V5 只有一条冻结策略
// （全局最便宜优先自动购买，数值设计 §1），所以它退化成一个确定性/回归检查器。
//
// 用法：node sim/run.mjs [次数]

import assert from 'node:assert/strict';
import { simulate } from './simulate.mjs';

const times = Math.max(1, Math.min(20, Number(process.argv[2] || 3)));
const t0 = Date.now();
const first = simulate({});
for (let i = 2; i <= times; i++) {
  const again = simulate({});
  assert.deepEqual(
    { p: again.permanent, r: again.runs.length, s: again.seconds, f: again.failures },
    { p: first.permanent, r: first.runs.length, s: first.seconds, f: first.failures },
    `第 ${i} 次结果与第 1 次不同：数值被改动了？`,
  );
}
const f = (x) => x.toFixed(2);
console.log(`跑完 ${times} 条时间线，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，结果全部一致\n`);
console.log(`轮数 ${first.runs.length}  累计 ${f(first.seconds)}s（${f(first.seconds / 3600)} 小时）`);
console.log(`失败次数 ${JSON.stringify(first.failures)}`);
console.log(`F[${first.permanent.failure}]  U[${first.permanent.success}]  `
  + `WF=${first.permanent.failureWallet}  WS=${first.permanent.successWallet}`);
console.log(`每档失败轮数：${first.failures.map((n, i) => `档${i}:${n}`).join('  ')}`);
console.log(`每次覆灭时长：${first.runs.filter((r) => r.failedLayer).map((r) => f(r.time)).join(' / ')}`);
