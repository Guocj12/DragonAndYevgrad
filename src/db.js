// src/db.js — 数据表（AD: GameDatabase 的等价实现）
// 结构：每角色 8 升级 + 4 科技 + 9 科技树节点；通用树 13 节点（1 中心 + 4 主干 + 8 叶子）。
//
// 数值结构：
//   主链（灌装线 / 剑意 / 骨钉）产量 ×2^等级、无上限；
//   其余升级每级一个固定倍率、10 级封顶（描述里直接写「每级产量 ×1.05，最高 10 级」）；
//   解锁链：前一个升级买满 10 级，才解锁下一个；
//   基础价 = 2^(10×序号)：u1=1、u2=2^10、u3=2^20 … 保证一级一级往上爬；
//   MP / PP / AP 一律整数。

import { Dec } from './num.js';

const envNum = (name, fallback) => {
  if (typeof process !== 'undefined' && process.env && process.env[name]) return Number(process.env[name]);
  return fallback;
};

export const TUNING = {
  fillSeconds: 249,
  tau: 249 / Math.LN2,
  startFraction: 0.5,
  tierExponents: [249, 2492, 24920, 249209, 2492094, 24920949, 249209494, 2492094949],
  tierMantissa: 2.49,
  maxTier: 3,
  tickSeconds: 0.05,
  mpPerCollapse: 1,
  mpPurifyFactor: 8,
  ppPerGuard: 24,
  apLayerBase: 1,
  // 自动采购：前 8 级解锁升级 1–8，之后每级间隔 ×0.95，最快 0.05 秒（每秒 20 次）
  autoBuyBaseInterval: 1.0,
  autoBuyIntervalMult: 0.95,
  autoBuyMinInterval: 0.05,
  autoBuyMaxLevel: 67,
  memoryBase: envNum('DNY_MB', 1.006),
  alphaCap: envNum('DNY_ALPHA', 0.5),
  bulkGroup: 10,
  groupCostMult: 1,
};

const d = (x) => (x instanceof Dec ? x : Dec.from(x));
const pow = (base, l) => Dec.pow(base, l);
export const costOf = (base, mult, level) => Dec.mul(d(base), pow(mult, level));

// ── 升级：10 级封顶，解锁链要求前一个买满 ──
export const UP_CAP = 10;
export const REQ_LEVELS = [0, UP_CAP, UP_CAP, UP_CAP, UP_CAP, UP_CAP, UP_CAP, UP_CAP];
const upBase = (i) => pow(2, 10 * i);
const upCost = (i) => (l) => Dec.mul(upBase(i), pow(2, l));

