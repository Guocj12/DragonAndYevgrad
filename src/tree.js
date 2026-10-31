// src/tree.js — 科技树数据（外壳）：布局沿用 586164c 的 vis-network 版本
//   中心 r0   = 自动化中枢（本版复活：13 级，PP 购买，前 7 级各 2 PP，之后每级 ×2）
//   主干 r1   = 四个斜角节点，**换成现有的四项成功科技**（净化效率 / 伤害效率 / MP 倍率 / PP 倍率）
//   叶子 r2   = 八个方向各一个，保留旧节点名，效果为空、价格 0（测试不买）
//   角色树 r3+ = 每个角色 9 节点 / 5 层，AP 解锁结构复原，但**效果为空、不可购买**
//
// 数值口径：主干节点的等级就是 permanent.success[0..3]，不另存一份，避免两套等级漂移。
// 中心节点的等级存在 engine.state.tree.center。

import { SUCCESS_NAMES, AUTO_INTERVAL_STEP as AUTOBUY_STEP } from './db.js';

// ── 中心：自动化中枢 ──
export const TREE_CENTER = {
  id: 'center',
  name: '自动化中枢',
  slot: 'center',
  maxLevel: 13,
  angle: 0,
};

// 每级解锁的效果（1..13）
export const CENTER_STEPS = [
  '自动购买：全角色科技',
  '自动覆灭结算',
  '自动守护结算',
  '自动购买主干「净化效率」',
  '自动购买主干「伤害效率」',
  '自动购买主干「记忆点数倍率」',
  '自动购买主干「守护点数倍率」',
  '购买间隔 ×0.8',
  '购买间隔 ×0.8',
  '购买间隔 ×0.8',
  '购买间隔 ×0.8',
  '购买间隔 ×0.8',
  '满级：每秒 20 次',
];

/** 中心价格：前 7 级各 2 PP，之后每级 ×2（Lv8=4, Lv9=8 … Lv13=128） */
export function centerCost(level) {
  if (level >= TREE_CENTER.maxLevel) return null;
  return level < 7 ? 2 : 2 * 2 ** (level - 6);
}

/**
 * 中心驱动的自动购买间隔（秒）：
 *   0 级 = 不自动；1–7 级 = 每秒一次；
 *   8–12 级 = 每级 ×0.7943（与「科技」里的自动购买同一个乘数）；13 级满级 = 0.05 秒（每秒 20 次）。
 */
export function treeInterval(level) {
  if (level <= 0) return Infinity;
  if (level <= 7) return 1;
  if (level >= TREE_CENTER.maxLevel) return 0.05;
  // 7 级之后的缩短乘数与「科技」里的自动购买同一个常量（0.05**(1/13) ≈ 0.7943）
  return AUTOBUY_STEP ** (level - 7);
}

// ── 主干：四个成功科技（顺序按用户口径：净化效率 → 伤害效率 → MP 倍率 → PP 倍率）──
// successIndex 指向 permanent.success：0=up(MP) 1=ud(MD) 2=us(MS) 3=uf(MF)
export const TREE_TRUNKS = [
  { id: 'trunk-up', slot: 'trunk', angle: 45, parent: 'center', successIndex: 0, name: '净化效率', stat: '产量', autoLevel: 4 },
  { id: 'trunk-ud', slot: 'trunk', angle: 135, parent: 'center', successIndex: 1, name: '伤害效率', stat: '攻击', autoLevel: 5 },
  { id: 'trunk-uf', slot: 'trunk', angle: -45, parent: 'center', successIndex: 3, name: '记忆点数倍率', stat: '覆灭收入', autoLevel: 6 },
  { id: 'trunk-us', slot: 'trunk', angle: -135, parent: 'center', successIndex: 2, name: '守护点数倍率', stat: '守护收入', autoLevel: 7 },
];

// ── 叶子：保留旧节点与位置，效果为空、价格 0 ──
export const TREE_LEAVES = [
  { id: 'leaf-1', slot: 'leaf', angle: 90, parent: 'trunk-up', name: '产量共鸣' },
  { id: 'leaf-2', slot: 'leaf', angle: 45, parent: 'trunk-up', name: '升级折扣' },
  { id: 'leaf-3', slot: 'leaf', angle: 0, parent: 'trunk-uf', name: '深渊易伤' },
  { id: 'leaf-4', slot: 'leaf', angle: -45, parent: 'trunk-uf', name: '净化共鸣' },
  { id: 'leaf-5', slot: 'leaf', angle: -90, parent: 'trunk-us', name: '时间感知' },
  { id: 'leaf-6', slot: 'leaf', angle: -135, parent: 'trunk-us', name: '先手优势' },
  { id: 'leaf-7', slot: 'leaf', angle: 180, parent: 'trunk-ud', name: '离线削弱' },
  { id: 'leaf-8', slot: 'leaf', angle: 135, parent: 'trunk-ud', name: '科技折扣' },
];

// ── 角色树：8 角色 × 9 节点（层 1..5）；结构复原，效果为空、不可购买 ──
const CHAR_NODE_NAMES = {
  249: ['记忆归档', '时间加速', '资源共鸣', '净化协议', '快速重启', '离线强化', '产线扩张', '记忆过载', '记忆奇点'],
  yewei: ['开张', '情报网', '后勤保障', '挚友', '幕后', '连锁经营', '谈判', '分号', '万事屋本店'],
  baiqi: ['拔剑', '屠龙式', '逆鳞', '血脉共鸣', '龙吼', '断罪', '真龙觉醒', '真龙形态', '屠龙者'],
  heng: ['骨钉', '同源', '疾风', '钉刺', '同源共鸣', '深渊骑士', '深渊之影', '深渊之息', '极速'],
  shuangjin: ['共鸣', '反向压制', '双生', '合鸣', '同频', '过载', '静默', '拮抗', '双禁'],
  xixi: ['微光', '蓄能', '放电', '余温', '长明', '灯塔', '过充', '星火', '曦光'],
  kongmiao: ['软垫', '缓冲', '回弹', '应激', '绒毛', '空转', '减震', '悬浮', '空喵'],
  xyt: ['刻痕', '侵蚀', '抑制', '疲劳', '深蚀', '结构', '崩解', '底噪', 'XyT'],
};

const LAYERS = [1, 2, 2, 3, 3, 3, 4, 4, 5];

export const CHAR_TREE_NODES = Object.fromEntries(
  Object.entries(CHAR_NODE_NAMES).map(([charId, names]) => [
    charId,
    names.map((name, i) => ({
      id: `${charId}-a${i + 1}`,
      charId,
      slot: 'char',
      name,
      layer: LAYERS[i],
      index: i,
    })),
  ]),
);

export const TREE_NODE_TOTAL =
  1 + TREE_TRUNKS.length + TREE_LEAVES.length
  + Object.values(CHAR_TREE_NODES).reduce((n, list) => n + list.length, 0);

/** 主干节点的名称与数值说明（与 SUCCESS_NAMES 同一份来源） */
export function trunkMeta(successIndex) {
  return SUCCESS_NAMES[successIndex];
}
