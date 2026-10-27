// tools/gen-balance-doc.mjs — 从 src/v5.js + src/db.js 导出数值表到 docs/16-数值表.md
//
// 用法：node tools/gen-balance-doc.mjs
// 说明：**这里一个数值都不定义**，全部从代码里读出来排版。数值的权威是
//       docs/数值设计.md；本文件只是"当前代码实际是什么"的快照，方便对照。

import fs from 'node:fs';
import { CONFIG, specification, permanentCost, campaign } from '../src/v5.js';
import { ITEM_NAMES, FAILURE_NAMES, SUCCESS_NAMES, TIER_NAMES } from '../src/db.js';

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

push('# 16 — 数值表（由代码生成）');
push('');
push('> **本文件由 `tools/gen-balance-doc.mjs` 从 `src/v5.js` + `src/db.js` 自动导出。**');
push('> 数值的唯一权威是 [`数值设计.md`](数值设计.md)（V5）；本文件只是"当前代码实际跑出来是什么"的快照。');
push('> 生成命令：`node tools/gen-balance-doc.mjs`；对拍命令：`node tools/v5-verify.mjs`、`node tools/v5-engine-verify.mjs`、`node tools/v5-audit.mjs`。');
push('');

// ── 一、四层 ──
push('## 一、四层（档）与单位');
push('');
push('| 层 s | 档名 | 角色 | 显示目标 B | 内部目标 b=B/S | 单位 S | 生产系数 α | 压力基数 q0 | 压力时间 T |');
push('|---:|---|---|---:|---:|---:|---:|---:|---:|');
for (let s = 1; s <= 4; s++) {
  push(`| ${s} | ${TIER_NAMES[s - 1]} | ${['249', '耶维奇', '白琦', '恒'][s - 1]} | ${num(CONFIG.targets[s - 1])} `
    + `| ${num(CONFIG.targets[s - 1] / CONFIG.units[s - 1])} | ${num(CONFIG.units[s - 1])} `
    + `| ${num(CONFIG.productionScale[s - 1])} | ${num(CONFIG.pressureBase[s - 1])} | ${num(CONFIG.pressureTimes[s - 1])} |`);
}
push('');
push('压力公式：`q_s(t) = q0[s] · exp((t / T[s])^8)`；显示量 = 内部量 × S。');
push('');

// ── 二、32 项升级 ──
push('## 二、32 项临时升级（价格 / 门槛 / 密度）');
push('');
push('`K(L) = firstPrice · exp(logStep·L)`，`firstPrice = base·expm1(logStep)/(ratio-1)`，`logStep = ln(ratio)/k`。');
push('下表是**进入该层且该层为当前层时**的参数（旧层项在高层会换 k 与门槛，由 `specification(layer)` 现算）。');
for (let layer = 1; layer <= 4; layer++) {
  push('');
  push(`### 层 ${layer} · ${TIER_NAMES[layer - 1]}（当前层 s=${layer}）`);
  push('');
  push('| ID | 名字 | kind | 门槛 | base | ratio | 密度 k | 首价 | 第 10 级价格 |');
  push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const item of specification(layer)) {
    const name = ITEM_NAMES[item.owner][item.position];
    const priceAt10 = item.firstPrice * Math.exp(item.logStep * 10);
    push(`| ${item.id} | ${name} | ${item.kind} | ${num(item.threshold)} | ${num(item.base)} `
      + `| ${num(item.ratio)} | ${num(item.density)} | ${num(item.firstPrice)} | ${num(priceAt10)} |`);
  }
}
push('');
push('旧层项（`o < s`）门槛统一为 `1 + 0.1·p`，密度 `k = 8·10^(s-o)`；见 §3.3/§4.3。');
push('');

