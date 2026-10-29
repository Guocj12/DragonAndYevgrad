// src/engine.js — 外壳适配层（V8：八层 + 终局）。
//
// 唯一数值权威是 src/v8.js（= docs/数值设计.md §14 的逐句移植）。
// 本文件**不做任何数值计算**：它只负责
//   ① 把玩家操作 / 时间换成 v8.Segment.tick() 的调用；
//   ② 片段结束后调用 v8.settle()（§11.2），再把状态推到下一层 / 终局 / 回第一层；
//   ③ 存读档（§11.3）、剧情播放、面板视图模型、测试场景钩子。
// 任何"看起来更合理"的公式改动都必须改在 v8.js 里，然后重跑 tools/v8-verify.mjs。

import {
  CONFIG, GUARDS, Segment, Scientific, effects, initialPermanent, snapshot, settle as settleNumeric,
  permanentCost, failureReward, successReward, forceFromWork, TOTALS_NAMES,
} from './v8.js';
import {
  CHARACTERS, CHARACTER_ORDER, CHAR_TO_LAYER, LAYER_TO_CHAR, TIER_NAMES,
  TUNING, TECH_TREE, itemsOf, techsOf, FAILURE_NAMES, SUCCESS_NAMES,
  AUTO_MAX_LEVEL, autoTechCost, autoTechInterval, LAYER_MECHANICS,
} from './db.js';
import { STORY } from './story.js';
import { ACHIEVEMENTS } from './achievements.js';

export const STATE_VERSION = 'v8';
export const ENGINE_VERSION = 8;

/** 全新状态（§2.2 / §2.3） */
export function createInitialState() {
  const permanent = initialPermanent();
  return {
    v: STATE_VERSION,
    stage: 1,
    run: 1,
    runIndex: 1,
    permanent,
    runTicks: 0,
    seg: null,
    // 自动购买科技：每层一条 0..22 级。正式游戏默认 0（全手动）；验收脚本显式置 22。
    autoBuyLv: Object.fromEntries(CHARACTER_ORDER.map((id) => [id, 0])),
    autoTimer: Object.fromEntries(CHARACTER_ORDER.map((id) => [id, 0])),
    // 自动结算（默认全关：覆灭 / 守护都弹窗）
    auto: { collapse: false, guard: false },
    pending: null,
    pendingResult: null,
    paused: false,
    storyQueue: [],
    storySeen: [],
    storyActive: false,
    settings: { skipReadStories: false },
    stats: {
      playTime: 0,
      ticks: 0,
      runs: 0,
      guards: 0,
      collapses: 0,
      endgames: 0,
      failures: Array(8).fill(0),
      guardsByStage: Array(8).fill(0),
      firstGuard: Array(8).fill(false),
      firstCollapse: Array(8).fill(false),
      releases: 0,
      bufferSaved: 0,
      // 累计清理掉的深渊（真实量，跨轮跨层累加；只读统计）
      cleared: { mantissa: 0, exponent: 0 },
      bestPowerLog: 0,
    },
    ledger: [],
    lastSegment: null,
    achievements: [],
  };
}

const arr8 = (a) => Array.from({ length: 8 }, (_, i) => (Number.isFinite(a?.[i]) ? a[i] : 0));
const arr4 = (a) => Array.from({ length: 4 }, (_, i) => (Number.isFinite(a?.[i]) ? a[i] : 0));