// ─────────────────────────────────────────────
// 249
// ─────────────────────────────────────────────
const C249 = {
  id: '249',
  name: '249',
  title: '奶茶店超级人工智能',
  angle: 90,
  unlockTier: 0,
  blurb: '不会记得每次轮回，数据库里却有每一轮的记录。',
  upgrades: [
    { id: '249u1', name: '灌装线', kind: 'prod', cost: upCost(0), maxLevel: Infinity,
      desc: () => '每级产量 ×2。', mul: (l) => pow(2, l) },
    { id: '249u2', name: '配方改良', kind: 'prod', cost: upCost(1), maxLevel: UP_CAP,
      desc: () => '每级产量 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: '249u3', name: '净化喷嘴', kind: 'eta', cost: upCost(2), maxLevel: UP_CAP,
      desc: () => '每级净化效率 ×1.15，最高 10 级。', mul: (l) => pow(1.15, l) },
    { id: '249u4', name: '时钟校准', kind: 'speed', cost: upCost(3), maxLevel: UP_CAP,
      desc: () => '每级生产速度 ×1.03，最高 10 级。', mul: (l) => pow(1.03, l) },
    { id: '249u5', name: '产线联动', kind: 'prod', cost: upCost(4), maxLevel: UP_CAP,
      desc: () => '每级产量 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: '249u6', name: '记忆结晶', kind: 'eta', cost: upCost(5), maxLevel: UP_CAP,
      desc: () => '每级净化效率 ×1.15，最高 10 级。', mul: (l) => pow(1.15, l) },
    { id: '249u7', name: '高峰时段', kind: 'prod', cost: upCost(6), maxLevel: UP_CAP,
      desc: () => '每级产量 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: '249u8', name: '产线总控', kind: 'prod', cost: upCost(7), maxLevel: UP_CAP,
      desc: () => '每级产量 ×1.15，最高 10 级。', mul: (l) => pow(1.15, l) },
  ],
  techs: [
    { id: '249t1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '第 1–8 级依次解锁第 1–8 个升级的自动购买。'
        : l < 8 ? `已自动购买前 ${l} 个升级；第 8 级解锁全部升级。`
          : '之后每级把自动购买间隔 ×0.95，最快 0.05 秒（每秒 20 次）。') },
    { id: '249t2', name: '超频', kind: 'mpByTime', cost: (l) => costOf(2, 1.4, l), maxLevel: 20,
      desc: () => '本轮拖得越久，覆灭时 MP 越多；每级让「本轮分钟数」的转化率再 +0.1。' },
    { id: '249t3', name: '增产', kind: 'ppByEarliness', cost: (l) => costOf(3, 1.3, l), maxLevel: 20,
      desc: () => '本轮结束得越早，覆灭时 PP 越多；每级让「剩余分钟数」的转化率再 +0.1。' },
    { id: '249t4', name: '蓄势', kind: 'prodByTime', cost: (l) => costOf(5, 1.35, l), maxLevel: 20,
      desc: () => '每级让产量再乘「本轮分钟数 ×0.05」，最高 20 级。' },
  ],
  tree: [
    { id: '249a1', name: '记忆归档', layer: 1, desc: () => '覆灭时留下两成奶茶币。' },
    { id: '249a2', name: '时间加速', layer: 2, desc: () => '每解锁一个节点，生产速度 ×1.15。' },
    { id: '249a3', name: '资源共鸣', layer: 2, desc: () => '覆灭次数越多，覆灭时 MP 越多（每次 +25%）。' },
    { id: '249a4', name: '净化协议', layer: 3, desc: () => '深渊压得越低，净化效率越高。' },
    { id: '249a5', name: '快速重启', layer: 3, desc: () => '开局就带一点奶茶币，节点越多带得越多。' },
    { id: '249a6', name: '离线强化', layer: 3, desc: () => '离线收益 +30%。' },
    { id: '249a7', name: '产线扩张', layer: 4, desc: () => '全场总等级越高，产量越高。' },
    { id: '249a8', name: '记忆过载', layer: 4, desc: () => '本轮时间越长，产量越高，最多 ×2。' },
    { id: '249a9', name: '记忆奇点', layer: 5, desc: () => '产量 ×2，并把奶茶币的平方根计入产量。' },
  ],
};