// ── 三、永久体系 ──
push('## 三、两套永久体系');
push('');
push('### 3.1 失败永久 F（记忆点数 MP 购买，覆灭结算自动购买）');
push('');
push('| 层 | 名字 | 成本公式 | 等级 0–5 的价格 | 机制 |');
push('|---:|---|---|---|---|');
const failMech = [
  '第 1 层有效总等级抬高生产（log1p((a+b)/20)·1.6·F1）',
  '两个原始生产来源互相借用 share=F2/(3+F2)',
  '每第 5 次削减强化 1+3·ln(1+F3)',
  '削减随整程时间 1+0.5·ln(1+F4)·sqrt(runTime/600)',
];
for (let s = 1; s <= 4; s++) {
  const prices = [0, 1, 2, 3, 4, 5].map((n) => permanentCost('failure', s, n)).join(' / ');
  push(`| ${s} | ${FAILURE_NAMES[s - 1].name} | ceil(${CONFIG.failure.costBase[s - 1]}·1.35^n) | ${prices} | ${failMech[s - 1]} |`);
}
push('');
push('失败奖励：`QF = floor(4·10^(s-1+p))`，第一层 `p = log10(peak)/log10(b1)`，其他层 `p = (peak-1)/(b-1)`。');
push('');
push('### 3.2 成功永久 U（守护点数 PP 购买，守护结算自动购买）');
push('');
push('| 层 | 名字 | 每次守护获得 QS | 成本公式 | 等级 0–5 的价格 | 占位权重 |');
push('|---:|---|---:|---|---|---:|');
for (let s = 1; s <= 4; s++) {
  const prices = [0, 1, 2, 3, 4, 5].map((n) => permanentCost('success', s, n)).join(' / ');
  push(`| ${s} | ${SUCCESS_NAMES[s - 1].name} | ${CONFIG.success.reward[s - 1]} `
    + `| ceil(${CONFIG.success.costBase[s - 1]}·1.6^n) | ${prices} `
    + `| 通用 ${CONFIG.success.placeholderExponent[s - 1]} / 本层 ${CONFIG.success.ownPlaceholderExponent[s - 1]} |`);
}
push('');
push('成功占位：`B_s = 10^(Σ 通用权重·U + 本层权重·U_s)`，只乘生产与普通单次削减。');
push('');

// ── 四、公式速查 ──
push('## 四、公式速查');
push('');
push('```text');
push('firstBonus = s==1 ? exp(1.6·F1·ln(1+(a+b)/20)) : 1+0.08·(1.6·F1·ln(1+(a+b)/20))');
push('rawFirst   = s==1 ? 1.5^a · firstBonus : (1+a) · firstBonus');
push('rawSecond  = 1 + 3c          share = F2/(3+F2)');
push('first      = rawFirst  + (s>=2 ? share·(rawSecond-1) : 0)');
push('second     = rawSecond + share·(rawFirst-1)');
push('global     = sqrt(1 + d/10)  eta = sqrt(1 + b/10)');
push('P          = α[s]·B_s·global·(s==1 ? first : first+second-1)');
push('x += P·dt                    r += eta·P·dt');
push('frequency  = min(20, 1+2g)   overflow = sqrt(max(1,(1+2g)/20))');
push('timeMul    = 1 + 0.5·ln(1+F4)·sqrt(runTime/600)');
push('hit        = B_s·global·(1+e)·overflow·timeMul·(1 + ln(1+j)/10·sqrt(h/10))');
push('burst      = 1 + 3·ln(1+F3)  （片段第 5/10/15… 次攻击替换使用）');
push('removed    = min(h,hit)      h -= removed   r += 0.1·ln(1+f)·ln(1+removed)');
push('h += q_s(t)·dt               t 用当前层时间；F4 用整程时间');
push('```');
push('');

// ── 五、实测 ──
const result = campaign();
const seconds = result.runs.reduce((a, r) => a + r.time, 0);
push('## 五、当前代码实测（与 数值设计.md §10.1 一致）');
push('');
push('```text');
push(`失败次数：${JSON.stringify(result.failures)}`);
push(`轮数：${result.runs.length}`);
push(`最终失败等级：${JSON.stringify(result.permanent.failure)}`);
push(`最终成功等级：${JSON.stringify(result.permanent.success)}`);
push(`最终失败余额：${result.permanent.failureWallet}`);
push(`最终成功余额：${result.permanent.successWallet}`);
push(`累计游戏时间：${seconds.toFixed(2)} 秒，约 ${(seconds / 3600).toFixed(2)} 小时`);
push('```');
push('');
const failed = result.runs.filter((r) => r.failedLayer);
push(`每次覆灭时长：${Math.min(...failed.map((r) => r.time)).toFixed(2)} ～ ${Math.max(...failed.map((r) => r.time)).toFixed(2)} 秒。`);
push('');
push('> 若这张表和 `数值设计.md` §10 对不上，说明代码被改动了 —— 跑 `node tools/v5-verify.mjs` 定位。');

fs.writeFileSync('docs/16-数值表.md', `${lines.join('\n')}\n`, 'utf8');
console.log(`已写入 docs/16-数值表.md（${lines.length} 行）`);
