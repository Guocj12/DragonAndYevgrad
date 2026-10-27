// src/engine.js — 外壳适配层。
//
// 唯一数值权威是 src/v5.js（= docs/数值设计.md §13 的参考模拟器，逐字一致）。
// 本文件**不做任何数值计算**：它只负责
//   ① 把用户的操作/时间换成 v5.Segment.tick() 的调用；
//   ② 片段结束后调用 v5.settle()（§7.2/§7.3），再把状态推到下一层或回第一层（§8）；
//   ③ 存读档（§9.3）、剧情播放（外壳）、面板视图模型。
// 任何"看起来更合理"的公式改动都必须改在 v5.js 里，然后重跑 tools/v5-verify.mjs。

import {
  CONFIG, Segment, effects, initialPermanent, snapshot, settle as settleNumeric,
  permanentCost, successPlaceholder, failureReward,
} from './v5.js';
import {
  CHARACTERS, CHARACTER_ORDER, CHAR_TO_LAYER, LAYER_TO_CHAR, TREE_ENABLED,
  TIER_NAMES, TUNING, itemsOf, FAILURE_NAMES, SUCCESS_NAMES,
} from './db.js';
import { STORY } from './story.js';
import { ACHIEVEMENTS } from './achievements.js';

export const STATE_VERSION = 'v5';
export const ENGINE_VERSION = 6;

// ─────────────────────────────────────────────────────────────
// 自动购买科技（每角色一条，0..22 级）
//   1–8 级：每 1 秒自动购买一次「第 L 个」升级（若已解锁且钱够）
//   9–21 级：触发间隔逐级压缩（每级 ×0.05^(1/13) ≈ ×0.794），到 21 级正好 0.05s = 每秒 20 次单次购买
//   22 级（满级）：每 tick（0.05s）执行一次「购买最大数量」= 20Hz 全自动
// 价格：249 前 8 级各 2，之后每级 ×2；其余角色前 8 级各 4 / 8 / 16，之后每级 ×2。
// 货币：记忆点数（MP）。
// ─────────────────────────────────────────────────────────────
export const AUTO_MAX_LEVEL = 22;
export const AUTO_BASE_COST = [2, 4, 8, 16];   // 层 1..4 的前 8 级单价
export const AUTO_INTERVAL_BASE = 1;           // 1–8 级的触发间隔（秒）
// 9–21 级（13 级）把间隔从 1s 压到正好 0.05s（= 每秒 20 次单次购买）。
// 所以每级倍率不是整数 0.8，而是 0.05^(1/13) ≈ 0.794328（0.8^13 会停在 0.055，只有 18.2 次/秒）。
export const AUTO_INTERVAL_STEP = 0.05 ** (1 / (AUTO_MAX_LEVEL - 9));   // 13 级压缩

