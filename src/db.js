// src/db.js — 外壳数据：八层的显示名、64 项升级名、八个失败科技、四个成功科技、科技树。
//
// 铁律：这里只放**名字和展示元数据**。任何数值参数（价格、门槛、密度、倍率、目标）
// 一律来自 src/v8.js 的 CONFIG / specification()，不得在本文件重新定义一份。
// 数值设计 §3.1：「名称只是显示标签，效果类型由 owner/kind 确定」。
//
// 命名口径（用户 2026-10-29 拍板）：
//   1–4 层沿用 249 / 耶维奇 / 白琦 / 恒；5–8 层新增 双禁 / 曦曦 / 空喵 / XyT（剧情后补）。
//   四个成功科技挂在科技树里：根 = 自动购买科技（保留），四个叶子 = 生产效率 / 削减效率 /
//   成功资源 / 失败资源。正式游戏爬梯默认 0 级，验收脚本显式置满级 22。

import { CONFIG, specification, permanentCost } from './v8.js';

export const TUNING = {
  tickSeconds: CONFIG.dt,   // 0.05s，20Hz（§11.1）
};

// 档名（八层 + 终局）
export const TIER_NAMES = [
  '奶茶店', '耶维城', '飞龙国', '奶茶大陆',
  '深渊回廊', '残光高塔', '骨白壁垒', '侵蚀之底', '深渊尽头',
];

// 每层 8 项的名字：位置 p=0..7 对应 A..H（§3.1）
// kind=0（p 偶）→ 该层的第一个机制；kind=1（p 奇）→ 第二个机制
export const ITEM_NAMES = {
  1: ['灌装线Ⅰ', '糖', '灌装线Ⅱ', '奶', '灌装线Ⅲ', '茶', '灌装线Ⅳ', '冰'],
  2: ['万事屋产线Ⅰ', '万事通Ⅰ', '万事屋产线Ⅱ', '万事通Ⅱ', '万事屋产线Ⅲ', '万事通Ⅲ', '万事屋产线Ⅳ', '万事通Ⅳ'],
  3: ['剑意Ⅰ', '拾残Ⅰ', '剑意Ⅱ', '拾残Ⅱ', '剑意Ⅲ', '拾残Ⅲ', '剑意Ⅳ', '拾残Ⅳ'],
  4: ['骨钉节拍Ⅰ', '同源Ⅰ', '骨钉节拍Ⅱ', '同源Ⅱ', '骨钉节拍Ⅲ', '同源Ⅲ', '骨钉节拍Ⅳ', '同源Ⅳ'],
  5: ['共鸣Ⅰ', '反压Ⅰ', '共鸣Ⅱ', '反压Ⅱ', '共鸣Ⅲ', '反压Ⅲ', '共鸣Ⅳ', '反压Ⅳ'],
  6: ['蓄能Ⅰ', '泄压Ⅰ', '蓄能Ⅱ', '泄压Ⅱ', '蓄能Ⅲ', '泄压Ⅲ', '蓄能Ⅳ', '泄压Ⅳ'],
  7: ['垫层Ⅰ', '吸收Ⅰ', '垫层Ⅱ', '吸收Ⅱ', '垫层Ⅲ', '吸收Ⅲ', '垫层Ⅳ', '吸收Ⅳ'],
  8: ['蚀刻Ⅰ', '抑制Ⅰ', '蚀刻Ⅱ', '抑制Ⅱ', '蚀刻Ⅲ', '抑制Ⅲ', '蚀刻Ⅳ', '抑制Ⅳ'],
};

// 分组标签（界面折叠用）
export const ITEM_GROUPS = {
  1: ['灌装线', '配方'],
  2: ['万事屋产线', '万事通'],
  3: ['剑意', '拾残'],
  4: ['骨钉节拍', '同源'],
  5: ['共鸣', '偏压'],
  6: ['蓄能', '泄压'],
  7: ['垫层', '吸收'],
  8: ['蚀刻', '抑制'],
};

// 每层的机制一句话（升级页顶部说明 / 截图用）
export const LAYER_MECHANICS = {
  1: '生产 + 力量资源转化',
  2: '第二生产 + 全体效率',
  3: '单次削减效率 + 削减回收',
  4: '普通削减频率 + 敌方转化',
  5: '同步：只补弱侧，强侧小回馈',
  6: '蓄能：生产充能，冷却满后一次性释放',
  7: '缓冲：触碰失败线时吸收本 tick 新增压力',
  8: '侵蚀：削弱压力增长，疲劳随侵蚀累积',
};