// ─────────────────────────────────────────────
// 耶维奇
// ─────────────────────────────────────────────
const YEWEI = {
  id: 'yewei',
  name: '耶维奇',
  title: '万事屋店主',
  angle: 45,
  unlockTier: 1,
  blurb: '可以独立生产奶茶，也会为其他角色提供强力辅助。',
  upgrades: [
    { id: 'ywu1', name: '万事屋', kind: 'line', cost: upCost(0), maxLevel: Infinity,
      desc: () => '每级多开一条独立产线，产线合计最多顶半间店。', share: (l) => Math.min(0.5, 0.04 * l) },
    { id: 'ywu2', name: '人脉', kind: 'prodAll', cost: upCost(1), maxLevel: UP_CAP,
      desc: () => '每级全体产量 ×1.05，最高 10 级。', mul: (l) => pow(1.05, l) },
    { id: 'ywu3', name: '连锁', kind: 'line', cost: upCost(2), maxLevel: UP_CAP,
      desc: () => '每级独立产线 ×1.08，最高 10 级。', mul: (l) => pow(1.08, l) },
    { id: 'ywu4', name: '共生', kind: 'line', cost: upCost(3), maxLevel: UP_CAP,
      desc: () => '每级独立产线 ×1.06，最高 10 级。', mul: (l) => pow(1.06, l) },
    { id: 'ywu5', name: '反哺', kind: 'prod249', cost: upCost(4), maxLevel: UP_CAP,
      desc: () => '每级 249 产量 ×1.06，最高 10 级。', mul: (l) => pow(1.06, l) },
    { id: 'ywu6', name: '万事通', kind: 'powerAll', cost: upCost(5), maxLevel: UP_CAP,
      desc: () => '每级全体战力 ×1.06，最高 10 级。', mul: (l) => pow(1.06, l) },
    { id: 'ywu7', name: '深度经营', kind: 'line', cost: upCost(6), maxLevel: UP_CAP,
      desc: () => '每级独立产线 ×1.05，最高 10 级。', mul: (l) => pow(1.05, l) },
    { id: 'ywu8', name: '分店', kind: 'line', cost: upCost(7), maxLevel: UP_CAP,
      desc: () => '每级独立产线 ×1.08，最高 10 级。', mul: (l) => pow(1.08, l) },
  ],
  techs: [
    { id: 'ywt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '第 1–8 级依次解锁第 1–8 个升级的自动购买。'
        : l < 8 ? `已自动购买前 ${l} 个升级。` : '之后每级把自动购买间隔 ×0.95，最快 0.05 秒。') },
    { id: 'ywt2', name: '商业谈判', kind: 'mpBuy', cost: (l) => costOf(2, 1.4, l), maxLevel: 20,
      desc: () => '花奶茶币换 MP，每级换得更多。' },
    { id: 'ywt3', name: '离线效率', kind: 'offline', cost: (l) => costOf(3, 1.5, l), maxLevel: 20,
      desc: (l) => `离线收益 ${Math.min(100, 50 + 10 * l)}%。` },
    { id: 'ywt4', name: '资源转化', kind: 'ppConv', cost: (l) => costOf(5, 1.6, l), maxLevel: 20,
      desc: () => '把独立产线的一部分产出换成 PP，越换越难换得动。' },
  ],
  tree: [
    { id: 'ywa1', name: '开张', layer: 1, desc: () => '覆灭次数越多，独立产线越强。' },
    { id: 'ywa2', name: '情报网', layer: 2, desc: () => '深渊增速 ×0.9。' },
    { id: 'ywa3', name: '后勤保障', layer: 2, desc: () => '所有升级便宜一成。' },
    { id: 'ywa4', name: '挚友', layer: 3, desc: () => '白琦战力 ×(1 + 0.3×耶维奇等级)。' },
    { id: 'ywa5', name: '幕后', layer: 3, desc: () => '全体产量 ×1.2。' },
    { id: 'ywa6', name: '连锁经营', layer: 3, desc: () => '独立产线 ×(1 + 0.1×耶维奇等级)。' },
    { id: 'ywa7', name: '谈判', layer: 4, desc: () => '奶茶币获取 ×(1 + 0.5×覆灭次数)。' },
    { id: 'ywa8', name: '分号', layer: 4, desc: () => '独立产线 ×1.5。' },
    { id: 'ywa9', name: '万事屋本店', layer: 5, desc: () => '249 与独立产线互相反哺：对方产量越高，自己越强。' },
  ],
};

