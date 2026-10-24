// src/db.js — 数据表（AD: GameDatabase 的等价实现）
// 每角色 8 升级 + 4 科技 + 9 科技树节点；通用树 13 节点（1 中心 + 4 主干 + 8 叶子）。
//
// 数值结构：
//   所有升级都没有等级上限（只受奶茶币增速限制）；每级成本 ×(2,3,…,9)，每级效果是它的 1/8 次方。
//   解锁链 REQ_LEVELS：前一个升级达到 10/12/14/16/18/20/20 级才开下一个；所有升级基础价统一为 1。
//   MP / PP / AP 一律整数。
// 描述风格照 AD：短句 + 数字，写成「产量 ×2/级」「覆灭记忆点数 ×(1 + 0.1 × 等级 × 本轮分钟数)」这种。

import { Dec } from './num.js';

const envNum = (name, fallback) => {
  if (typeof process !== 'undefined' && process.env && process.env[name]) return Number(process.env[name]);
  return fallback;
};

export const TUNING = {
  fillSeconds: 249,
  tau: 249 / Math.LN2,
  // 每档的深渊时间尺度：越往后越慢（单轮更长），但跨度也更大
  abyssPower: 2,              // 深渊增长是 t^k（2 = 二次，前期慢后期快）
  tauByTier: [600, 1200, 2400, 3600, 5400, 7200, 9000, 10800],
  startFraction: 0.5,          // 旧的比例起点（已不再使用）
  abyssT0: envNum('DNY_T0', 10),         // 对数深渊的特征时间
  abyssFollow: envNum('DNY_AF', 0),   // 深渊增长率跟随玩家产量增速的权重
  // 每档每次覆灭给的数量级（= 该档跨度 / 目标轮数）
  memoryByTierLog: [4, 30, 200, 1200, 7000, 40000, 240000, 1400000],
  dragonCut: envNum('DNY_DC', 0.002),   // 屠龙者：每分钟把深渊进度压低的比例
  boostEnabled: true,          // 新加的「强化」科技开关（测试用）
  upTierWeight: 3,             // 第 i 个升级额外 ×3^i（越靠后越强）
  collapseProgress: envNum('DNY_CP2', 0.1),   // 每覆灭一次，本档深渊起点下降的比例
  startGap: envNum('DNY_SG', 4),   // 进档时深渊比玩家产量高出的数量级
  firstTierStartLog: 12,       // 奶茶店的深渊起点（1e12）
  tierExponents: [249, 2492, 24920, 249209, 2492094, 24920949, 249209494, 2492094949],
  tierMantissa: 2.49,
  maxTier: 3,   // 只做前四档；后四档留框架（tierExponents 已就位）
  tickSeconds: 0.05,
  mpPerCollapse: 1,
  mpPurifyFactor: 8,          // 旧的净化率系数（保留兼容，已不参与结算）
  achPer: 0.2,                 // 每个成就给全体 +20%
  keepSeconds: 1e6,           // 记忆归档的基础保留量
  keepBase: 1.45,             // 保留量随覆灭次数增长
  mpPerMagnitude: 5,          // 每净化 5 个数量级的深渊，覆灭时多给 1 点基础记忆点数
  ppPerGuard: 12,
  apLayerBase: 1,
  autoBuyBaseInterval: 1.0,
  autoBuyIntervalMult: 0.95,
  autoBuyMinInterval: 0.05,
  autoBuyMaxLevel: 68,
  memoryBase: envNum('DNY_MB', 1.2),   // 记忆累积：每覆灭一次全体产量 ×1.15（缓慢）
  memoryLinear: envNum('DNY_ML', 1),   // 记忆累积（加算）：每覆灭一次，全体产量 +memoryLinear
  alphaCap: envNum('DNY_ALPHA', 0.5),
  bulkGroup: 10,
  groupCostMult: 1,
};

const d = (x) => (x instanceof Dec ? x : Dec.from(x));
const pow = (base, l) => Dec.pow(base, l);
export const costOf = (base, mult, level) => Dec.mul(d(base), pow(mult, level));

