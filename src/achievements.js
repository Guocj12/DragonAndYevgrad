// src/achievements.js — 成就表（数据驱动）
// 每个成就永久保留（249 的记忆库，覆灭不清空），并为全体角色提供 +100%：
// 达成 N 个 → 全产量 / 战力 ×(1 + N)。
//
// 目前只列到「奶茶店」这一档能碰到的东西；后面的档位等玩到再加。

import { Dec } from './num.js';

const lg = (v) => Dec.log10(v);
const up = (s, id, i) => s.chars[id].upgrades[i] || 0;

export const ACHIEVEMENTS = [
  // ── 249 第一次买下每个升级 ──
  { id: 'b1', name: '开张', desc: '第一次买下「灌装线」', check: (s) => up(s, '249', 0) >= 1 },
  { id: 'b2', name: '换配方', desc: '第一次买下「配方改良」', check: (s) => up(s, '249', 1) >= 1 },
  { id: 'b3', name: '接喷嘴', desc: '第一次买下「净化喷嘴」', check: (s) => up(s, '249', 2) >= 1 },
  { id: 'b4', name: '对表', desc: '第一次买下「时钟校准」', check: (s) => up(s, '249', 3) >= 1 },
  { id: 'b5', name: '串线', desc: '第一次买下「产线联动」', check: (s) => up(s, '249', 4) >= 1 },
  { id: 'b6', name: '结晶', desc: '第一次买下「记忆结晶」', check: (s) => up(s, '249', 5) >= 1 },
  { id: 'b7', name: '高峰', desc: '第一次买下「高峰时段」', check: (s) => up(s, '249', 6) >= 1 },
  { id: 'b8', name: '总控', desc: '第一次买下「产线总控」', check: (s) => up(s, '249', 7) >= 1 },

  // ── 全自动 ──
  { id: 'auto', name: '全自动', desc: '自动采购解锁到 8 级：8 个升级全部自动购买', check: (s) => s.chars['249'].techs[0] >= 8 },

  // ── 覆灭 ──
  { id: 'c1', name: '第一次关门', desc: '覆灭 1 次', check: (s) => s.stats.collapses >= 1 },
  { id: 'c10', name: '熟门熟路', desc: '覆灭 10 次', check: (s) => s.stats.collapses >= 10 },
  { id: 'c249', name: '不觉得无聊吗', desc: '覆灭 249 次', check: (s) => s.stats.collapses >= 249 },

  // ── 单轮 ──
  { id: 't250', name: '超越249', desc: '在一轮里坚持 250 秒', check: (s) => s.t >= 250 },

  // ── 守护四片地方 ──
  { id: 'g0', name: '守住奶茶店', desc: '第一次在奶茶店净化', check: (s) => s.stats.tierGuards[0] >= 1 },
  { id: 'g1', name: '守住耶维城', desc: '第一次在耶维城净化', check: (s) => s.stats.tierGuards[1] >= 1 },
  { id: 'g2', name: '守住飞龙国', desc: '第一次在飞龙国净化', check: (s) => s.stats.tierGuards[2] >= 1 },
  { id: 'g3', name: '守住奶茶大陆', desc: '第一次在奶茶大陆净化', check: (s) => s.stats.tierGuards[3] >= 1 },

  // ── 产速 ──
  { id: 'p6', name: '一百万杯', desc: '产速达到 1e6/s', check: (s, e) => lg(e.bonuses().prodTotal) >= 6 },
  { id: 'p49', name: '二四九', desc: '产速达到 2e49/s', check: (s, e) => lg(e.bonuses().prodTotal) >= Math.log10(2) + 49 },
  { id: 'p249', name: '到顶了', desc: '产速达到 2.49e249/s', check: (s, e) => lg(e.bonuses().prodTotal) >= Math.log10(2.49) + 249 },

  // ── 手动 ──
  { id: 'm249', name: '手摇 249 次', desc: '点击生产按钮 249 次（长按整段只算一次）', check: (s) => (s.stats.manualProduce || 0) >= 249 },

  // ── 万事屋 ──
  { id: 'shop', name: '歪？', desc: '结识耶维奇后，在万事屋兑换一次记忆点数或净化点数', check: (s) => s.unlocked.includes('yewei') && (s.shop.mp + s.shop.pp) >= 1 },

  // ── 等级 ──
  { id: 'lv249', name: '249 级', desc: '任意一个升级到达 249 级', check: (s) => ['249', 'yewei', 'baiqi', 'heng'].some((id) => s.chars[id].upgrades.some((lv) => lv >= 249)) },

  // ── 摆烂 ──
  { id: 'idle', name: '摆烂', desc: '一整轮什么都不做，任由耶维城覆灭（自动购买不算）', check: (s) => s.stats.idleCollapses >= 1 },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