// ─────────────────────────────────────────────
// 白琦
// ─────────────────────────────────────────────
const BAIQI = {
  id: 'baiqi',
  name: '白琦',
  title: '白发屠龙少女',
  angle: 0,
  unlockTier: 2,
  blurb: '使用重剑，每秒对深渊造成一次伤害。龙的血脉不自知。',
  upgrades: [
    { id: 'bqu1', name: '剑意', kind: 'powerRate', cost: upCost(0), maxLevel: Infinity,
      desc: () => '每级剑意增长 ×2。', rate: (l) => pow(2, l) },
    { id: 'bqu2', name: '剑技', kind: 'power', cost: upCost(1), maxLevel: UP_CAP,
      desc: () => '每级战力 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: 'bqu3', name: '屠龙', kind: 'damage', cost: upCost(2), maxLevel: UP_CAP,
      desc: () => '每级对深渊伤害 ×1.12，最高 10 级。', mul: (l) => pow(1.12, l) },
    { id: 'bqu4', name: '暴击', kind: 'critRate', cost: upCost(3), maxLevel: UP_CAP,
      desc: () => '每级暴击率 +12%，最高必定暴击。', critRate: (l) => Math.min(1, 0.12 * l) },
    { id: 'bqu5', name: '逆鳞', kind: 'critDmg', cost: upCost(4), maxLevel: UP_CAP,
      desc: () => '每级暴击伤害 +50%，最高 10 级。', critDmg: (l) => 0.5 * l },
    { id: 'bqu6', name: '真龙', kind: 'dragon', cost: upCost(5), maxLevel: UP_CAP,
      desc: (l) => `每级真龙冷却 ×0.95（当前 ${(60 * Math.pow(0.95, l)).toFixed(1)} 秒）；压到 10 秒以内会叠层，每层 ×10，最多 4 层。`,
      cooldown: (l) => 60 * Math.pow(0.95, l) },
    { id: 'bqu7', name: '真龙强化', kind: 'dragonPower', cost: upCost(6), maxLevel: UP_CAP,
      desc: () => '每级真龙每层威力 +30%，最高 +300%。', dragonMul: (l) => 1 + 0.3 * l },
    { id: 'bqu8', name: '剑心', kind: 'powerRate', cost: upCost(7), maxLevel: UP_CAP,
      desc: () => '每级剑意增长 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
  ],
  techs: [
    { id: 'bqt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '第 1–8 级依次解锁第 1–8 个升级的自动购买。'
        : l < 8 ? `已自动购买前 ${l} 个升级。` : '之后每级把自动购买间隔 ×0.95，最快 0.05 秒。') },
    { id: 'bqt2', name: '蓄力斩', kind: 'charge', cost: (l) => costOf(2, 1.4, l), maxLevel: 20,
      desc: () => '隔一会儿蓄一次力，下一击 ×(1 + 1.5×等级)。' },
    { id: 'bqt3', name: '吸血', kind: 'lifesteal', cost: (l) => costOf(3, 1.5, l), maxLevel: 20,
      desc: (l) => `把伤害的 ${(3 * l).toFixed(0)}% 变成奶茶币。` },
    { id: 'bqt4', name: '斩杀', kind: 'execute', cost: (l) => costOf(5, 1.6, l), maxLevel: 20,
      desc: () => '深渊快被压死时，伤害 ×(1 + 等级)^2。' },
  ],
  tree: [
    { id: 'bqa1', name: '拔剑', layer: 1, desc: () => '战力 ×(1 + 0.02×全场总等级)。' },
    { id: 'bqa2', name: '屠龙式', layer: 2, desc: () => '深渊压得越低，伤害越高。' },
    { id: 'bqa3', name: '逆鳞', layer: 2, desc: () => '暴击率 +8%。' },
    { id: 'bqa4', name: '血脉共鸣', layer: 3, desc: () => '本轮时间越长，伤害越高。' },
    { id: 'bqa5', name: '龙吼', layer: 3, desc: () => '全场伤害 ×(1 + 0.01×总等级)。' },
    { id: 'bqa6', name: '断罪', layer: 4, desc: () => '暴击伤害 +60%。' },
    { id: 'bqa7', name: '真龙觉醒', layer: 4, desc: () => '真龙冷却 ×0.8。' },
    { id: 'bqa8', name: '真龙形态', layer: 5, desc: () => '真龙每层威力 ×(1 + 0.5×白琦等级)。' },
    { id: 'bqa9', name: '屠龙者', layer: 5, desc: () => '每分钟把深渊进度压低 8%。' },
  ],
};

