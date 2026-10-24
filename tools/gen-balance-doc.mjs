// tools/gen-balance-doc.mjs — 从 src/db.js 导出数值表到 docs/16-数值表.md
// 用法：node tools/gen-balance-doc.mjs
import fs from 'node:fs';
import { TUNING, REQ_LEVELS, UP_COST_MULT, CHARACTERS, CHARACTER_ORDER, GENERIC_TREE, AUTO_CENTER_MAX, treeLayerCost } from '../src/db.js';

const effOf = (mult, l) => Number(mult);
const fmt = (x) => (typeof x === 'number' ? (Math.abs(x) >= 1e5 ? x.toExponential(3) : String(x)) : String(x));

const lines = [];
const push = (s = '') => lines.push(s);

push('# 16 — 数值表（由代码生成）');
push('');
push('> **本文件由 `tools/gen-balance-doc.mjs` 从 `src/db.js` 自动导出，改数值请改代码后重跑脚本。**');
push('> 生成命令：`node tools/gen-balance-doc.mjs`');
push('');

// ── TUNING ──
push('## 一、全局参数（`TUNING`）');
push('');
push('| 参数 | 当前值 | 含义 |');
push('|---|---|---|');
const tuningDesc = {
  fillSeconds: '零产量时深渊涨满的秒数',
  tau: '超指数的特征时间（249/ln2）',
  startFraction: '每轮深渊起始占上限的比例（对数口径）',
  tierExponents: '四档上限指数（2.49×10^E）',
  tierMantissa: '上限尾数',
  maxTier: '本版最高档',
  tickSeconds: '结算步长（20 tick/s）',
  mpPerCollapse: '覆灭/守护结算 MP 的基数',
  mpPurifyFactor: '净化率换算 MP 的系数',
  ppPerGuard: '守护结算 PP 的基数（×档位+1）',
  apLayerBase: '角色树每层 AP 成本的基数（2^(层-1)）',
  autoBuyBaseInterval: '自动采购基础间隔（秒）',
  autoBuyIntervalMult: '8 级后每级压缩间隔的倍率',
  autoBuyMinInterval: '自动采购最短间隔',
  autoBuyMaxLevel: '自动采购满级',
  memoryBase: '每覆灭一次的全产量乘数（跨轮成长）',
  alphaCap: '恒的 α 上限',
  bulkGroup: '一次点击最多买到的 10 的倍数',
  groupCostMult: '分组涨价倍率（当前 1 = 不加价）',
};
for (const [k, v] of Object.entries(TUNING)) {
  push(`| \`${k}\` | ${Array.isArray(v) ? '[' + v.join(', ') + ']' : fmt(v)} | ${tuningDesc[k] || ''} |`);
}
push('');

// ── 升级 ──
push('## 二、角色升级（每角色 8 项，全部无等级上限）');
push('');
push(`- 每级成本倍率：升级 1 ×2、升级 2 ×3 …… 升级 8 ×9（\`UP_COST_MULT(i) = i + 2\`）`);
push('- 基础价：全部为 1');
push('- 每级效果：成本倍率的 1/8 次方（2^1/8=1.09 … 9^1/8=1.32）');
push(`- 解锁链：前一个升级达到 10 / 20 / 30 / 40 / 50 / 60 / 70 级（\`REQ_LEVELS = [${REQ_LEVELS.join(', ')}]\`）`);
push('');

for (const id of CHARACTER_ORDER) {
  const c = CHARACTERS[id];
  push(`### ${c.name} · ${c.title}`);
  push('');
  push('| # | 升级 | 成本倍率 | 每级效果 | 解锁条件 | 作用 |');
  push('|---|---|---|---|---|---|');
  c.upgrades.forEach((u, i) => {
    const mult = UP_COST_MULT(i);
    const eff = Math.pow(mult, 1 / 8).toFixed(2);
    const req = i === 0 ? '开局' : `「${c.upgrades[i - 1].name}」Lv${REQ_LEVELS[i]}`;
    push(`| ${i + 1} | ${u.name} | ×${mult} | ×${eff} | ${req} | ${u.desc(0).replace(/。$/, '')} |`);
  });
  push('');
  push('| # | 科技 | 成本 | 上限 | 效果 |');
  push('|---|---|---|---|---|');
  c.techs.forEach((t, i) => {
    const cost = t.cost(0).toNumber();
    push(`| ${i + 1} | ${t.name} | ${fmt(cost)} MP 起 | ${t.maxLevel === Infinity ? '无' : t.maxLevel} | ${String(t.desc(0)).replace(/。$/, '')} |`);
  });
  push('');
  push('| 层 | 节点 | 效果 |');
  push('|---|---|---|');
  c.tree.forEach((a) => {
    push(`| ${a.layer} | ${a.name} | ${String(a.desc(0)).replace(/。$/, '')} |`);
  });
  push('');
}

// ── 通用树 ──
push('## 三、通用科技树（13 节点：1 中心 + 4 主干 + 8 叶子）');
push('');
push('| 位置 | 节点 | 成本 | 上限 | 效果 |');
push('|---|---|---|---|---|');
for (const n of GENERIC_TREE) {
  const slot = { center: '中心', trunk: '主干', leaf: '叶子' }[n.slot] || n.slot;
  const cost = n.cost(0).toNumber();
  const cap = n.repeat ? (n.cap || '无') : '一次性';
  push(`| ${slot} | ${n.name} | ${fmt(cost)} PP | ${cap} | ${String(n.desc(0, { sumLAll: 50 })).replace(/。$/, '')} |`);
}
push('');
push(`- 自动化中枢共 ${AUTO_CENTER_MAX} 级：依次解锁 自动覆灭 / 自动净化 / 自动买四种翻倍。`);
push(`- 角色树节点成本：\`2^(层-1)\` AP（第 1 层 1 点，第 5 层 16 点）。`);
push('');

// ── 万事屋 ──
push('## 四、万事屋（mtc 兑换）');
push('');
push('| 资源 | 基础价 | 增长率 | 每次获得 |');
push('|---|---|---|---|');
push('| MP 记忆点数 | 10 mtc | ×1.6 | +1 MP |');
push('| PP 净化点 | 25 mtc | ×2.2 | +1 PP |');
push('');
push('价格 = 基础价 × 增长率^已兑换次数；商业谈判 / 渠道批发可把增长率压到下限 1.05。');
push('');

// ── 结算 ──
push('## 五、结算公式（`src/engine.js`）');
push('');
push('| 项 | 公式 |');
push('|---|---|');
push('| 深渊上限 | `cap(k) = 2.49 × 10^E`，E = 249 / 2492 / 24920 / 249209 |');
push('| 起始深渊 | `start = 0.5 × log10(cap)`（先手优势每级 ×0.9） |');
push('| 深渊增长 | `log10 S += D · e^(t/τ) / τ · dt`，τ = 249/ln2 |');
push('| MP 结算 | `floor((1 + 8 × 本轮最高净化率) × MP 倍率)` |');
push('| PP 结算 | `floor(12 × (档位 + 1) × PP 倍率)` |');
push('| AP 结算 | 每档首次守护 1 / 2 / 4 / 8；首次覆灭 1 |');
push('| 产量 | 各乘区相乘（249 主链 × 独立产线 × 通用树 …） |');
push('| 净化量 | `产量 × 净化效率 + 战斗伤害` |');
push('');

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/16-数值表.md', lines.join('\n') + '\n');
console.log('wrote docs/16-数值表.md', lines.length, 'lines');