export class Engine {
  constructor(state) {
    this.s = state || createInitialState();
    this.s.permanent = Object.assign(initialPermanent(), this.s.permanent || {});
    this.s.permanent.failure = arr8(this.s.permanent.failure);
    this.s.permanent.success = arr4(this.s.permanent.success);
    this.storyConditions = true;
    // headless = 纯数值模式：剧情不排队、不阻塞 tick。验收脚本 / 截图 / 离线补算都用它。
    this.headless = false;
    this.b = null;

    const lv = Object.assign(Object.fromEntries(CHARACTER_ORDER.map((id) => [id, 0])), this.s.autoBuyLv || {});
    for (const id of CHARACTER_ORDER) lv[id] = Math.max(0, Math.min(AUTO_MAX_LEVEL, Number(lv[id]) || 0));
    this.s.autoBuyLv = lv;
    this.s.autoTimer = Object.assign(Object.fromEntries(CHARACTER_ORDER.map((id) => [id, 0])), this.s.autoTimer || {});
    this.s.auto = Object.assign({ collapse: false, guard: false }, this.s.auto || {});
    this.s.stats = Object.assign(createInitialState().stats, this.s.stats || {});
    this.s.stats.failures = arr8(this.s.stats.failures);
    this.s.stats.guardsByStage = arr8(this.s.stats.guardsByStage);
    if (!this.s.stats.cleared || !Number.isFinite(this.s.stats.cleared.mantissa)) {
      this.s.stats.cleared = { mantissa: 0, exponent: 0 };
    }

    const segData = this.s.seg;
    if (segData && typeof segData === 'object' && (segData.stage ?? this.s.stage) === this.s.stage) {
      this.seg = Segment.fromJSON(this.s.stage, this.permanent, { runTicks: this.s.runTicks, ...segData });
    } else {
      this.seg = this.makeSegment(this.s.stage, this.s.runTicks);
    }
    this.s.seg = this.seg.toJSON();
  }

  get state() { return this.s; }
  get permanent() { return this.s.permanent; }
  get stage() { return this.s.stage; }
  get endgame() { return this.s.stage === 9; }

  /** 当前层的真实目标（Scientific） */
  get targetForce() { return forceFromWork(this.s.stage, CONFIG.coordinates[this.s.stage - 1]); }
  get targetWork() { return CONFIG.coordinates[this.s.stage - 1]; }
  get charId() { return LAYER_TO_CHAR[Math.min(this.s.stage, 8)]; }

  /** 当前层角色 id（终局用八层角色） */
  charOf(stage) { return LAYER_TO_CHAR[Math.min(stage, 8)]; }

  makeSegment(stage, runTicks) {
    const seg = new Segment(stage, this.permanent, { runTicks });
    seg.buyer = (sg) => this.autoBuyStep(sg);
    return seg;
  }