// 失败永久 n1..n8（记忆点数购买，永不重置）
export const FAILURE_NAMES = [
  { id: 'memory', name: '记忆库', effect: '有效等级越高，生产越强（一层 exp、高层 1+0.02 倍）' },
  { id: 'ledger', name: '人情账', effect: '两个原始生产来源互相借用，只借一次' },
  { id: 'muscle', name: '手感', effect: '每第 5 次普通削减乘以 1+3·ln(1+n3)' },
  { id: 'longrun', name: '长跑', effect: '所有削减随本程时间增长：1+0.5·ln(1+n4)·√(runTime/600)' },
  { id: 'resonance', name: '共振', effect: '第五层同步里，强侧从弱侧补强中取得 0.1·ln(1+n5) 回馈' },
  { id: 'afterheat', name: '余温', effect: '蓄能释放消耗的 spent 有 n6/(10+n6) 进入余能，30 秒尺度回充' },
  { id: 'stress', name: '应激', effect: '缓冲消耗后应急状态增加 0.1·ln(1+n7)·ln(1+used)，加快下次积累' },
  { id: 'fatigue', name: '疲劳', effect: '疲劳以 ln(1+n8)·ln(1+C) 累积，放大侵蚀对压力增长的削弱' },
];

// 成功永久（四项全局科技，§5.2 / §10.3）
export const SUCCESS_NAMES = [
  { id: 'up', key: 'up', name: '记忆·生产', stat: 'MP', desc: '生产效率：10^(系数×up + 重跑项)，只乘生产' },
  { id: 'ud', key: 'ud', name: '记忆·削减', stat: 'MD', desc: '削减效率：10^(0.06×ud)，只乘削减' },
  { id: 'us', key: 'us', name: '守护·余响', stat: 'MS', desc: '成功资源：(1+us)^0.02，只乘成功收入' },
  { id: 'uf', key: 'uf', name: '覆灭·余烬', stat: 'MF', desc: '失败资源：(1+uf)^0.02，只乘失败收入' },
];

// 自动购买科技（每层一条，0..22 级；正式游戏默认 0 级，验收脚本置满级）
export const AUTO_MAX_LEVEL = 22;
export const AUTO_BASE_COST = Array(8).fill(0).map((_, i) => [2, 4, 8, 16, 32, 64, 128, 256][i]);
export const AUTO_INTERVAL_BASE = 1;
export const AUTO_INTERVAL_STEP = 0.05 ** (1 / (AUTO_MAX_LEVEL - 9));

export function autoTechCost(stage, level) {
  const base = AUTO_BASE_COST[stage - 1];
  if (level < 8) return base;
  return base * 2 ** (level - 7);
}

/** 自动购买科技的触发间隔（秒）；0 级 = 不自动买；满级返回 0 表示"每 tick 购买最大数量" */
export function autoTechInterval(level, maxLevel = AUTO_MAX_LEVEL) {
  if (level <= 0) return Infinity;
  if (level <= 8) return AUTO_INTERVAL_BASE;
  if (level >= maxLevel) return 0;
  return AUTO_INTERVAL_BASE * AUTO_INTERVAL_STEP ** (level - 8);
}

// 科技树：根 = 自动购买，四个叶子 = 四个成功科技（用户口径：起点保留，四叶为成功科技）
export const TREE_ENABLED = true;

const AUTO_TECH = {
  id: 'autobuy',
  name: '自动购买',
  slot: 'root',
  desc: '本层的自动购买频率：1–8 级每秒买第 N 项；9–21 级逐级压缩间隔到 0.05 秒；22 级每 tick 买「本 tick 能买的全部」',
  kind: 'autoBuy',
  maxLevel: AUTO_MAX_LEVEL,
};

export const TECH_TREE = {
  root: { ...AUTO_TECH, angle: 0, radius: 0 },
  // 四个叶子：角度只用于绘制（上 / 右 / 下 / 左）
  leaves: SUCCESS_NAMES.map((s, i) => ({
    id: s.id,
    key: s.key,
    index: i,
    name: s.name,
    slot: 'leaf',
    stat: s.stat,
    desc: s.desc,
    angle: [90, 0, -90, 180][i],
    radius: 210,
  })),
};

