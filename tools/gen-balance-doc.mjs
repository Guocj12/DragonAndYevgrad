// tools/gen-balance-doc.mjs — 从 src/v8.js + src/db.js 导出数值表到 docs/16-数值表.md
//
//   node tools/gen-balance-doc.mjs
//
// 说明：**这里一个数值都不定义**，全部从代码读出来排版。数值的权威是 docs/数值设计.md；
//       本文件只回答"当前代码实际跑出来是什么"。
import fs from 'node:fs';
import {
  CONFIG, specification, permanentCost, campaign, batchCost,
} from '../src/v8.js';
import {
  ITEM_NAMES, FAILURE_NAMES, SUCCESS_NAMES, TIER_NAMES, AUTO_BASE_COST,
} from '../src/db.js';

const lines = [];
const push = (s = '') => lines.push(s);
const num = (x) => {
  if (typeof x !== 'number') return String(x);
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e6) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e5)) return x.toExponential(6);
  return String(Number(x.toFixed(6)));
};

push('# 16 — 数值表（自动生成，勿手改）');
push('');
push('> **本文件由 `tools/gen-balance-doc.mjs` 从 `src/v8.js` + `src/db.js` 自动导出。**');
push('> 数值唯一权威是 [`数值设计.md`](数值设计.md)（V8：八层 + 终局）；本文件只是"当前代码跑出来是什么"的快照。');
push('> 生成：`node tools/gen-balance-doc.mjs`；对拍：`node tools/v8-verify.mjs`、`node tools/v8-engine-verify.mjs`、`node tools/v8-audit.mjs`、`node tools/v8-save-verify.mjs`。');
push('');

push('## 一、八层 + 终局的公式参数');
push('');
push('| 层 s | 名称 | 真实目标 T_s | 工作坐标 q_s | alpha | 压力底 q0 | 压力 T 秒 | 生产系数 | replay knee | replay 系数 |');
push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (let s = 1; s <= 9; s++) {
  push(`| ${s}${s === 9 ? '（终局）' : ''} | ${TIER_NAMES[s - 1]} | \`${CONFIG.targets[s - 1]}\` | ${num(CONFIG.coordinates[s - 1])} `
    + `| ${num(CONFIG.alpha[s - 1])} | ${num(CONFIG.pressureBase[s - 1])} | ${num(CONFIG.pressureTime[s - 1])} `
    + `| ${num(CONFIG.productionTech[s - 1])} | ${num(CONFIG.productionReplayKnee[s - 1])} | ${num(CONFIG.productionReplay[s - 1])} |`);
}
push('');
push('真实量 = `Scientific(T_s).pow(log10(工作)/log10(q_s))`；层 1 是恒等变换。压力 = `q0·exp((t/T)^8)/(1+侵蚀)`。');
push('');

push('## 二、八种失败永久（n1..n8）与四项成功科技');
push('');
push(`失败价格 \`KF(owner,n)=ceil(baseF[owner]·${CONFIG.failRatio}^n)\`，failBase = ${JSON.stringify(CONFIG.failBase)}`);
push('');
push('| owner | 名称 | n=0 | n=1 | n=2 | n=3 | n=5 | n=10 |');
push('|---:|---|---:|---:|---:|---:|---:|---:|');
for (let i = 0; i < 8; i++) {
  push(`| ${i + 1} | ${FAILURE_NAMES[i].name} | ${permanentCost('failure', i, 0)} | ${permanentCost('failure', i, 1)} `
    + `| ${permanentCost('failure', i, 2)} | ${permanentCost('failure', i, 3)} | ${permanentCost('failure', i, 5)} | ${permanentCost('failure', i, 10)} |`);
}
push('');
push(`成功价格 \`KS(i,u)=ceil(baseS[i]·ratioS[i]^u)\`，successBase = ${JSON.stringify(CONFIG.successBase)}，successRatio = ${JSON.stringify(CONFIG.successRatio)}`);
push('');
push('| i | 名称 | 倍率 | u=0 | u=1 | u=2 | u=5 | u=10 | u=20 |');
push('|---:|---|---|---:|---:|---:|---:|---:|---:|');
SUCCESS_NAMES.forEach((s, i) => {
  push(`| ${i} | ${s.name} | ${s.stat} | ${permanentCost('success', i, 0)} | ${permanentCost('success', i, 1)} `
    + `| ${permanentCost('success', i, 2)} | ${permanentCost('success', i, 5)} | ${permanentCost('success', i, 10)} | ${permanentCost('success', i, 20)} |`);
});
push('');
push(`自动购买科技价格：第 1–8 级各 ${JSON.stringify(AUTO_BASE_COST)} MP，之后每级 ×2（满级 22）。`);
push('');

for (let s = 1; s <= 8; s++) {
  const items = specification(s).filter((i) => i.owner === s);
  push(`## 三.${s} 第 ${s} 层（${TIER_NAMES[s - 1]}）当前层 8 项`);
  push('');
  push('| 项 | 名称 | 种类 | 基础价 base | 倍率 ratio | 密度 k | 解锁门槛 | 首价 firstPrice | L=0 总价校验 |');
  push('|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const it of items) {
    const check = batchCost(it.firstPrice, it.step, it.density);
    push(`| ${it.id} | ${ITEM_NAMES[s][it.position]} | ${it.kind === 0 ? '主机制' : '第二机制'} | ${num(it.base)} `
      + `| ${num(it.ratio)} | ${num(it.density)} | ${num(it.threshold)} | ${num(it.firstPrice)} | ${num(check)} |`);
  }
  push('');
}
push('L=0 总价校验 = `firstPrice·expm1(step·k)/expm1(step)`，必须等于 `base`（价格恒等式，§12.7）。');
push('');

const four = campaign({ through: 4 });
const fourSeconds = four.runs.reduce((s, r) => s + r.time, 0);
push('## 四、验收锚（本机跑出来的数）');
push('');
push(`前四层检查点：${four.runs.length} 轮，合计 ${fourSeconds.toFixed(2)}s（${(fourSeconds / 3600).toFixed(4)} 小时），失败次数 [${four.failures.slice(0, 4)}]。`);
push('');
push('八层检查点与终局锚由 `node tools/v8-verify.mjs` 逐字段核对，摘要（与文档 §12.1 / §12.6 相同）：');
push('');
push('```text');
push('八层检查点：50 轮  44556.35s  F[7,6,8,4,9,9,8,9]  U[37,37,36,36]  WF=446103510  WS=88739910');
push('终局三轮：1824.85s / 1629.85s / 1549.25s  越标线 否/是/是');
push('```');
push('');
push('> 若这张表和 `数值设计.md` §12 对不上，说明代码被改动了 —— 跑 `node tools/v8-verify.mjs` 定位。');

fs.writeFileSync('docs/16-数值表.md', `${lines.join('\n')}\n`, 'utf8');
console.log(`[gen-balance-doc] docs/16-数值表.md 已生成（${lines.length} 行）`);