// ─────────────────────────────────────────────
// 恒
// ─────────────────────────────────────────────
const HENG = {
  id: 'heng',
  name: '恒',
  title: '受深渊诅咒的少年骑士',
  angle: -45,
  unlockTier: 3,
  blurb: '力量与深渊同源：深渊越强，他越强。',
  upgrades: [
    { id: 'hgu1', name: '骨钉', kind: 'power', cost: upCost(0), maxLevel: Infinity,
      desc: () => '每级战力 ×2。', mul: (l) => pow(2, l) },
    { id: 'hgu2', name: '同源', kind: 'alpha', cost: upCost(1), maxLevel: UP_CAP,
      desc: () => '每级 α +0.08（α 最高 0.5）。', add: (l) => Math.min(0.5, 0.08 * l) },
    { id: 'hgu3', name: '疾风', kind: 'atkSpeed', cost: upCost(2), maxLevel: UP_CAP,
      desc: () => '每级攻速 ×1.08，最高 10 级。', mul: (l) => pow(1.08, l) },
    { id: 'hgu4', name: '钉刺', kind: 'damage', cost: upCost(3), maxLevel: UP_CAP,
      desc: () => '每级伤害 ×1.12，最高 10 级。', mul: (l) => pow(1.12, l) },
    { id: 'hgu5', name: '深渊共鸣', kind: 'alpha', cost: upCost(4), maxLevel: UP_CAP,
      desc: () => '每级 α ×1.04，最高 10 级。', mul: (l) => pow(1.04, l) },
    { id: 'hgu6', name: '战力核心', kind: 'power', cost: upCost(5), maxLevel: UP_CAP,
      desc: () => '每级战力 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: 'hgu7', name: '攻速核心', kind: 'atkSpeed', cost: upCost(6), maxLevel: UP_CAP,
      desc: () => '每级攻速 ×1.10，最高 10 级。', mul: (l) => pow(1.10, l) },
    { id: 'hgu8', name: '同源核心', kind: 'alpha', cost: upCost(7), maxLevel: UP_CAP,
      desc: () => '每级 α ×1.05，最高 10 级。', mul: (l) => pow(1.05, l) },
  ],
  techs: [
    { id: 'hgt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '第 1–8 级依次解锁第 1–8 个升级的自动购买。'
        : l < 8 ? `已自动购买前 ${l} 个升级。` : '之后每级把自动购买间隔 ×0.95，最快 0.05 秒。') },
    { id: 'hgt2', name: '共鸣爆发', kind: 'burst', cost: (l) => costOf(2, 1.4, l), maxLevel: 20,
      desc: () => '隔一段时间爆一次发，同源效率短时间 ×(1 + 等级)。' },
    { id: 'hgt3', name: '爆发冷却', kind: 'burstCD', cost: (l) => costOf(3, 1.5, l), maxLevel: 20,
      desc: () => '爆发冷却 ×0.9。' },
    { id: 'hgt4', name: '爆发强化', kind: 'burstPower', cost: (l) => costOf(5, 1.6, l), maxLevel: 20,
      desc: () => '爆发期间伤害 ×(1 + 等级)。' },
  ],
  tree: [
    { id: 'hga1', name: '骨钉', layer: 1, desc: () => '战力 ×(1 + 0.02×全场总等级)。' },
    { id: 'hga2', name: '同源', layer: 2, desc: () => 'α +0.03。' },
    { id: 'hga3', name: '疾风', layer: 2, desc: () => '攻速 ×1.2。' },
    { id: 'hga4', name: '钉刺', layer: 3, desc: () => '深渊越弱伤害越高。' },
    { id: 'hga5', name: '同源共鸣', layer: 3, desc: () => 'α ×(1 + 0.1×恒的等级)。' },
    { id: 'hga6', name: '深渊骑士', layer: 4, desc: () => '不断从深渊里取力，转成本轮的永久战力。' },
    { id: 'hga7', name: '深渊之影', layer: 4, desc: () => '本轮时间越长，战力越高。' },
    { id: 'hga8', name: '深渊之息', layer: 5, desc: () => '覆灭次数越多，战力越高。' },
    { id: 'hga9', name: '极速', layer: 5, desc: () => '本轮时间越长，攻速越快。' },
  ],
};

// ─────────────────────────────────────────────
// 通用树：13 节点 = 1 中心（6 级自动化）+ 4 主干 + 8 叶子
// ─────────────────────────────────────────────
export const AUTO_CENTER_MAX = 6;
const CENTER_STEPS = [
  '第 1 级：深渊满了自动结算覆灭。',
  '第 2 级：深渊清零自动结算净化。',
  '第 3 级：自动购买「奶茶翻倍」。',
  '第 4 级：自动购买「MP 翻倍」。',
  '第 5 级：自动购买「PP 翻倍」。',
  '第 6 级：自动购买「净化翻倍」。',
];