export function autoTechCost(layer, level) {
  const base = AUTO_BASE_COST[layer - 1];
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

/** 全新状态（§2.2） */
export function createInitialState() {
  const permanent = initialPermanent();
  return {
    v: STATE_VERSION,
    layer: 1,
    permanent,
    runTicks: 0,
    seg: null,               // 运行时由引擎持有，存档时写进去
    runIndex: 1,
    finished: false,
    // 自动购买科技：每角色一条 0..22 级（默认 0 = 全手动；数值基准 = 全部 22 级）
    autoBuyLv: { 249: 0, yewei: 0, baiqi: 0, heng: 0 },
    autoTimer: { 249: 0, yewei: 0, baiqi: 0, heng: 0 },
    // 自动结算（默认全关：覆灭/守护都弹窗，点了才继续）
    auto: { collapse: false, guard: false },
    pending: null,           // null | { kind: 'collapse' | 'guard', layer, win, time, preview }
    pendingResult: null,     // 待结算片段的完整结果（存档要带）
    // 剧情 / 暂停（外壳，不影响数值）
    paused: false,
    storyQueue: [],
    storySeen: [],
    storyActive: false,
    settings: { skipReadStories: false },
    // 统计（只读，不参与任何公式）
    stats: {
      playTime: 0,
      ticks: 0,
      runs: 0,
      guards: 0,
      collapses: 0,
      failures: [0, 0, 0, 0],
      guardsByLayer: [0, 0, 0, 0],
      firstGuard: [false, false, false, false],
      firstCollapse: [false, false, false, false],
      bestPowerLog: 0,
      idleCollapses: 0,
    },
    ledger: [],              // 最近若干次结算账目（§7 账目回放用）
    lastSegment: null,
    achievements: [],        // 保留空壳；本轮不参与数值
  };
}

const fmtInt = (v) => (Number.isFinite(v) ? Math.round(v) : v);

// ─────────────────────────────────────────────────────────────
// 引擎
// ─────────────────────────────────────────────────────────────
export class Engine {
  constructor(state) {
    this.s = state || createInitialState();
    this.s.permanent = Object.assign(initialPermanent(), this.s.permanent || {});
    for (const k of ['failure', 'success']) {
      const arr = this.s.permanent[k];
      this.s.permanent[k] = [0, 1, 2, 3].map((i) => (Number.isFinite(arr?.[i]) ? arr[i] : 0));
    }
    this.storyConditions = true;
    this.b = null;
    // 自动购买科技：补齐字段（老档没有就全部 0 级 = 全手动）
    const lv = Object.assign({ 249: 0, yewei: 0, baiqi: 0, heng: 0 }, this.s.autoBuyLv || {});
    for (const id of CHARACTER_ORDER) lv[id] = Math.max(0, Math.min(AUTO_MAX_LEVEL, Number(lv[id]) || 0));
    this.s.autoBuyLv = lv;
    this.s.autoTimer = Object.assign({ 249: 0, yewei: 0, baiqi: 0, heng: 0 }, this.s.autoTimer || {});
    this.s.auto = Object.assign({ collapse: false, guard: false }, this.s.auto || {});
    if (this.s.seg && this.s.seg.tickIndex > 0) {
      this.seg = Segment.fromJSON(this.s.layer, this.s.permanent, this.s.seg);
      this.seg.autoBuy = false;
      this.seg.buyer = (sg) => this.autoBuyStep(sg);
    } else {
      this.seg = this.makeSegment(this.s.layer, this.s.runTicks);
    }
  }

  get state() { return this.s; }
  get permanent() { return this.s.permanent; }
  get unit() { return CONFIG.units[this.s.layer - 1]; }
  get targetInternal() { return CONFIG.targets[this.s.layer - 1] / CONFIG.units[this.s.layer - 1]; }
  get targetDisplay() { return CONFIG.targets[this.s.layer - 1]; }

  /** 显示口径 = 内部 × 单位倍率（§2.1） */
  display(v) { return v * this.unit; }

  /** 段构造：永远接上 buyer（自动购买科技），内建全自动关闭 */
  makeSegment(layer, runTicks) {
    const seg = new Segment(layer, this.permanent, { runTicks });
    seg.autoBuy = false;
    seg.buyer = (sg) => this.autoBuyStep(sg);
    return seg;
  }

  // ── 一个 20Hz tick（§8 的九步全在 v5.Segment.tick 里）──
  tick() {
    const s = this.s;
    if (s.finished) return null;
    if (s.pending) return null;                 // 等玩家点「覆灭 / 守护」弹窗
    if (s.paused || s.storyActive) return null;
    if (s.storyQueue.length) return null;
    const result = this.seg.tick();
    s.stats.playTime += CONFIG.dt;
    s.stats.ticks++;
    if (!result) { this.checkStoryConditions(); return null; }
    const kind = result.win ? 'guard' : 'collapse';
    if (s.auto[kind]) {                        // 自动结算（默认关）
      this.finishSegment(result);
      return result;
    }
    // 默认：停下来弹窗，玩家点了才结算并继续
    s.pendingResult = result;
    s.pending = {
      kind, layer: result.layer, win: result.win, time: result.time,
      preview: this.previewSettlement(result),
    };
    s.paused = true;
    return null;
  }

  /** 结算预览（在副本上跑 settle，不动真正状态） */
  previewSettlement(result) {
    const copy = {
      failure: [...this.permanent.failure], success: [...this.permanent.success],
      failureWallet: this.permanent.failureWallet, successWallet: this.permanent.successWallet,
    };
    const ev = settleNumeric(copy, result);
    const idx = result.layer - 1;
    return {
      kind: ev.kind, layer: result.layer, gained: ev.gained, spent: ev.spent,
      levelsGained: copy[ev.kind][idx] - this.permanent[ev.kind][idx],
      walletAfter: copy[`${ev.kind}Wallet`],
    };
  }

  /** 玩家点了弹窗按钮：结算该片段并继续 */
  resolvePending() {
    const s = this.s;
    if (!s.pending || !s.pendingResult) return null;
    const result = s.pendingResult;
    s.pending = null;
    s.pendingResult = null;
    s.paused = false;
    return this.finishSegment(result);
  }

  // ── 自动购买科技（0..22 级，每角色一条）──
  autoBuyInfo(charId) {
    const layer = CHAR_TO_LAYER[charId];
    const level = this.s.autoBuyLv[charId] || 0;
    let effect;
    if (level <= 0) effect = '不自动购买（全靠手动）';
    else if (level <= 8) effect = `每 1 秒自动购买一次第 ${level} 个升级`;
    else if (level < AUTO_MAX_LEVEL) {
      const iv = autoTechInterval(level);
      const ivText = iv >= 0.1 ? Number(iv.toFixed(2)) : Number(iv.toFixed(3));
      effect = `每 ${ivText} 秒自动购买一次「该角色最便宜的升级」（≈ ${(1 / iv).toFixed(2)} 次/秒）`;
    } else effect = '每 0.05 秒（20Hz）执行一次「购买最大数量」';
    return {
      charId, layer, level, maxLevel: AUTO_MAX_LEVEL,
      nextCost: level >= AUTO_MAX_LEVEL ? 0 : autoTechCost(layer, level),
      affordable: level < AUTO_MAX_LEVEL && this.permanent.failureWallet >= autoTechCost(layer, level),
      effect,
      interval: autoTechInterval(level),
    };
  }

  buyAutoTech(charId) {
    const info = this.autoBuyInfo(charId);
    if (info.level >= AUTO_MAX_LEVEL) return false;
    if (this.permanent.failureWallet < info.nextCost) return false;
    this.permanent.failureWallet -= info.nextCost;
    this.s.autoBuyLv[charId] = info.level + 1;
    return true;
  }

  /** 每 tick 在第 2 步被 Segment 调用：按各角色科技等级买 */
  autoBuyStep(seg) {
    const s = this.s;
    const dt = CONFIG.dt;
    let bought = 0;
    for (const id of CHARACTER_ORDER) {
      const layer = CHAR_TO_LAYER[id];
      const lv = s.autoBuyLv[id] || 0;
      if (lv <= 0) continue;
      if (lv >= AUTO_MAX_LEVEL) {
        // 满级：每 tick 一次「购买最大数量」（与数值基准完全一致）
        bought += seg.buyCheapestLoop(seg.tickIndex * dt);
        continue;
      }
      const interval = autoTechInterval(lv);
      s.autoTimer[id] = (s.autoTimer[id] || 0) + dt;
      if (s.autoTimer[id] + 1e-12 < interval) continue;
      s.autoTimer[id] -= interval;
      if (s.autoTimer[id] < 0) s.autoTimer[id] = 0;
      if (lv <= 8) {
        const index = (layer - 1) * 8 + (lv - 1);
        if (seg.items[index] && seg.unlocked[index] && seg.currency >= seg.prices[index]) {
          if (seg.buyItem(index)) bought++;
        }
      } else {
        bought += seg.buyCheapestForOwner(layer);
      }
    }
    return bought;
  }

  /** 片段结束：结算 → 换层 / 回第一层（§8、§9.1） */
  finishSegment(seg) {
    const s = this.s;
    // §8：先快照结算前 permanent 到 segment.permanent（seg.permanent 已是快照）
    const event = settleNumeric(this.permanent, seg);
    s.ledger.push({
      kind: event.kind, layer: event.layer, gained: event.gained, spent: event.spent,
      time: seg.time, win: seg.win, runTicks: seg.runTicks,
    });
    if (s.ledger.length > 400) s.ledger.shift();
    s.lastSegment = {
      layer: seg.layer, win: seg.win, time: seg.time, ticks: seg.ticks,
      peak: seg.peak, actualPeak: seg.actualPeak, pressure: seg.pressure,
      currency: seg.currency, hits: seg.hits, burstHits: seg.burstHits,
      purchaseCount: seg.purchaseCount, zeroSeconds: seg.zeroSeconds,
      levels: seg.levels.slice(), totals: seg.totals.slice(),
      gained: event.gained, spent: event.spent, kind: event.kind,
    };
    s.stats.bestPowerLog = Math.max(s.stats.bestPowerLog, Math.log10(Math.max(seg.peak, 1)));

    if (seg.win) {
      s.stats.guards++;
      s.stats.guardsByLayer[seg.layer - 1]++;
      s.stats.firstGuard[seg.layer - 1] = true;
      // §8：将片段 ticks 累加到 runTicks，再进入下一层
      s.runTicks += seg.ticks;
      if (seg.layer === 4) {
        s.finished = true;
        s.stats.runs++;
        this.s.seg = this.seg.toJSON();
        this.enqueueStory('win');
        return event;
      }
      s.layer = seg.layer + 1;
      this.seg = this.makeSegment(s.layer, s.runTicks);
      this.s.seg = this.seg.toJSON();
      this.enqueueStory('guard', seg.layer);
      return event;
    }

    // 失败：新轮 runTicks = 0，回第一层
    s.stats.collapses++;
    s.stats.failures[seg.layer - 1]++;
    s.stats.firstCollapse[seg.layer - 1] = true;
    s.stats.runs++;
    s.layer = 1;
    s.runTicks = 0;
    s.runIndex++;
    this.seg = this.makeSegment(1, 0);
    this.s.seg = this.seg.toJSON();
    this.enqueueStory('collapse', seg.layer);
    this.enqueueRestart();
    return event;
  }

  /** 离线 / 快进：按 tick 全量重放（§9.2 不允许合并攻击） */
  advance(seconds) {
    const dt = CONFIG.dt;
    let left = seconds, n = 0;
    while (left > 1e-9 && !this.s.finished) {
      while (this.s.storyQueue.length) this.finishStory();
      if (this.s.storyActive) this.s.storyActive = false;
      if (this.s.paused) break;
      const before = this.s.stats.ticks;
      this.tick();
      if (this.s.stats.ticks === before) break;   // 被暂停卡住，别死循环
      left -= dt;
      if (++n > 5e6) break;
    }
    return n;
  }

  // ── 视图模型 ──
  /** 当前 tick 的效果（纯函数，不写状态） */
  bonuses() {
    const seg = this.seg;
    const runTime = (this.s.runTicks + seg.tickIndex) * CONFIG.dt;
    const e = seg.lastEffects || effects(this.s.layer, seg.totals, this.permanent, seg.pressure, runTime);
    return e;
  }

  items() {
    const seg = this.seg;
    const defs = itemsOf(this.s.layer);
    const unit = this.unit;
    return defs.map((def, i) => ({
      ...def,
      index: i,
      level: seg.levels[i],
      unlocked: seg.unlocked[i],
      priceInternal: seg.prices[i],
      price: seg.prices[i] * unit,
      affordable: seg.unlocked[i] && seg.currency >= seg.prices[i],
      effective: seg.levels[i] / def.density,
      nextThreshold: def.threshold,
    }));
  }

  // ── 手动购买（外壳按钮）──
  // 只是把 v5.Segment 的同一段记账调出来：不改公式、不改价格、不改购买顺序规则。
  // 「购买最大数量」= 跑一次 tick 内那套「最便宜优先」循环（买到买不起为止）。
  buyItem(index) {
    const ok = this.seg.buyItem(index);
    if (ok) this.seg.lastEffects = null;
    return ok;
  }

  buyMaxOnce() {
    const n = this.seg.buyCheapestLoop();
    if (n) this.seg.lastEffects = null;
    return n;
  }

  /** 下一个即将解锁的项（数组顺序里的第一个未解锁项），没有则 -1 */
  nextUnlockIndex() {
    return this.seg.unlocked.findIndex((u) => !u);
  }

  /** 单项的机制说明（不含当前数值，用于「即将解锁」卡片；纯展示） */
  itemMechanism(item) {
    const L = this.s.layer, owner = item.owner, kind = item.kind;
    if (kind === 0) {
      if (L === 1 && owner === 1) return '一阶生产 ×1.5^有效等级';
      if (owner === 1) return '一阶生产加算 +有效等级';
      if (owner === 2) return '二阶生产加算 +3×有效等级';
      if (owner === 3) return '单次削减加算 +有效等级';
      return '削减频率 +2×有效等级/秒（上限 20/秒）';
    }
    if (owner === 1) return '资源转化 η = sqrt(1+有效等级/10)';
    if (owner === 2) return '全体效率 = sqrt(1+有效等级/10)';
    if (owner === 3) return '削减回收系数 ρ = 0.1·ln(1+有效等级)';
    return '敌方系数 = 1+ln(1+有效等级)/10·sqrt(深渊/10)';
  }

  /** 单项「当前等级带来的效果」，纯展示（不改任何状态） */
  itemEffect(item) {
    const eff = item.effective;
    const L = this.s.layer;
    // 显示口径：正常科学计数法（不强行改两位小数）
    const num = (x) => {
      if (!Number.isFinite(x)) return '—';
      const a = Math.abs(x);
      if (a === 0) return '0';
      if (a >= 1e6 || a < 1e-2) return x.toExponential(2);
      return String(Number(x.toFixed(3)));
    };
    const owner = item.owner, kind = item.kind;
    if (kind === 0) {
      if (L === 1 && owner === 1) return `一阶 ×1.5^${num(eff)}（当前 ×${num(1.5 ** eff)}）`;
      if (owner === 1) return `一阶加算 +${num(eff)}`;
      if (owner === 2) return `二阶加算 +${num(3 * eff)}（二阶 ×${num(1 + 3 * eff)}）`;
      if (owner === 3) return `单次削减加算 +${num(eff)}（×${num(1 + eff)}）`;
      return `削减频率 +${num(2 * eff)}/秒（上限 20/秒，溢出转伤害）`;
    }
    if (owner === 1) return `资源转化 η ×${num(Math.sqrt(1 + eff / 10))}`;
    if (owner === 2) return `全体效率 ×${num(Math.sqrt(1 + eff / 10))}`;
    if (owner === 3) return `回收系数 ρ ${num(0.1 * Math.log1p(eff))}`;
    return `敌方系数 ×${num(1 + Math.log1p(eff) / 10 * Math.sqrt(this.seg.pressure / 10))}`;
  }

  techs(charId) {
    const def = CHARACTERS[charId];
    const layer = CHAR_TO_LAYER[charId];
    return def.techs.map((t) => {
      if (t.kind === 'autoBuy') {
        const info = this.autoBuyInfo(charId);
        return {
          id: t.id, name: t.name, desc: t.desc, kind: t.kind,
          level: info.level, maxLevel: info.maxLevel, maxed: info.level >= info.maxLevel,
          nextCost: info.nextCost, affordable: info.affordable, effect: info.effect,
          enabled: info.level > 0,
        };
      }
      const level = this.permanent.failure[layer - 1];
      return {
        id: t.id, name: t.name, desc: t.desc, kind: t.kind, level,
        maxLevel: t.maxLevel, enabled: true,
        nextCost: permanentCost('failure', layer, level),
      };
    });
  }

  /** 成功永久（守护点数 = WS 购买的 U，§7.3/§7.4） */
  successes() {
    return SUCCESS_NAMES.map((meta, i) => {
      const level = this.permanent.success[i];
      return {
        ...meta, layer: i + 1,
        level,
        nextCost: permanentCost('success', i + 1, level),
        placeholderExp: CONFIG.success.placeholderExponent[i] * level,
      };
    });
  }

  view() {
    const s = this.s;
    const seg = this.seg;
    const e = this.bonuses();
    const unit = this.unit;
    const b = this.targetInternal;
    return {
      layer: s.layer,
      layerName: TIER_NAMES[s.layer - 1],
      charId: LAYER_TO_CHAR[s.layer],
      runIndex: s.runIndex,
      finished: s.finished,
      paused: s.paused,
      autoBuyLv: Object.assign({}, s.autoBuyLv),
      auto: Object.assign({}, s.auto),
      pending: s.pending ? { ...s.pending } : null,
      target: this.targetDisplay,
      targetInternal: b,
      power: seg.power,
      powerDisplay: seg.power * unit,
      pressure: seg.pressure,
      pressureDisplay: seg.pressure * unit,
      currency: seg.currency,
      currencyDisplay: seg.currency * unit,
      progress: Math.max(0, Math.min(1, seg.power / b)),
      pressureRatio: seg.power > 0 ? seg.pressure / seg.power : 0,
      runTicks: s.runTicks,
      // 通关后 runTicks 已经包含最后一段，不能再加 seg.tickIndex（否则最后一段被算两遍）
      runTime: (s.finished ? s.runTicks : s.runTicks + seg.tickIndex) * CONFIG.dt,
      layerTime: seg.tickIndex * CONFIG.dt,
      hits: seg.hits,
      burstHits: seg.burstHits,
      credit: seg.credit,
      permanent: snapshot(this.permanent),
      wallets: { mp: this.permanent.failureWallet, pp: this.permanent.successWallet },
      effects: e,
      placeholder: successPlaceholder(s.layer, this.permanent.success),
      stats: s.stats,
    };
  }

  // ── 剧情（外壳；触发字段已按数值状态重写）──
  condMet(w) {
    if (!w) return false;
    if (w.all) return w.all.every((x) => this.condMet(x));
    if (w.any) return w.any.some((x) => this.condMet(x));
    const s = this.s, seg = this.seg;
    switch (w.at) {
      case 'layer': return s.layer >= (w.n ?? 1);
      case 'power': return seg.power >= (w.gte ?? 0);
      case 'powerDisplay': return seg.power * this.unit >= (w.gte ?? 0);
      case 'currency': return seg.currency >= (w.gte ?? 0);
      case 'pressure': return seg.pressure >= (w.gte ?? 0);
      case 'hits': return seg.hits >= (w.n ?? 0);
      case 'progress': return seg.power / this.targetInternal >= (w.gte ?? 1);
      case 'time': return s.stats.playTime >= (w.sec ?? 0);
      case 'layerTime': return seg.tickIndex * CONFIG.dt >= (w.sec ?? 0);
      case 'runTicks': return s.runTicks >= (w.n ?? 0);
      case 'runs': return s.stats.runs >= (w.n ?? 0);
      case 'guards': return s.stats.guards >= (w.n ?? 0);
      case 'collapses': return s.stats.collapses >= (w.n ?? 0);
      case 'failure': return this.permanent.failure[(w.layer ?? 1) - 1] >= (w.n ?? 1);
      case 'success': return this.permanent.success[(w.layer ?? 1) - 1] >= (w.n ?? 1);
      case 'wallet': return (w.kind === 'success' ? this.permanent.successWallet : this.permanent.failureWallet) >= (w.n ?? 0);
      case 'level': {
        // w.char / w.position：该角色（层）8 项里第 position 项的等级
        const layer = CHAR_TO_LAYER[w.char];
        if (!layer || layer !== s.layer) return false;
        return seg.levels[w.position ?? 0] >= (w.level ?? 1);
      }
      default: return false;
    }
  }

  checkStoryConditions() {
    const s = this.s;
    if (!this.storyConditions) return;
    if (s.storyQueue.length || s.storyActive) return;
    if (!s.cache) s.cache = {};
    s.cache.storyTimer = (s.cache.storyTimer || 0) + CONFIG.dt;
    if (s.cache.storyTimer < 0.5) return;
    s.cache.storyTimer = 0;
    for (const entry of STORY) {
      if (entry.trigger.type !== 'cond') continue;
      if (s.storySeen.includes(entry.id)) continue;
      if (!this.condMet(entry.trigger.when)) continue;
      s.storyQueue.push(entry.id);
      s.storySeen.push(entry.id);
      s.paused = true;
      return;
    }
  }

  canPlayStory(entry) {
    const s = this.s;
    const seen = s.storySeen.includes(entry.id);
    if (!seen) return true;
    if (!entry.repeat) return false;
    return !s.settings.skipReadStories;
  }

  pushStory(entry) {
    const s = this.s;
    s.storyQueue.push(entry.id);
    if (!s.storySeen.includes(entry.id)) s.storySeen.push(entry.id);
    s.paused = true;
  }

  enqueueStory(event, layer) {
    const s = this.s;
    const atLayer = layer ?? s.layer;
    const totalOf = (ev) => (ev === 'guard' ? s.stats.guards : ev === 'collapse' ? s.stats.collapses : s.stats.runs);
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== event) continue;
      if (t.tier !== undefined && t.tier !== atLayer - 1) continue;
      if (t.count !== undefined && t.count !== totalOf(event)) continue;
      if (t.minCount !== undefined && totalOf(event) < t.minCount) continue;
      if (t.maxCount !== undefined && totalOf(event) > t.maxCount) continue;
      if (!this.canPlayStory(entry)) continue;
      this.pushStory(entry);
    }
  }

  enqueueRestart(auto = false) {
    const s = this.s;
    const seenBefore = new Set(s.storySeen);
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== 'restart') continue;
      if (t.count !== undefined && t.count !== s.stats.collapses) continue;
      if (t.onlyIfSeen && !seenBefore.has(t.onlyIfSeen)) continue;
      if (auto && s.storySeen.includes(entry.id)) continue;
      if (!this.canPlayStory(entry)) continue;
      this.pushStory(entry);
    }
  }

  nextStory() {
    const s = this.s;
    if (!s.storyQueue.length) return null;
    const id = s.storyQueue[0];
    s.storyActive = true;
    s.paused = true;
    return STORY.find((x) => x.id === id) || null;
  }

  finishStory() {
    const s = this.s;
    s.storyQueue.shift();
    s.storyActive = s.storyQueue.length > 0;
    s.paused = s.storyQueue.length > 0;
    return s.storyQueue.length > 0;
  }

  startStoryIfFirstRun() {
    this.enqueueRestart();
    const s = this.s;
    if (s.storyQueue.length) s.storyActive = true;
  }

  togglePause(force) {
    const s = this.s;
    if (s.storyActive || s.storyQueue.length) return;
    s.paused = force === undefined ? !s.paused : !!force;
  }

  checkAchievements() {
    const s = this.s;
    if (!s.achievements) s.achievements = [];
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id)) continue;
      if (a.check && a.check(s, this)) s.achievements.push(a.id);
    }
  }

  // ── 存读档（§9.3）──
  save() {
    this.s.seg = this.seg.toJSON();
    return JSON.stringify(this.s);
  }

  static load(text) {
    const raw = typeof text === 'string' ? JSON.parse(text) : text;
    if (!raw || raw.v !== STATE_VERSION) {
      const err = new Error('存档版本不符');
      err.code = 'VERSION_MISMATCH';
      err.found = raw && raw.v;
      throw err;
    }
    const base = createInitialState();
    const merged = Object.assign(base, raw);
    merged.permanent = Object.assign(initialPermanent(), raw.permanent || {});
    merged.stats = Object.assign(base.stats, raw.stats || {});
    merged.settings = Object.assign({}, base.settings, raw.settings || {});
    merged.ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
    return new Engine(merged);
  }

  // 排行榜字段：server.mjs 只白名单 tier/purified/cycles/guards/playTime/won/cleared，
  // 所以这里同时给一套兼容字段（tier=档号 0..3、purified=净化力对数、cycles=轮数），
  // 外加 V5 自己的字段供前端展示。
  metrics() {
    const s = this.s;
    const powerDisplay = this.seg.power * this.unit;
    return {
      tier: s.layer - 1,
      purified: Math.max(-1, Math.min(300000, Math.log10(Math.max(powerDisplay, 1)))),
      cycles: s.stats.runs,
      guards: s.stats.guards,
      playTime: Math.round(s.stats.playTime),
      won: s.finished,
      cleared: s.finished ? 1 : 0,
      // V5 附加字段
      layer: s.layer,
      powerLog: Math.log10(Math.max(this.seg.power, 1)),
      powerDisplayLog: Math.log10(Math.max(powerDisplay, 1)),
      F: this.permanent.failure.slice(),
      U: this.permanent.success.slice(),
      runIndex: s.runIndex,
      collapses: s.stats.collapses,
    };
  }
}

export { CONFIG, TIER_NAMES, TUNING, CHARACTERS, CHARACTER_ORDER, TREE_ENABLED, FAILURE_NAMES, SUCCESS_NAMES };
export { permanentCost, failureReward, successPlaceholder, snapshot, initialPermanent };