// 四档地名（按档位顺序，档 4–7 未设计）
export const TIER_NAMES = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆'];

// 升级没有等级上限；这个常数只是「解锁下一项」的门槛：前一个买到 N 级，下一个才开放
export const REQ_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70];
const UP_GROUP_MULT = 1000;   // 每 10 级的价格倍率（AD 的维度 1 就是 1000）
const upBase = () => Dec.one();
// 每级成本倍率：升级 1 ×2、升级 2 ×3 …… 升级 8 ×9；
// 每级效果 = 成本倍率的 1/8 次方，保证 8 项在同一个 mtc 数量级下贡献相同。
export const UP_COST_MULT = (i) => i + 2;
const upCostMult = (i) => UP_COST_MULT(i);
// 价格也是幂：1 + 0.5·l^2.5（幂次高于效果的 l^1.5，所以越买越贵、自然收敛，但不会一买就卡死）
const UP_POWER_COEFF = envNum('DNY_PC', 0.1);   // 幂效果系数
const UP_EFFECT_POW = envNum('DNY_EP', 1.2);    // 效果幂次
const UP_KAPPA = envNum('DNY_K', 2);             // 每级效果倍率（指数）
const UP_COST_BASE = envNum('DNY_CB', 1.5);        // 每级价格倍率（>效果倍率 → 买级有上限）
const UP_COST_COEFF = envNum('DNY_CC', 0.5);    // 价格系数
const UP_COST_POW = envNum('DNY_CP', 3);        // 价格幂次
// 价格与「本项效果」同阶：每秒能买约 1/PRICE_PER_LEVEL 级，产量因此连续爬升而不是跳跃
const PRICE_PER_LEVEL = envNum('DNY_PPL', 10);
const upCost = (i) => (l) => Dec.mul(upBase(i), Dec.pow(UP_COST_BASE, l));

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
    { id: '249u1', name: '灌装线', kind: 'prod', cost: upCost(0), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u2', name: '配方改良', kind: 'prod', cost: upCost(1), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u3', name: '净化喷嘴', kind: 'eta', cost: upCost(2), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u4', name: '时钟校准', kind: 'speed', cost: upCost(3), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u5', name: '产线联动', kind: 'prod', cost: upCost(4), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u6', name: '记忆结晶', kind: 'eta', cost: upCost(5), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u7', name: '高峰时段', kind: 'prod', cost: upCost(6), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: '249u8', name: '产线总控', kind: 'prod', cost: upCost(7), desc: () => '产量 ×1.32/级。', mul: (l) => Dec.mul(Dec.mul(Dec.pow(l, 1.4), 2), Dec.pow(1.8, Math.floor(l / 10))) },
  ],
  techs: [
    { id: '249t1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '自动购买第 1 个升级。' : l < 8 ? `自动购买前 ${l} 个升级。` : l < TUNING.autoBuyMaxLevel ? '购买间隔 ×0.95/级，最低 0.05 秒。' : '满级：每秒 20 次，每次直接买到买不起。') },
    { id: '249t2', name: '超频', kind: 'mpByTime', cost: (l) => costOf(2, 1.4, l), maxLevel: Infinity,
      desc: () => '每次结算的记忆点数 ×(1 + 0.2 × 等级 × 本轮分钟数)。' },
    { id: '249t3', name: '增产', kind: 'ppByEarliness', cost: (l) => costOf(3, 1.3, l), maxLevel: Infinity,
      desc: () => '守护时拿到的净化点数 ×(1 + 0.2 × 等级 × 剩余分钟数)。' },
    { id: '249t4', name: '蓄势', kind: 'prodByTime', cost: (l) => costOf(5, 1.35, l), maxLevel: Infinity,
      desc: () => '产量 ×(1 + 0.05 × 等级 × 本轮分钟数)。' },
    { id: '249tb1', name: '强化·壹', kind: 'upBoost', pair: [0, 1], cost: (l) => costOf(5, 1.35, l), maxLevel: Infinity,
      desc: () => '第 1、2 对应两个升级的效果 ×2^等级。' },
    { id: '249tb2', name: '强化·贰', kind: 'upBoost', pair: [2, 3], cost: (l) => costOf(5, 1.35, l), maxLevel: Infinity,
      desc: () => '第 3、4 对应两个升级的效果 ×2^等级。' },
    { id: '249tb3', name: '强化·叁', kind: 'upBoost', pair: [4, 5], cost: (l) => costOf(5, 1.35, l), maxLevel: Infinity,
      desc: () => '第 5、6 对应两个升级的效果 ×2^等级。' },
    { id: '249tb4', name: '强化·肆', kind: 'upBoost', pair: [6, 7], cost: (l) => costOf(5, 1.35, l), maxLevel: Infinity,
      desc: () => '第 7、8 对应两个升级的效果 ×2^等级。' },
  ],
  tree: [
    { id: '249a1', name: '记忆归档', layer: 1, desc: () => '覆灭保留 20% 奶茶币。' },
    { id: '249a2', name: '时间加速', layer: 2, desc: () => '生产速度 ×(1 + 0.15 × 节点数)。' },
    { id: '249a3', name: '资源共鸣', layer: 2, desc: () => '覆灭记忆点数 ×(1 + 覆灭次数/4)。' },
    { id: '249a4', name: '净化协议', layer: 3, desc: () => '净化效率 ×(1 + 0.8 × 本轮进度)。' },
    { id: '249a5', name: '快速重启', layer: 3, desc: () => '开局奶茶币 ×(1 + 0.5 × 节点数)。' },
    { id: '249a6', name: '离线强化', layer: 3, desc: () => '离线收益 +30%。' },
    { id: '249a7', name: '产线扩张', layer: 4, desc: () => '产量 ×(1 + 0.01 × 全场总等级)^0.5。' },
    { id: '249a8', name: '记忆过载', layer: 4, desc: () => '产量 ×(1 + 本轮秒数/300)，上限 ×2。' },
    { id: '249a9', name: '记忆奇点', layer: 5, desc: () => '产量 ×2，并把 奶茶币^0.5 计入产量。' },
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
    { id: 'ywu1', name: '万事屋', kind: 'line', cost: upCost(0), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu2', name: '人脉', kind: 'prodAll', cost: upCost(1), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu3', name: '连锁', kind: 'line', cost: upCost(2), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu4', name: '共生', kind: 'prodAll', cost: upCost(3), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu5', name: '扩张', kind: 'line', cost: upCost(4), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu6', name: '门路', kind: 'prodAll', cost: upCost(5), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu7', name: '深度经营', kind: 'line', cost: upCost(6), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'ywu8', name: '分店', kind: 'prodAll', cost: upCost(7), desc: () => '全体产量 ×1.32/级。', mul: (l) => Dec.mul(Dec.mul(Dec.pow(l, 1.4), 2), Dec.pow(1.8, Math.floor(l / 10))) },
  ],
  techs: [
    { id: 'ywt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '自动购买第 1 个升级。' : l < 8 ? `自动购买前 ${l} 个升级。` : '购买间隔 ×0.95/级，最低 0.05 秒。') },
    { id: 'ywt2', name: '商业谈判', kind: 'shopDiscount', cost: (l) => costOf(2, 1.4, l), maxLevel: Infinity,
      desc: (l) => `记忆点数兑换价格增长率 ×0.97/级（下限 1.05，当前 ×${Math.max(1.05, 1.6 * Math.pow(0.97, l)).toFixed(3)}）。` },
    { id: 'ywt3', name: '渠道批发', kind: 'shopDiscountPP', cost: (l) => costOf(3, 1.5, l), maxLevel: Infinity,
      desc: (l) => `净化点数兑换价格增长率 ×0.97/级（下限 1.05，当前 ×${Math.max(1.05, 2.2 * Math.pow(0.97, l)).toFixed(3)}）。` },
    { id: 'ywt4', name: '资源转化', kind: 'crossChar', cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: (l) => `把 249 加成的 ${((0.2 * l) / (l + 10) * 100).toFixed(1)}% 叠到独立产线，独立产线的同比例叠到 249。` },
    { id: 'ywtb1', name: '强化·壹', kind: 'upBoost', pair: [0, 1], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 1、2 对应两个升级的效果 ×2^等级。' },
    { id: 'ywtb2', name: '强化·贰', kind: 'upBoost', pair: [2, 3], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 3、4 对应两个升级的效果 ×2^等级。' },
    { id: 'ywtb3', name: '强化·叁', kind: 'upBoost', pair: [4, 5], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 5、6 对应两个升级的效果 ×2^等级。' },
    { id: 'ywtb4', name: '强化·肆', kind: 'upBoost', pair: [6, 7], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 7、8 对应两个升级的效果 ×2^等级。' },
  ],
  tree: [
    { id: 'ywa1', name: '开张', layer: 1, desc: () => '独立产线 ×(1 + 0.2 × 覆灭次数)。' },
    { id: 'ywa2', name: '情报网', layer: 2, desc: () => '深渊增速 ×0.9/节点。' },
    { id: 'ywa3', name: '后勤保障', layer: 2, desc: () => '升级成本 ×0.9/节点。' },
    { id: 'ywa4', name: '挚友', layer: 3, desc: () => '白琦战力 ×(1 + 0.3 × 耶维奇等级 × 节点数)。' },
    { id: 'ywa5', name: '幕后', layer: 3, desc: () => '产量 ×(1 + 0.2 × 节点数)。' },
    { id: 'ywa6', name: '连锁经营', layer: 3, desc: () => '独立产线 ×(1 + 0.1 × 耶维奇等级)。' },
    { id: 'ywa7', name: '谈判', layer: 4, desc: () => '奶茶币获取 ×(1 + 0.5 × 覆灭次数)。' },
    { id: 'ywa8', name: '分号', layer: 4, desc: () => '独立产线 ×(1 + 0.5 × 节点数)。' },
    { id: 'ywa9', name: '万事屋本店', layer: 5, desc: () => '249 产量与独立产线 ×(1 + 0.15 × log10 对方产量)。' },
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
    { id: 'bqu1', name: '剑意', kind: 'powerRate', cost: upCost(0), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', rate: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu2', name: '剑技', kind: 'power', cost: upCost(1), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu3', name: '屠龙', kind: 'damage', cost: upCost(2), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu4', name: '剑心', kind: 'powerRate', cost: upCost(3), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu5', name: '逆鳞', kind: 'power', cost: upCost(4), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu6', name: '斩击', kind: 'damage', cost: upCost(5), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu7', name: '剑势', kind: 'powerRate', cost: upCost(6), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'bqu8', name: '剑魂', kind: 'power', cost: upCost(7), desc: () => '战力 ×1.32/级。', mul: (l) => Dec.mul(Dec.mul(Dec.pow(l, 1.4), 2), Dec.pow(1.8, Math.floor(l / 10))) },
  ],
  techs: [
    { id: 'bqt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '自动购买第 1 个升级。' : l < 8 ? `自动购买前 ${l} 个升级。` : '购买间隔 ×0.95/级，最低 0.05 秒。') },
    { id: 'bqt2', name: '蓄力斩', kind: 'charge', cost: (l) => costOf(2, 1.4, l), maxLevel: Infinity,
      desc: () => '每 3 秒蓄力，下击伤害 ×(1 + 1.5 × 等级)。' },
    { id: 'bqt3', name: '吸血', kind: 'lifesteal', cost: (l) => costOf(3, 1.5, l), maxLevel: Infinity,
      desc: (l) => `伤害的 ${(3 * l).toFixed(0)}% 转为奶茶币。` },
    { id: 'bqt4', name: '斩杀', kind: 'execute', cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: (l) => `深渊进度 < ${(10 + 4 * l).toFixed(0)}% 时伤害 ×(1 + 等级)^2。` },
    { id: 'bqtb1', name: '强化·壹', kind: 'upBoost', pair: [0, 1], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 1、2 对应两个升级的效果 ×2^等级。' },
    { id: 'bqtb2', name: '强化·贰', kind: 'upBoost', pair: [2, 3], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 3、4 对应两个升级的效果 ×2^等级。' },
    { id: 'bqtb3', name: '强化·叁', kind: 'upBoost', pair: [4, 5], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 5、6 对应两个升级的效果 ×2^等级。' },
    { id: 'bqtb4', name: '强化·肆', kind: 'upBoost', pair: [6, 7], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 7、8 对应两个升级的效果 ×2^等级。' },
  ],
  tree: [
    { id: 'bqa1', name: '拔剑', layer: 1, desc: () => '战力 ×(1 + 0.2 × 全场总等级)。' },
    { id: 'bqa2', name: '屠龙式', layer: 2, desc: () => '伤害 ×(1 + 1.5 × 本轮进度)^2。' },
    { id: 'bqa3', name: '逆鳞', layer: 2, desc: () => '暴击率 +8%/节点。' },
    { id: 'bqa4', name: '血脉共鸣', layer: 3, desc: () => '伤害 ×(1 + 本轮秒数/120)^0.5。' },
    { id: 'bqa5', name: '龙吼', layer: 3, desc: () => '伤害 ×(1 + 0.1 × 全场总等级)。' },
    { id: 'bqa6', name: '断罪', layer: 4, desc: () => '暴击伤害 +60%/节点。' },
    { id: 'bqa7', name: '真龙觉醒', layer: 4, desc: () => '真龙冷却 ×0.8/节点。' },
    { id: 'bqa8', name: '真龙形态', layer: 5, desc: () => '真龙每层 ×(1 + 0.5 × 白琦等级)。' },
    { id: 'bqa9', name: '屠龙者', layer: 5, desc: () => '每分钟深渊进度（对数）−8%。' },
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
    { id: 'hgu1', name: '骨钉', kind: 'power', cost: upCost(0), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu2', name: '同源', kind: 'alpha', cost: upCost(1), desc: () => '深渊转化 +0.005/级（上限 0.5）。', maxLevel: Infinity, add: (l) => Math.min(0.5, 0.005 * l) },
    { id: 'hgu3', name: '疾风', kind: 'atkSpeed', cost: upCost(2), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu4', name: '钉刺', kind: 'damage', cost: upCost(3), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu5', name: '深渊共鸣', kind: 'power', cost: upCost(4), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu6', name: '转化核心', kind: 'alpha', cost: upCost(5), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu7', name: '攻速核心', kind: 'atkSpeed', cost: upCost(6), desc: () => '产量 ×等级^1.4 ×1.5^⌊等级/10⌋。', mul: (l) => Dec.mul(Dec.pow(l, 1.4), Dec.pow(1.8, Math.floor(l / 10))) },
    { id: 'hgu8', name: '同源核心', kind: 'damage', cost: upCost(7), desc: () => '伤害 ×1.32/级。', mul: (l) => Dec.mul(Dec.mul(Dec.pow(l, 1.4), 2), Dec.pow(1.8, Math.floor(l / 10))) },
  ],
  techs: [
    { id: 'hgt1', name: '自动采购', kind: 'auto', cost: (l) => costOf(1, 1.35, l), maxLevel: TUNING.autoBuyMaxLevel,
      desc: (l) => (l < 1 ? '自动购买第 1 个升级。' : l < 8 ? `自动购买前 ${l} 个升级。` : '购买间隔 ×0.95/级，最低 0.05 秒。') },
    { id: 'hgt2', name: '共鸣爆发', kind: 'burst', cost: (l) => costOf(2, 1.4, l), maxLevel: Infinity,
      desc: () => '每 60 秒爆发一次，α ×(1 + 等级)。' },
    { id: 'hgt3', name: '爆发冷却', kind: 'burstCD', cost: (l) => costOf(3, 1.5, l), maxLevel: Infinity,
      desc: () => '爆发冷却 ×0.9/级。' },
    { id: 'hgt4', name: '爆发强化', kind: 'burstPower', cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '爆发期间伤害 ×(1 + 等级)。' },
    { id: 'hgtb1', name: '强化·壹', kind: 'upBoost', pair: [0, 1], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 1、2 对应两个升级的效果 ×2^等级。' },
    { id: 'hgtb2', name: '强化·贰', kind: 'upBoost', pair: [2, 3], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 3、4 对应两个升级的效果 ×2^等级。' },
    { id: 'hgtb3', name: '强化·叁', kind: 'upBoost', pair: [4, 5], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 5、6 对应两个升级的效果 ×2^等级。' },
    { id: 'hgtb4', name: '强化·肆', kind: 'upBoost', pair: [6, 7], cost: (l) => costOf(5, 1.6, l), maxLevel: Infinity,
      desc: () => '第 7、8 对应两个升级的效果 ×2^等级。' },
  ],
  tree: [
    { id: 'hga1', name: '骨钉', layer: 1, desc: () => '战力 ×(1 + 0.2 × 全场总等级)。' },
    { id: 'hga2', name: '同源', layer: 2, desc: () => 'α +0.03/节点。' },
    { id: 'hga3', name: '疾风', layer: 2, desc: () => '攻速 ×1.2/节点。' },
    { id: 'hga4', name: '钉刺', layer: 3, desc: () => '伤害 ×(1 + 1.5 × 本轮进度)^2。' },
    { id: 'hga5', name: '同源共鸣', layer: 3, desc: () => 'α ×(1 + 0.1 × 恒的等级)。' },
    { id: 'hga6', name: '深渊骑士', layer: 4, desc: () => '每分钟把深渊强度转成本轮战力。' },
    { id: 'hga7', name: '深渊之影', layer: 4, desc: () => '战力 ×(1 + 本轮秒数/120)^0.5。' },
    { id: 'hga8', name: '深渊之息', layer: 5, desc: () => '战力 ×(1 + 0.5 × 覆灭次数)。' },
    { id: 'hga9', name: '极速', layer: 5, desc: () => '攻速 ×min(3, 1 + 本轮秒数/120)。' },
  ],
};

// ─────────────────────────────────────────────
// 通用树：13 节点 = 1 中心（6 级自动化）+ 4 主干 + 8 叶子
// ─────────────────────────────────────────────
// 万事屋：用 mtc 兑换 MP / PP，价格随兑换次数指数增长
export const SHOP = {
  mp: { base: 10, growth: 1.6, amount: 1 },
  pp: { base: 25, growth: 2.2, amount: 1 },
};

export const AUTO_CENTER_MAX = 65;   // 1–6 解锁功能，7–65 压缩间隔（0.95^59 ≈ 0.05 秒）
export const AUTO_CENTER_FUNCS = 6;
const CENTER_STEPS = [
  '自动结算覆灭。',
  '自动结算净化。',
  '自动购买奶茶翻倍。',
  '自动购买记忆点数翻倍。',
  '自动购买净化点数翻倍。',
  '自动购买净化翻倍。',
];

export const GENERIC_TREE = [
  { id: 'g7', name: '自动化中枢', layer: 0, slot: 'center', repeat: true, cap: AUTO_CENTER_MAX,
    cost: (l) => costOf(1, 2, l), desc: (l) => CENTER_STEPS[l] || `自动间隔 ×0.95/级（当前 ${(1.0 * Math.pow(0.95, Math.max(0, l - 6))).toFixed(3)} 秒）。` },

  { id: 'g8', name: '奶茶翻倍', layer: 1, slot: 'trunk', angle: 45, parent: 'g7', repeat: true,
    cost: (l) => costOf(5, 4.9, l), desc: (l) => `产量 ×2/级，当前 ×${Math.pow(2, l)}。` },
  { id: 'g10', name: '记忆点数翻倍', layer: 1, slot: 'trunk', angle: -45, parent: 'g7', repeat: true,
    cost: (l) => costOf(10, 4.9, l), desc: (l) => `记忆点数获取 ×5/级，当前 ×${Math.pow(5, l)}。` },
  { id: 'g11', name: '净化点数翻倍', layer: 1, slot: 'trunk', angle: -135, parent: 'g7', repeat: true,
    cost: (l) => costOf(10, 4.9, l), desc: (l) => `净化点数获取 ×5/级，当前 ×${Math.pow(5, l)}。` },
  { id: 'g9', name: '净化翻倍', layer: 1, slot: 'trunk', angle: 135, parent: 'g7', repeat: true,
    cost: (l) => costOf(50, 18, l), desc: (l) => `净化效率 ×10/级，当前 ×${Math.pow(10, l)}。` },

  { id: 'g1', name: '产量共鸣', layer: 2, slot: 'leaf', angle: 90, parent: 'g8', repeat: false, cost: () => d(6),
    desc: (l, ctx) => `产量 ×(1 + 0.1 × 全场总等级)^0.5，当前 ×${Math.pow(1 + 0.1 * ctx.sumLAll, 0.5).toFixed(2)}。` },
  { id: 'g3', name: '升级折扣', layer: 2, slot: 'leaf', angle: 45, parent: 'g8', repeat: true, cap: 12,
    cost: (l) => costOf(10, 3, l), desc: (l) => `升级成本 ×0.88/级，当前 −${(100 - Math.pow(0.88, l) * 100).toFixed(0)}%。` },
  { id: 'g12', name: '深渊易伤', layer: 2, slot: 'leaf', angle: 0, parent: 'g10', repeat: true,
    cost: (l) => costOf(12, 2.2, l), desc: (l) => `战斗伤害 ×(1 + 0.5 × 等级)^(0.5 × 等级)，当前 ${l} 层。` },
  { id: 'g2', name: '净化共鸣', layer: 2, slot: 'leaf', angle: -45, parent: 'g10', repeat: false, cost: () => d(6),
    desc: (l, ctx) => `净化效率 ×(1 + 0.1 × 全场总等级)^0.5，当前 ×${Math.pow(1 + 0.1 * ctx.sumLAll, 0.5).toFixed(2)}。` },
  { id: 'g5', name: '时间感知', layer: 2, slot: 'leaf', angle: -90, parent: 'g11', repeat: false, cost: () => d(40),
    desc: () => '本轮最后 1/3 时间里，产量 ×(1 + 本轮秒数/60)。' },
  { id: 'g6', name: '先手优势', layer: 2, slot: 'leaf', angle: -135, parent: 'g11', repeat: true, cap: 8,
    cost: (l) => costOf(5, 2, l), desc: (l) => `开轮深渊起点 ×0.9/级，当前 −${(100 - Math.pow(0.9, l) * 100).toFixed(0)}%。` },
  { id: 'g4', name: '离线削弱', layer: 2, slot: 'leaf', angle: 180, parent: 'g9', repeat: false, cost: () => d(20),
    desc: () => '离线时深渊增速 ×0.25。' },
  { id: 'g13', name: '科技折扣', layer: 2, slot: 'leaf', angle: 135, parent: 'g9', repeat: true, cap: 10,
    cost: (l) => costOf(10, 3, l), desc: (l) => `科技成本 ×0.97/级，当前 −${(100 - Math.pow(0.97, l) * 100).toFixed(1)}%。` },
];

export const CHARACTERS = { '249': C249, yewei: YEWEI, baiqi: BAIQI, heng: HENG };
export const CHARACTER_ORDER = ['249', 'yewei', 'baiqi', 'heng'];

for (const c of Object.values(CHARACTERS)) {
  c.upgrades.forEach((u, i) => { u.reqLevel = REQ_LEVELS[i] || 0; u.maxLevel = u.maxLevel ?? Infinity; u.costMult = upCostMult(i); });
  c.techs.forEach((t) => { if (!t.maxLevel) t.maxLevel = 20; });
}

export function treeLayerCost(layer) {
  return Dec.pow(2, layer - 1).mul(TUNING.apLayerBase);
}