export const GENERIC_TREE = [
  { id: 'g7', name: '自动化中枢', layer: 0, slot: 'center', repeat: true, cap: AUTO_CENTER_MAX,
    cost: (l) => costOf(4, 2, l),
    desc: (l) => CENTER_STEPS[l] || '六级已满：全自动化。' },

  { id: 'g8', name: '奶茶翻倍', layer: 1, slot: 'trunk', angle: 45, parent: 'g7', repeat: true, cost: (l) => costOf(5, 10, l),
    desc: (l) => `每级全体产量 ×2（当前 ${Math.pow(2, l)} 倍）。` },
  { id: 'g10', name: 'MP 翻倍', layer: 1, slot: 'trunk', angle: -45, parent: 'g7', repeat: true, cost: (l) => costOf(10, 10, l),
    desc: (l) => `每级 MP 获取 ×5（当前 ${Math.pow(5, l)} 倍）。` },
  { id: 'g11', name: 'PP 翻倍', layer: 1, slot: 'trunk', angle: -135, parent: 'g7', repeat: true, cost: (l) => costOf(10, 10, l),
    desc: (l) => `每级 PP 获取 ×5（当前 ${Math.pow(5, l)} 倍）。` },
  { id: 'g9', name: '净化翻倍', layer: 1, slot: 'trunk', angle: 135, parent: 'g7', repeat: true, cost: (l) => costOf(50, 100, l),
    desc: (l) => `每级净化效率 ×10（当前 ${Math.pow(10, l)} 倍）。` },

  { id: 'g1', name: '产量共鸣', layer: 2, slot: 'leaf', angle: 90, parent: 'g8', repeat: false, cost: () => d(6),
    desc: (l, ctx) => `全体产量 ×(1 + 0.1×全场总等级)^0.5，当前 ×${Math.pow(1 + 0.1 * ctx.sumLAll, 0.5).toFixed(2)}。` },
  { id: 'g3', name: '升级折扣', layer: 2, slot: 'leaf', angle: 45, parent: 'g8', repeat: true, cap: 12, cost: (l) => costOf(10, 3, l),
    desc: (l) => `每级所有升级成本 ×0.88（当前 −${(100 - Math.pow(0.88, l) * 100).toFixed(0)}%）。` },
  { id: 'g12', name: '深渊易伤', layer: 2, slot: 'leaf', angle: 0, parent: 'g10', repeat: true, cost: (l) => costOf(12, 2.2, l),
    desc: (l) => `每级战斗伤害再乘一笔，层数越高涨得越快（当前 ${l} 层）。` },
  { id: 'g2', name: '净化共鸣', layer: 2, slot: 'leaf', angle: -45, parent: 'g10', repeat: false, cost: () => d(6),
    desc: (l, ctx) => `净化效率 ×(1 + 0.1×全场总等级)^0.5，当前 ×${Math.pow(1 + 0.1 * ctx.sumLAll, 0.5).toFixed(2)}。` },
  { id: 'g5', name: '时间感知', layer: 2, slot: 'leaf', angle: -90, parent: 'g11', repeat: false, cost: () => d(40),
    desc: () => '每轮最后三分之一的时间，产量随本轮时长持续提高。' },
  { id: 'g6', name: '先手优势', layer: 2, slot: 'leaf', angle: -135, parent: 'g11', repeat: true, cap: 8, cost: (l) => costOf(5, 2, l),
    desc: (l) => `每级开轮深渊起点 ×0.9（当前 −${(100 - Math.pow(0.9, l) * 100).toFixed(0)}%）。` },
  { id: 'g4', name: '离线削弱', layer: 2, slot: 'leaf', angle: 180, parent: 'g9', repeat: false, cost: () => d(20),
    desc: () => '离线时深渊只按四分之一的速度增长。' },
  { id: 'g13', name: '科技折扣', layer: 2, slot: 'leaf', angle: 135, parent: 'g9', repeat: true, cap: 10, cost: (l) => costOf(10, 3, l),
    desc: (l) => `每级 MP 科技成本 ×0.97（当前 −${(100 - Math.pow(0.97, l) * 100).toFixed(1)}%）。` },
];

export const CHARACTERS = { '249': C249, yewei: YEWEI, baiqi: BAIQI, heng: HENG };
export const CHARACTER_ORDER = ['249', 'yewei', 'baiqi', 'heng'];

for (const c of Object.values(CHARACTERS)) {
  c.upgrades.forEach((u, i) => { u.reqLevel = REQ_LEVELS[i] || 0; u.maxLevel = u.maxLevel || UP_CAP; });
  c.techs.forEach((t) => { if (!t.maxLevel) t.maxLevel = 20; });
}

export function treeLayerCost(layer) {
  return Dec.pow(2, layer - 1).mul(TUNING.apLayerBase);
}
