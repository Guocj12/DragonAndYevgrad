// src/db.js — 外壳数据：四层（= 四个角色）的显示名、32 项升级名、每角色两个科技。
//
// 铁律：这里只放**名字和展示元数据**。任何数值参数（价格、门槛、密度、倍率、目标）
// 一律来自 src/v5.js 的 CONFIG / specification()，不得在本文件重新定义一份。
// 数值设计 §3.1：「名称只是显示标签，效果类型由 owner/kind 确定」。

import { CONFIG, specification, permanentCost } from './v5.js';

export const TUNING = {
  tickSeconds: CONFIG.dt,   // 0.05s，20Hz（§8）
};

// 档名（剧情 14-故事大纲 §四 与 10-设计文档；db 早期就落地过这张表）
export const TIER_NAMES = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆'];

// 每层 8 项的名字：位置 p=0..7 对应 A..H（§3.1）
// kind=0（p 偶）→ 该角色的主机制；kind=1（p 奇）→ 该角色的第二机制
export const ITEM_NAMES = {
  1: ['灌装线Ⅰ', '糖', '灌装线Ⅱ', '奶', '灌装线Ⅲ', '茶', '灌装线Ⅳ', '冰'],
  2: ['万事屋产线Ⅰ', '万事通Ⅰ', '万事屋产线Ⅱ', '万事通Ⅱ', '万事屋产线Ⅲ', '万事通Ⅲ', '万事屋产线Ⅳ', '万事通Ⅳ'],
  3: ['剑意Ⅰ', '拾残Ⅰ', '剑意Ⅱ', '拾残Ⅱ', '剑意Ⅲ', '拾残Ⅲ', '剑意Ⅳ', '拾残Ⅳ'],
  4: ['骨钉节拍Ⅰ', '同源Ⅰ', '骨钉节拍Ⅱ', '同源Ⅱ', '骨钉节拍Ⅲ', '同源Ⅲ', '骨钉节拍Ⅳ', '同源Ⅳ'],
};

// 分组标签（界面折叠旧项用）
export const ITEM_GROUPS = {
  1: ['灌装线', '配方'],
  2: ['万事屋产线', '万事通'],
  3: ['剑意', '拾残'],
  4: ['骨钉节拍', '同源'],
};

// 失败永久 F_s（= 角色的第二个科技，记忆点数购买，永不重置）
export const FAILURE_NAMES = [
  { id: 'memory', name: '记忆库', owner: '249' },
  { id: 'ledger', name: '人情账', owner: 'yewei' },
  { id: 'muscle', name: '手感', owner: 'baiqi' },
  { id: 'longrun', name: '长跑', owner: 'heng' },
];

// 成功永久 U_s（= 守护点数购买的占位强度，§7.4）
export const SUCCESS_NAMES = [
  { id: 'mark1', name: '守护印记·城内' },
  { id: 'mark2', name: '守护印记·城外' },
  { id: 'mark3', name: '守护印记·大陆' },
  { id: 'mark4', name: '守护印记·大陆之外' },
];

// 每角色两个科技（用户本轮口径）：
//   0 = 自动购买（数值基准恒开，见 §1「冻结版基准」；测试无需购买，不影响结果）
//   1 = 数值设计里的该层永久加成 F_s（记忆点数购买）
const AUTO_TECH = {
  id: 'autobuy',
  name: '自动购买',
  desc: '全局最便宜优先，每 tick 买到买不起（数值基准恒开）',
  cost: () => 0,
  maxLevel: 1,
  kind: 'autoBuy',
};

function failureTech(layer) {
  const meta = FAILURE_NAMES[layer - 1];
  return {
    id: `f${layer}`,
    name: meta.name,
    desc: failureTechDesc(layer),
    kind: 'failurePermanent',
    layer,
    maxLevel: Infinity,
    // 价格与等级完全由数值核给出（§7.2）
    cost: (level) => permanentCost('failure', layer, level),
  };
}

function failureTechDesc(layer) {
  switch (layer) {
    case 1: return '第一层有效总等级越高，生产越强（log1p((a+b)/20) × 1.6 × F1）';
    case 2: return '两个原始生产来源互相借用 share=F2/(3+F2)（只借一次）';
    case 3: return '每第 5 次削减强化：1+3·ln(1+F3)';
    case 4: return '削减随整程时间增长：1+0.5·ln(1+F4)·sqrt(runTime/600)';
    default: return '';
  }
}

export const CHARACTERS = {
  249: {
    id: '249', name: '249', title: '奶茶店人工智能', angle: 90, unlockTier: 0, layer: 1,
    blurb: '记得这店里发生过的所有事，唯独不记得你。',
    items: ITEM_NAMES[1], groups: ITEM_GROUPS[1],
    techs: [AUTO_TECH, failureTech(1)],
  },
  yewei: {
    id: 'yewei', name: '耶维奇', title: '万事屋店主', angle: 45, unlockTier: 1, layer: 2,
    blurb: '把世界末日当生意做的男人，因为他只会这个。',
    items: ITEM_NAMES[2], groups: ITEM_GROUPS[2],
    techs: [AUTO_TECH, failureTech(2)],
  },
  baiqi: {
    id: 'baiqi', name: '白琦', title: '屠龙少女', angle: 0, unlockTier: 2, layer: 3,
    blurb: '一把还在响的剑，和一个不知道自己为什么会使剑的人。',
    items: ITEM_NAMES[3], groups: ITEM_GROUPS[3],
    techs: [AUTO_TECH, failureTech(3)],
  },
  heng: {
    id: 'heng', name: '恒', title: '少年骑士', angle: -45, unlockTier: 3, layer: 4,
    blurb: '深渊吃不掉的人，世界也记不住。',
    items: ITEM_NAMES[4], groups: ITEM_GROUPS[4],
    techs: [AUTO_TECH, failureTech(4)],
  },
};

export const CHARACTER_ORDER = ['249', 'yewei', 'baiqi', 'heng'];
export const LAYER_TO_CHAR = { 1: '249', 2: 'yewei', 3: 'baiqi', 4: 'heng' };
export const CHAR_TO_LAYER = { 249: 1, yewei: 2, baiqi: 3, heng: 4 };

// 科技树：保留位置，但本轮不解锁（用户口径 3）
export const TREE_ENABLED = false;
export const GENERIC_TREE = [];
export const SHOP = [];

// 某一层的 8 项（名字挂到 specification 的条目上，数值字段不动）
export function itemsOf(layer) {
  return specification(layer).map((item) => ({
    ...item,
    name: ITEM_NAMES[item.owner][item.position],
    group: ITEM_GROUPS[item.owner][item.kind],
    shortId: String.fromCharCode(65 + item.position),
  }));
}