  // ── 一个 20Hz tick（§11.1 的 12 步全在 v8.Segment.tick 里）──
  tick() {
    const s = this.s;
    if (s.pending) return null;
    if (s.paused || s.storyActive) return null;
    if (s.storyQueue.length) return null;
    const result = this.seg.tick();
    s.stats.playTime += CONFIG.dt;
    s.stats.ticks++;
    if (!result) { this.checkStoryConditions(); return null; }
    const kind = result.win ? 'guard' : 'collapse';
    if (s.auto[kind]) { this.finishSegment(result); return result; }
    s.pendingResult = result;
    s.pending = {
      kind, stage: result.stage, win: result.win, time: result.time,
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
    const base = {
      kind: ev.kind, stage: result.stage, owner: ev.owner, gained: ev.gained, spent: ev.spent,
      walletAfter: copy[`${ev.kind}Wallet`],
    };
    if (ev.kind === 'success') {
      base.levels = copy.success.map((lv, i) => ({
        id: SUCCESS_NAMES[i].id, name: SUCCESS_NAMES[i].name,
        from: this.permanent.success[i], to: lv,
      }));
      base.levelsGained = base.levels.reduce((sum, x) => sum + (x.to - x.from), 0);
    } else {
      const i = ev.owner - 1;
      base.levels = [{ id: FAILURE_NAMES[i].id, name: FAILURE_NAMES[i].name,
        from: this.permanent.failure[i], to: copy.failure[i] }];
      base.levelsGained = copy.failure[i] - this.permanent.failure[i];
      base.level = { from: this.permanent.failure[i], to: copy.failure[i], name: FAILURE_NAMES[i].name };
    }
    return base;
  }

  resolvePending() {
    const s = this.s;
    if (!s.pending || !s.pendingResult) return null;
    const result = s.pendingResult;
    s.pending = null;
    s.pendingResult = null;
    s.paused = false;
    return this.finishSegment(result);
  }

  // ── 自动购买科技（0..22 级，每层一条）──
  autoBuyInfo(charId) {
    const stage = CHAR_TO_LAYER[charId];
    const level = this.s.autoBuyLv[charId] || 0;
    let effect;
    if (level <= 0) effect = '不自动购买（全靠手动）';
    else if (level <= 8) effect = `每 1 秒自动购买一次第 ${level} 项`;
    else if (level < AUTO_MAX_LEVEL) {
      const iv = autoTechInterval(level);
      const ivText = iv >= 0.1 ? Number(iv.toFixed(2)) : Number(iv.toFixed(3));
      effect = `每 ${ivText} 秒自动购买一次「本层最便宜的一项」（≈ ${(1 / iv).toFixed(2)} 次/秒）`;
    } else effect = '每 0.05 秒执行一次「本 tick 能买的全部」（数值基准）';
    return {
      charId, stage, level, maxLevel: AUTO_MAX_LEVEL,
      nextCost: level >= AUTO_MAX_LEVEL ? 0 : autoTechCost(stage, level),
      affordable: level < AUTO_MAX_LEVEL && this.permanent.failureWallet >= autoTechCost(stage, level),
      effect, interval: autoTechInterval(level),
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

  /** 每 tick 第 2 步：按当前层角色的科技等级买 */
  autoBuyStep(seg) {
    const s = this.s;
    const dt = CONFIG.dt;
    const id = this.charOf(seg.stage);
    const lv = s.autoBuyLv[id] || 0;
    if (lv <= 0) return 0;
    if (lv >= AUTO_MAX_LEVEL) return seg.defaultBuy();   // 与数值基准完全一致
    const interval = autoTechInterval(lv);
    s.autoTimer[id] = (s.autoTimer[id] || 0) + dt;
    if (s.autoTimer[id] + 1e-12 < interval) return 0;
    s.autoTimer[id] -= interval;
    if (s.autoTimer[id] < 0) s.autoTimer[id] = 0;
    const stage = seg.stage;
    if (lv <= 8) {
      const index = (stage - 1) * 8 + (lv - 1);
      if (seg.items[index] && seg.unlocked[index] && seg.wallet >= seg.prices[index]) {
        return seg.buyItem(index);
      }
      return 0;
    }
    return seg.buyCheapestForOwner(Math.min(stage, 8));
  }

  /** 片段结束：结算 → 换层 / 终局 / 回第一层（§11.2） */
  finishSegment(seg) {
    const s = this.s;
    const stage = seg.stage;
    const event = settleNumeric(this.permanent, seg);
    s.ledger.push({
      kind: event.kind, stage, owner: event.owner, gained: event.gained, spent: event.spent,
      time: seg.time, win: seg.win, runTicks: seg.runTicks,
    });
    if (s.ledger.length > 400) s.ledger.shift();

    const force = forceFromWork(stage, seg.peak);
    s.lastSegment = {
      stage, win: seg.win, time: seg.time, ticks: seg.ticks,
      peak: seg.peak, actualPeak: force.toString(), force: force.toJSON(),
      pressure: seg.pressure, wallet: seg.wallet, hits: seg.hits, burstHits: seg.burstHits,
      purchases: seg.purchases, releases: seg.releases, bufferSpent: seg.bufferSpent,
      savedTicks: seg.savedTicks, erosion: seg.erosion, fatigue: seg.fatigue,
      zeroSeconds: seg.zeroSeconds,
      levels: seg.levels.slice(), totals: seg.totals.slice(),
      gained: event.gained, spent: event.spent, kind: event.kind,
    };
    s.stats.bestPowerLog = Math.max(s.stats.bestPowerLog, force.log10());
    // 累计清理量（真实量，跨轮保留）；cleared 挂在 Segment 上逐事件累加（result 结构保持不变）
    s.stats.cleared = Scientific.fromJSON(s.stats.cleared).add(this.seg.cleared).toJSON();
    s.stats.releases += seg.releases;
    s.stats.bufferSaved += seg.savedTicks;

    if (seg.win) {
      s.stats.guards++;
      s.stats.guardsByStage[Math.min(stage, 8) - 1]++;
      s.stats.firstGuard[Math.min(stage, 8) - 1] = true;
      s.runTicks += seg.ticks;
      if (stage === 8) {
        // 八层成功 → 终局（stage 9，永不胜，只判失败）
        s.stage = 9;
        s.runTicks = 0;
        s.stats.endgames++;
        this.seg = this.makeSegment(9, 0);
        this.s.seg = this.seg.toJSON();
        this.enqueueStory('guard', 8);
        this.enqueueStory('endgame');
        return event;
      }
      s.stage = stage + 1;
      this.seg = this.makeSegment(s.stage, s.runTicks);
      this.s.seg = this.seg.toJSON();
      this.enqueueStory('guard', stage);
      return event;
    }

    // 失败（含终局失败）：新轮 runTicks = 0，回第一层
    s.stats.collapses++;
    s.stats.failures[Math.min(stage, 8) - 1]++;
    s.stats.firstCollapse[Math.min(stage, 8) - 1] = true;
    s.stats.runs++;
    s.stage = 1;
    s.runTicks = 0;
    s.run = (s.run || 1) + 1;
    s.runIndex = s.run;
    this.seg = this.makeSegment(1, 0);
    this.s.seg = this.seg.toJSON();
    this.enqueueStory('collapse', stage);
    this.enqueueRestart();
    return event;
  }

  /** 离线 / 快进：按 tick 全量重放（§11.3、§13 不允许合并攻击） */
  advance(seconds) {
    const dt = CONFIG.dt;
    let left = seconds, n = 0;
    while (left > 1e-9) {
      while (this.s.storyQueue.length) this.finishStory();
      if (this.s.storyActive) this.s.storyActive = false;
      if (this.s.paused) break;
      const before = this.s.stats.ticks;
      this.tick();
      if (this.s.stats.ticks === before) break;
      left -= dt;
      if (++n > 5e6) break;
    }
    return n;
  }

  // ── 视图模型 ──
  bonuses() {
    const seg = this.seg;
    const runTime = (this.s.runTicks + seg.tickIndex) * CONFIG.dt;
    const e = seg.lastEffects || effects(this.s.stage, seg.totals, this.permanent, seg.pressure, runTime);
    return e;
  }

  items() {
    const seg = this.seg;
    const defs = itemsOf(this.s.stage);
    return defs.map((def, i) => ({
      ...def,
      index: i,
      level: seg.levels[i] ?? 0,
      unlocked: !!seg.unlocked[i],
      priceInternal: seg.prices[i],
      price: seg.prices[i],
      affordable: !!seg.unlocked[i] && seg.wallet >= seg.prices[i],
      effective: (seg.levels[i] ?? 0) / def.density,
      nextThreshold: def.threshold,
      isOld: def.owner < Math.min(this.s.stage, 8),
    }));
  }

  buyItem(index) {
    const n = this.seg.buyItem(index);
    if (n) this.seg.lastEffects = null;
    return n > 0;
  }

  buyMaxOnce() {
    const n = this.seg.defaultBuy();
    if (n) this.seg.lastEffects = null;
    return n;
  }

  nextUnlockIndex() {
    return this.seg.unlocked.findIndex((u) => !u);
  }

  /** 单项机制说明（只展示，不含当前数值） */
  itemMechanism(item) {
    const owner = item.owner, kind = item.kind;
    const table = {
      1: ['生产：一层 1.5^有效等级；其余层 (1+有效等级)', '资源转化 η = √(1+有效等级/10)'],
      2: ['第二生产 R₂ = 1+3·有效等级', '全体效率 global = √(1+有效等级/10)'],
      3: ['单次削减 D 线性加算', '削减回收 ρ = 0.1·ln(1+有效等级)'],
      4: ['普通削减频率 = min(20, 1+2·有效等级)，超 20 转单次效率', '敌方系数 = 1+ln(1+有效等级)/10·√(压力/10)'],
      5: ['同步：生产弱时 SP = 1 + ln(D/P₀)·ln(1+有效等级)/10', '同步：削减弱时 SD = 1 + ln(P₀/D)·ln(1+有效等级)/10'],
      6: ['生产充能：每 tick 0.02·ln(1+有效等级)·P', '释放效率：×[1+2·ln(1+有效等级)]'],
      7: ['缓冲积累：0.1·ln(1+有效等级)·(1+ln(1+A))·dt', '吸收效率：×[1+0.2·ln(1+有效等级)]'],
      8: ['侵蚀施加：每次削减 0.01·ln(1+有效等级)·ln(1+removed)', '侵蚀抑制：0.1·ln(1+有效等级)·C·(1+ln(1+W))'],
    };
    const row = table[owner] || ['生产相关', '效率相关'];
    return row[kind];
  }

  /** 单项「当前有效等级带来的效果」，纯展示 */
  itemEffect(item) {
    const eff = item.effective;
    const owner = item.owner, kind = item.kind, stage = this.s.stage;
    const num = (x) => {
      if (!Number.isFinite(x)) return '—';
      const a = Math.abs(x);
      if (a === 0) return '0';
      if (a < 1) { const s = x.toPrecision(2); return s.includes('e') ? x.toFixed(6) : s; }
      if (a >= 1e6) return x.toExponential(2);
      return String(Number(x.toFixed(3)));
    };
    if (owner === 1 && kind === 0) {
      return stage === 1 ? `×1.5^${num(eff)}（当前 ×${num(1.5 ** eff)}）` : `一阶加算 +${num(eff)}`;
    }
    if (owner === 1 && kind === 1) return `η ×${num(Math.sqrt(1 + eff / 10))}`;
    if (owner === 2 && kind === 0) return `二阶 +${num(3 * eff)}（×${num(1 + 3 * eff)}）`;
    if (owner === 2 && kind === 1) return `global ×${num(Math.sqrt(1 + eff / 10))}`;
    if (owner === 3 && kind === 0) return `单次削减 +${num(eff)}`;
    if (owner === 3 && kind === 1) return `ρ ${num(0.1 * Math.log1p(eff))}`;
    if (owner === 4 && kind === 0) return `频率 +${num(2 * eff)}/秒（上限 20）`;
    if (owner === 4 && kind === 1) return `敌方系数 ×${num(1 + Math.log1p(eff) / 10 * Math.sqrt(this.seg.pressure / 10))}`;
    if (owner === 5 && kind === 0) return `同步补强 ln(1+${num(eff)})`;
    if (owner === 5 && kind === 1) return `同步补强 ln(1+${num(eff)})`;
    if (owner === 6 && kind === 0) return `充能 ×${num(0.02 * Math.log1p(eff))}/力量`;
    if (owner === 6 && kind === 1) return `释放 ×${num(1 + 2 * Math.log1p(eff))}`;
    if (owner === 7 && kind === 0) return `积累 ×${num(0.1 * Math.log1p(eff))}/秒`;
    if (owner === 7 && kind === 1) return `吸收 ×${num(1 + 0.2 * Math.log1p(eff))}`;
    if (owner === 8 && kind === 0) return `侵蚀 ×${num(0.01 * Math.log1p(eff))}/削减`;
    return `抑制 ×${num(0.1 * Math.log1p(eff))}`;
  }

  /** 每层两张科技卡：自动购买（树根）+ 该层失败永久 */
  techs(stage) {
    return techsOf(stage).map((t) => {
      if (t.kind === 'autoBuy') {
        const info = this.autoBuyInfo(this.charOf(stage));
        return {
          id: t.id, name: t.name, desc: t.desc, kind: t.kind,
          level: info.level, maxLevel: info.maxLevel, maxed: info.level >= info.maxLevel,
          nextCost: info.nextCost, affordable: info.affordable, effect: info.effect,
          enabled: info.level > 0,
        };
      }
      const level = this.permanent.failure[stage - 1];
      return {
        id: t.id, name: t.name, desc: t.desc, kind: t.kind, level,
        maxLevel: t.maxLevel, enabled: true,
        nextCost: permanentCost('failure', stage - 1, level),
        affordable: false,
      };
    });
  }

  /** 科技树：根 = 自动购买，四叶 = 四个成功科技 */
  techTree(stage) {
    const info = this.autoBuyInfo(this.charOf(stage));
    const leaves = TECH_TREE.leaves.map((leaf) => {
      const level = this.permanent.success[leaf.index];
      return {
        ...leaf,
        level,
        nextCost: permanentCost('success', leaf.index, level),
        // 成功科技只能用守护结算时自动买（§10.3），这里只读展示
        affordable: false,
      };
    });
    return {
      root: { ...TECH_TREE.root, level: info.level, maxLevel: info.maxLevel, maxed: info.level >= info.maxLevel, nextCost: info.nextCost, affordable: info.affordable, effect: info.effect },
      leaves,
      wallet: this.permanent.successWallet,
    };
  }

  successes() {
    return SUCCESS_NAMES.map((meta, i) => {
      const level = this.permanent.success[i];
      return {
        ...meta,
        index: i,
        level,
        nextCost: permanentCost('success', i, level),
      };
    });
  }

  view() {
    const s = this.s, seg = this.seg;
    const stage = s.stage;
    const e = this.bonuses();
    const force = forceFromWork(stage, seg.power);
    const pressForce = forceFromWork(stage, seg.pressure);
    const targetWork = CONFIG.coordinates[stage - 1];
    const logTarget = Math.log10(Math.max(targetWork, 1.0000001));
    const pct = (x) => (logTarget > 0
      ? Math.max(0, Math.min(1, Math.log10(Math.max(x, 1)) / logTarget)) : 0);
    return {
      stage,
      endgame: stage === 9,
      stageName: TIER_NAMES[stage - 1],
      charId: LAYER_TO_CHAR[Math.min(stage, 8)],
      layerMechanic: LAYER_MECHANICS[Math.min(stage, 8)],
      runIndex: s.runIndex,
      paused: s.paused,
      autoBuyLv: { ...s.autoBuyLv },
      auto: { ...s.auto },
      pending: s.pending ? { ...s.pending } : null,
      targetWork,
      targetForce: this.targetForce.toJSON(),
      power: seg.power,
      pressure: seg.pressure,
      wallet: seg.wallet,
      force: force.toJSON(),
      forceText: force.toString(),
      pressureForce: pressForce.toJSON(),
      pressureForceText: pressForce.toString(),
      powerPct: pct(seg.power),
      pressurePct: pct(seg.pressure),
      progress: Math.max(0, Math.min(1, seg.power / targetWork)),
      pressureRatio: seg.power > 0 ? seg.pressure / seg.power : 0,
      runTicks: s.runTicks,
      runTime: (s.runTicks + seg.tickIndex) * CONFIG.dt,
      stageTime: seg.tickIndex * CONFIG.dt,
      hits: seg.hits,
      burstHits: seg.burstHits,
      credit: seg.credit,
      energy: seg.energy,
      residual: seg.residual,
      buffer: seg.buffer,
      emergency: seg.emergency,
      bufferSpent: seg.bufferSpent,
      erosion: seg.erosion,
      fatigue: seg.fatigue,
      releases: seg.releases,
      savedTicks: seg.savedTicks,
      lastRelease: seg.lastRelease,
      permanent: snapshot(this.permanent),
      wallets: { mp: this.permanent.failureWallet, pp: this.permanent.successWallet },
      effects: e,
      totals: seg.totals.slice(),
      totalsNames: TOTALS_NAMES,
      cleared: Scientific.fromJSON(s.stats.cleared).add(seg.cleared).toJSON(),
      clearedStage: seg.cleared.toJSON(),
      clearedWork: seg.removedTotal,
      stats: s.stats,
    };
  }

  // ── 剧情（外壳；不改数值）──
  condMet(w) {
    if (!w) return false;
    if (w.all) return w.all.every((x) => this.condMet(x));
    if (w.any) return w.any.some((x) => this.condMet(x));
    const s = this.s, seg = this.seg;
    switch (w.at) {
      case 'layer': case 'stage': return s.stage >= (w.n ?? 1);
      case 'power': return seg.power >= (w.gte ?? 0);
      case 'wallet': return seg.wallet >= (w.gte ?? 0);
      case 'pressure': return seg.pressure >= (w.gte ?? 0);
      case 'hits': return seg.hits >= (w.n ?? 0);
      case 'progress': return seg.power / CONFIG.coordinates[s.stage - 1] >= (w.gte ?? 1);
      case 'time': return s.stats.playTime >= (w.sec ?? 0);
      case 'stageTime': return seg.tickIndex * CONFIG.dt >= (w.sec ?? 0);
      case 'runTicks': return s.runTicks >= (w.n ?? 0);
      case 'runs': return s.stats.runs >= (w.n ?? 0);
      case 'guards': return s.stats.guards >= (w.n ?? 0);
      case 'collapses': return s.stats.collapses >= (w.n ?? 0);
      case 'failure': return this.permanent.failure[(w.layer ?? 1) - 1] >= (w.n ?? 1);
      case 'success': return this.permanent.success[(w.layer ?? 1) - 1] >= (w.n ?? 1);
      case 'level': {
        const stage = CHAR_TO_LAYER[w.char];
        if (!stage || stage !== s.stage) return false;
        return seg.levels[w.position ?? 0] >= (w.level ?? 1);
      }
      default: return false;
    }
  }

  checkStoryConditions() {
    const s = this.s;
    if (this.headless || !this.storyConditions) return;
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
    if (this.headless) return;
    const s = this.s;
    s.storyQueue.push(entry.id);
    if (!s.storySeen.includes(entry.id)) s.storySeen.push(entry.id);
    s.paused = true;
  }

  enqueueStory(event, stage) {
    const s = this.s;
    const atStage = stage ?? s.stage;
    const totalOf = (ev) => (ev === 'guard' ? s.stats.guards : ev === 'collapse' ? s.stats.collapses : s.stats.runs);
    const seenBefore = new Set(s.storySeen);
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== event) continue;
      if (t.tier !== undefined && t.tier !== atStage - 1) continue;
      if (t.count !== undefined && t.count !== totalOf(event)) continue;
      if (t.minCount !== undefined && totalOf(event) < t.minCount) continue;
      if (t.maxCount !== undefined && totalOf(event) > t.maxCount) continue;
      if (t.onlyIfSeen && !seenBefore.has(t.onlyIfSeen)) continue;
      if (!this.canPlayStory(entry)) continue;
      this.pushStory(entry);
    }
  }

  enqueueRestart() {
    const s = this.s;
    const seenBefore = new Set(s.storySeen);
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== 'restart') continue;
      if (t.count !== undefined && t.count !== s.stats.collapses) continue;
      if (t.minCount !== undefined && s.stats.collapses < t.minCount) continue;
      if (t.maxCount !== undefined && s.stats.collapses > t.maxCount) continue;
      if (t.onlyIfSeen && !seenBefore.has(t.onlyIfSeen)) continue;
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

  // ── 存读档（§11.3）──
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

  /**
   * 测试 / 截图场景：把引擎放到某一层的干净片段。
   * demo > 0 时直接把等级/价格/totals 与机制状态铺成「看起来在跑」的样子
   * （有效等级 = demo，实际等级 = demo×density，所以旧层会出现上亿级 —— 与真实流程同量级）。
   * 只给 Playwright 与本地验收用；不参与游戏流程，也不影响存档校验。
   */
  scene(stage, { ticks = 0, autoLevel = AUTO_MAX_LEVEL, demo = 0, wallet = 0 } = {}) {
    const s = this.s;
    this.headless = true;
    for (const id of CHARACTER_ORDER) s.autoBuyLv[id] = autoLevel;
    s.stage = Math.max(1, Math.min(9, stage));
    s.runTicks = 0;
    s.pending = null;
    s.pendingResult = null;
    s.paused = false;
    s.storyQueue = [];
    s.storyActive = false;
    const seg = this.makeSegment(s.stage, 0);
    this.seg = seg;

    if (demo > 0) {
      const layer = Math.min(s.stage, 8);
      seg.unlocked.fill(true);
      seg.totals.fill(0);
      for (let i = 0; i < seg.items.length; i++) {
        const it = seg.items[i];
        const eff = Math.max(1, demo - (layer - it.owner) * 2);
        const L = Math.round(eff * it.density);
        seg.levels[i] = L;
        seg.prices[i] = it.firstPrice * Math.exp(it.step * L);
        seg.totals[(it.owner - 1) * 2 + it.kind] += L / it.density;
      }
      // 钱包给到「中位价格 ×1.5」：一半项买得起、一半买不起，截图才有对比
      const sorted = seg.unlocked.map((u, i) => (u ? seg.prices[i] : Infinity)).sort((a, b) => a - b);
      seg.wallet = wallet > 0 ? wallet : (sorted[Math.floor(sorted.length / 2)] * 1.5 || 1000);
      seg.tickIndex = 120;
      seg.hits = 42; seg.burstHits = 8; seg.credit = 0.35;
      if (s.stage >= 6) {
        seg.energy = 3.5; seg.residual = 1.25; seg.lastRelease = 80; seg.releases = 3;
      }
      if (s.stage >= 7) {
        seg.buffer = 12.5; seg.emergency = 0.42; seg.bufferSpent = 2.25; seg.savedTicks = 7;
      }
      if (s.stage >= 8) { seg.erosion = 3.1; seg.fatigue = 1.4; }
      seg.power = CONFIG.coordinates[s.stage - 1] * 0.62;
      seg.pressure = CONFIG.coordinates[s.stage - 1] * 0.35;
    }

    for (let i = 0; i < ticks; i++) {
      if (s.pending) { this.resolvePending(); continue; }
      this.tick();
    }
    this.s.seg = this.seg.toJSON();
    return this;
  }

  /** 排行榜字段 */
  metrics() {
    const s = this.s;
    const force = forceFromWork(s.stage, this.seg.power);
    const log = force.log10();
    return {
      tier: s.stage - 1,
      purified: Math.max(-1, Math.min(1e10, log)),
      purifiedExponent: Math.max(0, Math.min(1e10, log)),
      purifiedMantissa: force.mantissa,
      cycles: s.stats.runs,
      guards: s.stats.guards,
      playTime: Math.round(s.stats.playTime),
      won: false,
      cleared: s.stage === 9 ? 1 : 0,
      stage: s.stage,
      endgame: s.stage === 9,
      F: this.permanent.failure.slice(),
      U: this.permanent.success.slice(),
      runIndex: s.runIndex,
      collapses: s.stats.collapses,
    };
  }
}

export { CONFIG, TIER_NAMES, TUNING, CHARACTERS, CHARACTER_ORDER, CHAR_TO_LAYER, LAYER_TO_CHAR };
export { FAILURE_NAMES, SUCCESS_NAMES, AUTO_MAX_LEVEL, autoTechCost, autoTechInterval, GUARDS };
export { permanentCost, forceFromWork, snapshot, initialPermanent };