function failureTech(stage) {
  const meta = FAILURE_NAMES[stage - 1];
  return {
    id: `f${stage}`,
    name: meta.name,
    desc: meta.effect,
    kind: 'failurePermanent',
    stage,
    maxLevel: Infinity,
    cost: (level) => permanentCost('failure', stage - 1, level),
  };
}

// 八层 = 八个角色（角色 id 只用于页签与存档，数值里只有 owner/layer）
export const CHARACTERS = {
  249: {
    id: '249', name: '249', title: '奶茶店人工智能', angle: 90, layer: 1, hasTree: true,
    blurb: '记得这店里发生过的所有事，唯独不记得你。',
    items: ITEM_NAMES[1], groups: ITEM_GROUPS[1],
  },
  yewei: {
    id: 'yewei', name: '耶维奇', title: '万事屋店主', angle: 45, layer: 2,
    blurb: '把世界末日当生意做的男人，因为他只会这个。',
    items: ITEM_NAMES[2], groups: ITEM_GROUPS[2],
  },
  baiqi: {
    id: 'baiqi', name: '白琦', title: '屠龙少女', angle: 0, layer: 3,
    blurb: '一把还在响的剑，和一个不知道自己为什么会使剑的人。',
    items: ITEM_NAMES[3], groups: ITEM_GROUPS[3],
  },
  heng: {
    id: 'heng', name: '恒', title: '少年骑士', angle: -45, layer: 4,
    blurb: '深渊吃不掉的人，世界也记不住。',
    items: ITEM_NAMES[4], groups: ITEM_GROUPS[4],
  },
  shuangjin: {
    id: 'shuangjin', name: '双禁', title: '共振者', angle: -90, layer: 5,
    blurb: '剧情设定后补。机制：同步——只补弱侧，强侧取得小回馈。',
    items: ITEM_NAMES[5], groups: ITEM_GROUPS[5],
  },
  xixi: {
    id: 'xixi', name: '曦曦', title: '蓄能者', angle: -135, layer: 6,
    blurb: '剧情设定后补。机制：蓄能——生产充能，冷却满后一次性释放。',
    items: ITEM_NAMES[6], groups: ITEM_GROUPS[6],
  },
  kongmiao: {
    id: 'kongmiao', name: '空喵', title: '缓冲者', angle: 180, layer: 7,
    blurb: '剧情设定后补。机制：缓冲——触碰失败线时吸收本 tick 新增压力。',
    items: ITEM_NAMES[7], groups: ITEM_GROUPS[7],
  },
  xyt: {
    id: 'xyt', name: 'XyT', title: '侵蚀者', angle: 135, layer: 8,
    blurb: '剧情设定后补。机制：侵蚀——削弱压力增长，疲劳随侵蚀累积。',
    items: ITEM_NAMES[8], groups: ITEM_GROUPS[8],
  },
};

export const CHARACTER_ORDER = ['249', 'yewei', 'baiqi', 'heng', 'shuangjin', 'xixi', 'kongmiao', 'xyt'];
export const LAYER_TO_CHAR = { 1: '249', 2: 'yewei', 3: 'baiqi', 4: 'heng', 5: 'shuangjin', 6: 'xixi', 7: 'kongmiao', 8: 'xyt' };
export const CHAR_TO_LAYER = { 249: 1, yewei: 2, baiqi: 3, heng: 4, shuangjin: 5, xixi: 6, kongmiao: 7, xyt: 8 };

// 每层两个科技卡片：自动购买（科技树根）+ 该层失败永久
export function techsOf(stage) {
  return [{ ...AUTO_TECH, kind: 'autoBuy', stage }, failureTech(stage)];
}

// 某一层的全部临时项目（名字挂到 specification 的条目上，数值字段不动）
export function itemsOf(stage) {
  return specification(stage).map((item) => ({
    ...item,
    name: ITEM_NAMES[item.owner][item.position],
    group: ITEM_GROUPS[item.owner][item.kind],
    layername: TIER_NAMES[item.owner - 1],
    shortId: String.fromCharCode(65 + item.position),
  }));
}
