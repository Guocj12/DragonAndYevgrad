// src/achievements.js — 成就表（数据驱动）
// 每个成就永久保留（属于 249 的记忆库，覆灭不清空），并为全体角色提供 +100% 加成：
// 达成 N 个 → 全产量 / 战力 ×(1 + N)。
//
// check(s, engine) 返回 true 即达成。引擎每 0.5 秒扫一次未达成的。

import { Dec } from './num.js';

const lg = (v) => Dec.log10(v);
const sumUp = (arr) => arr.reduce((a, b) => a + b, 0);

export const ACHIEVEMENTS = [
  // ── 覆灭 ──
  { id: 'c1', name: '第一次关门', desc: '覆灭 1 次', check: (s) => s.stats.collapses >= 1 },
  { id: 'c5', name: '熟门熟路', desc: '覆灭 5 次', check: (s) => s.stats.collapses >= 5 },
  { id: 'c20', name: '老主顾', desc: '覆灭 20 次', check: (s) => s.stats.collapses >= 20 },
  { id: 'c50', name: '习惯性重开', desc: '覆灭 50 次', check: (s) => s.stats.collapses >= 50 },
  { id: 'c100', name: '第 100 次开门', desc: '覆灭 100 次', check: (s) => s.stats.collapses >= 100 },
  { id: 'c300', name: '执念', desc: '覆灭 300 次', check: (s) => s.stats.collapses >= 300 },

  // ── 守护 ──
  { id: 'g1', name: '第一次守住', desc: '守护 1 次', check: (s) => s.stats.guards >= 1 },
  { id: 'g10', name: '守夜人', desc: '守护 10 次', check: (s) => s.stats.guards >= 10 },
  { id: 'g50', name: '城墙', desc: '守护 50 次', check: (s) => s.stats.guards >= 50 },
  { id: 'g100', name: '不眠', desc: '守护 100 次', check: (s) => s.stats.guards >= 100 },

  // ── 地名 ──
  { id: 't1', name: '走出店门', desc: '到达耶维城', check: (s) => s.stats.maxTier >= 1 },
  { id: 't2', name: '越过城墙', desc: '到达飞龙国', check: (s) => s.stats.maxTier >= 2 },
  { id: 't3', name: '大陆尽头', desc: '到达奶茶大陆', check: (s) => s.stats.maxTier >= 3 },

  // ── 产量 ──
  { id: 'p6', name: '一百万杯', desc: '产量达到 1e6/s', check: (s, e) => lg(e.bonuses().prodTotal) >= 6 },
  { id: 'p30', name: '装不下了', desc: '产量达到 1e30/s', check: (s, e) => lg(e.bonuses().prodTotal) >= 30 },
  { id: 'p100', name: '数字而已', desc: '产量达到 1e100/s', check: (s, e) => lg(e.bonuses().prodTotal) >= 100 },
  { id: 'p200', name: '记账的人', desc: '产量达到 1e200/s', check: (s, e) => lg(e.bonuses().prodTotal) >= 200 },

  // ── 单轮 ──
  { id: 'r600', name: '值班十分钟', desc: '单轮坚持 600 秒', check: (s) => s.t >= 600 },
  { id: 'r1800', name: '通宵', desc: '单轮坚持 1800 秒', check: (s) => s.t >= 1800 },

  // ── 手动 ──
  { id: 'm100', name: '手摇', desc: '手动生产 100 次', check: (s) => (s.stats.manualProduce || 0) >= 100 },
  { id: 'm1000', name: '手抽筋', desc: '手动生产 1000 次', check: (s) => (s.stats.manualProduce || 0) >= 1000 },

  // ── 升级总等级 ──
  { id: 'u100', name: '产线成型', desc: '全角色升级总等级 100', check: (s) => sumUp(s.chars['249'].upgrades) + sumUp(s.chars.yewei.upgrades) + sumUp(s.chars.baiqi.upgrades) + sumUp(s.chars.heng.upgrades) >= 100 },
  { id: 'u500', name: '流水线', desc: '全角色升级总等级 500', check: (s) => sumUp(s.chars['249'].upgrades) + sumUp(s.chars.yewei.upgrades) + sumUp(s.chars.baiqi.upgrades) + sumUp(s.chars.heng.upgrades) >= 500 },

  // ── 科技树 ──
  { id: 'k1', name: '第一片叶子', desc: '解锁 1 个树节点', check: (s) => Object.keys(s.generic).filter((k) => s.generic[k] > 0).length + Object.values(s.chars).reduce((a, c) => a + Object.keys(c.tree).length, 0) >= 1 },
  { id: 'k5', name: '枝头', desc: '解锁 5 个树节点', check: (s) => Object.keys(s.generic).filter((k) => s.generic[k] > 0).length + Object.values(s.chars).reduce((a, c) => a + Object.keys(c.tree).length, 0) >= 5 },
  { id: 'k10', name: '成荫', desc: '解锁 10 个树节点', check: (s) => Object.keys(s.generic).filter((k) => s.generic[k] > 0).length + Object.values(s.chars).reduce((a, c) => a + Object.keys(c.tree).length, 0) >= 10 },
  { id: 'k20', name: '记忆的形状', desc: '解锁 20 个树节点', check: (s) => Object.keys(s.generic).filter((k) => s.generic[k] > 0).length + Object.values(s.chars).reduce((a, c) => a + Object.keys(c.tree).length, 0) >= 20 },

  // ── 资源 ──
  { id: 'mp50', name: '记忆点', desc: '持有 50 记忆点数', check: (s) => Dec.gte(s.mp, 50) },
  { id: 'mp500', name: '记忆库', desc: '持有 500 记忆点数', check: (s) => Dec.gte(s.mp, 500) },
  { id: 'pp50', name: '净化者', desc: '持有 50 净化点数', check: (s) => Dec.gte(s.pp, 50) },
  { id: 'pp500', name: '净化流水', desc: '持有 500 净化点数', check: (s) => Dec.gte(s.pp, 500) },
  { id: 'ap10', name: '觉醒', desc: '持有 10 觉醒点', check: (s) => Dec.gte(s.ap, 10) },
  { id: 'ap20', name: '全点满', desc: '持有 20 觉醒点', check: (s) => Dec.gte(s.ap, 20) },

  // ── 万事屋 ──
  { id: 's10', name: '回头客', desc: '在万事屋兑换 10 次', check: (s) => (s.shop.mp + s.shop.pp) >= 10 },
  { id: 's100', name: '大客户', desc: '在万事屋兑换 100 次', check: (s) => (s.shop.mp + s.shop.pp) >= 100 },

  // ── 通关 ──
  { id: 'win', name: '井口的光', desc: '在一轮里净化到最高上限', check: (s) => s.won },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
