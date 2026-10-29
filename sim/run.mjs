// sim/run.mjs — 确定性确认：V8 是确定性的，同参数跑 N 次必须逐字段相同
//
//   node sim/run.mjs [次数]
//
// 默认 2 次；每次都是完整八层流程（891127 ticks，约 1 分钟），所以不要随手加次数。
import assert from 'node:assert/strict';
import { simulate } from './simulate.mjs';

const times = Math.max(1, Math.min(5, Number(process.argv[2] || 2)));
const t0 = Date.now();
const first = simulate({ verbose: false });
for (let i = 2; i <= times; i++) {
  const again = simulate({ verbose: false });
  assert.deepEqual(
    { p: again.permanent, r: again.runs.length, s: again.seconds, f: again.failures, t: again.ticks },
    { p: first.permanent, r: first.runs.length, s: first.seconds, f: first.failures, t: first.ticks },
    `第 ${i} 次结果与第 1 次不同：数值被改动了`,
  );
}
const f = (x) => x.toFixed(2);
console.log(`[sim/run] 连跑 ${times} 次，全部一致（总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  轮数 ${first.runs.length}  累计 ${f(first.seconds)}s（${f(first.seconds / 3600)} 小时）  tick ${first.ticks}`);
console.log(`  失败次数 ${JSON.stringify(first.failures)}`);
console.log(`  F[${first.permanent.failure}]  U[${first.permanent.success}]  `
  + `WF=${first.permanent.failureWallet}  WS=${first.permanent.successWallet}`);
console.log(`  每轮时长：${first.runs.map((r) => f(r.time)).join(' / ')}`);
