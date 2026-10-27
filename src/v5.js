// src/v5.js — 数值核（V5）
//
// 唯一权威：docs/数值设计.md（V5）§1–§13。
// 本文件的每一个公式、每一个运算顺序、每一次 Math.* 调用都与文档 §13 的参考模拟器
// **逐字一致**，不得"优化"、不得重排、不得合并表达式 —— 否则浮点末位会漂，验收（与
// 参考模拟器输出完全一致）就过不了。
//
// 与参考模拟器的唯一区别：segment() 被拆成可增量步进的 Segment 类（外壳要暂停/剧情/
// 离线补算），但 tick() 的函数体是参考模拟器 for 循环体的**原文照抄**，变量同名、语序相同。
// tools/v5-verify.mjs 会逐字段对拍两者。

// ─────────────────────────────────────────────────────────────
// §13 CONFIG（原文照抄）
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  dt: 0.05,
  targets: [2.49e24, 249, 2492, 24920],
  units: [1, 1, 10, 100],
  firstUnlocks: [1, 32, 96, 240, 1e5, 1e9, 1e14, 1e20],
  firstCosts: [2.2, 10, 25, 50, 1e5, 1e9, 1e14, 1e20],
  firstRatios: [6, 4.3, 6, 4.3, 6, 4.3, 6, 4.3],
  currentUnlocks: [1, 3, 7, 15, 35, 75, 140, 200],
  tierCosts: [2.2, 2.5, 2.8, 3.2, 3.6, 4, 4.5, 5],
  ownerCostScale: 0.1,
  ratios: [[1.32, 1.4], [1.36, 1.44], [1.4, 1.4], [1.2, 1.4]],
  density: [8, 8, 8, 8],
  depthDensity: 10,
  productionScale: [0.3, 0.00425, 0.0025, 0.0009],
  pressureBase: [0.001, 0.01, 0.01, 0.01],
  pressureTimes: [530, 480, 270, 250],
  pressureExponent: 8,
  salvageScale: 0.1,
  firstProductionBase: 1.5,
  failure: {
    costBase: [4, 40, 400, 8000],
    costRatio: [1.35, 1.35, 1.35, 1.35],
    firstScale: 20,
    firstExponent: 1.6,
    firstHigherCompression: 0.08,
    transferKnee: 3,
    burstEvery: 5,
    burstCoefficient: 3,
    timeScale: 600,
    timeCoefficient: 0.5,
  },
  success: {
    reward: [40, 400, 4000, 40000],
    costBase: [40, 400, 4000, 40000],
    costRatio: [1.6, 1.6, 1.6, 1.6],
    placeholderExponent: [0.08, 0.04, 0.03, 0.02],
    ownPlaceholderExponent: [0.4, 0.12, 0.08, 0.08],
  },
};

const MAX_SEGMENT_TICKS = 20 * 7200;   // §11：7200 秒片段超时护栏

// ─────────────────────────────────────────────────────────────
// §13 specification（原文照抄）
// ─────────────────────────────────────────────────────────────
export function specification(layer) {
  const items = [];
  for (let owner = 1; owner <= layer; owner++) {
    for (let position = 0; position < 8; position++) {
      const kind = position % 2, tier = Math.floor(position / 2);
      const first = layer === 1;
      const density = first ? 1 : CONFIG.density[owner - 1] * CONFIG.depthDensity ** (layer - owner);
      const ratio = first ? CONFIG.firstRatios[position]
        : CONFIG.ratios[owner - 1][kind] ** (1 + tier * 0.1);
      const base = first ? CONFIG.firstCosts[position]
        : CONFIG.tierCosts[position] * CONFIG.ownerCostScale ** (owner - 1);
      const logStep = Math.log(ratio) / density;
      items.push({
        id: `${owner}${String.fromCharCode(65 + position)}`,
        owner, position, tier, kind, density, ratio, base, logStep,
        firstPrice: base * Math.expm1(logStep) / (ratio - 1),
        threshold: first ? CONFIG.firstUnlocks[position]
          : owner === layer ? CONFIG.currentUnlocks[position] : 1 + position * 0.1,
      });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// §13 永久体系（原文照抄）
// ─────────────────────────────────────────────────────────────
export function initialPermanent() {
  return { failure: [0, 0, 0, 0], success: [0, 0, 0, 0], failureWallet: 0, successWallet: 0 };
}

export function snapshot(permanent) {
  return { ...permanent, failure: [...permanent.failure], success: [...permanent.success] };
}

export function successPlaceholder(layer, levels) {
  const global = levels.reduce((sum, level, i) => sum + CONFIG.success.placeholderExponent[i] * level, 0);
  return 10 ** (global + CONFIG.success.ownPlaceholderExponent[layer - 1] * levels[layer - 1]);
}

export function failureReward(result) {
  const target = CONFIG.targets[result.layer - 1] / CONFIG.units[result.layer - 1];
  const progress = result.layer === 1
    ? Math.log10(result.peak) / Math.log10(target) : (result.peak - 1) / (target - 1);
  return Math.floor(4 * 10 ** (result.layer - 1 + progress));
}

export function permanentCost(kind, layer, level) {
  return Math.ceil(CONFIG[kind].costBase[layer - 1] * CONFIG[kind].costRatio[layer - 1] ** level);
}

export function settle(permanent, result) {
  const kind = result.win ? 'success' : 'failure';
  const gained = result.win ? CONFIG.success.reward[result.layer - 1] : failureReward(result);
  const wallet = `${kind}Wallet`, index = result.layer - 1;
  permanent[wallet] += gained;
  let spent = 0;
  while (permanent[wallet] >= permanentCost(kind, result.layer, permanent[kind][index])) {
    const price = permanentCost(kind, result.layer, permanent[kind][index]);
    permanent[wallet] -= price;
    spent += price;
    permanent[kind][index]++;
  }
  return { kind, layer: result.layer, gained, spent, after: snapshot(permanent) };
}

// ─────────────────────────────────────────────────────────────
// §13 效果 / 压力 / 购买 / 攻击 / 削减（原文照抄）
// ─────────────────────────────────────────────────────────────
export function effects(layer, totals, permanent, pressure, runTime) {
  const [a, b, c, d, e, f, g, j] = totals;
  const n = permanent.failure;
  const firstLogBonus = CONFIG.failure.firstExponent * n[0]
    * Math.log1p((a + b) / CONFIG.failure.firstScale);
  const firstBonus = layer === 1 ? Math.exp(firstLogBonus)
    : 1 + CONFIG.failure.firstHigherCompression * firstLogBonus;
  const rawFirst = layer === 1 ? CONFIG.firstProductionBase ** a * firstBonus
    : (1 + a) * firstBonus;
  const rawSecond = 1 + 3 * c;
  const share = n[1] / (CONFIG.failure.transferKnee + n[1]);
  // Both directions use immutable raw values, never the already-shared result.
  const first = rawFirst + (layer >= 2 ? share * (rawSecond - 1) : 0);
  const second = rawSecond + share * (rawFirst - 1);
  const placeholder = successPlaceholder(layer, permanent.success);
  const global = Math.sqrt(1 + d / 10);
  const production = CONFIG.productionScale[layer - 1] * placeholder * global
    * (layer === 1 ? first : first + second - 1);
  const conversion = Math.sqrt(1 + b / 10);
  const rawFrequency = 1 + 2 * g;
  const frequency = Math.min(20, rawFrequency);
  const overflow = Math.sqrt(Math.max(1, rawFrequency / 20));
  const timeMultiplier = 1 + CONFIG.failure.timeCoefficient * Math.log1p(n[3])
    * Math.sqrt(runTime / CONFIG.failure.timeScale);
  const hit = placeholder * global * (1 + e) * overflow * timeMultiplier
    * (1 + Math.log1p(j) / 10 * Math.sqrt(pressure / 10));
  const burst = 1 + CONFIG.failure.burstCoefficient * Math.log1p(n[2]);
  return {
    production, conversion, frequency, hit, burst, timeMultiplier,
    salvage: CONFIG.salvageScale * Math.log1p(f), placeholder, global,
    rawFirst, rawSecond, first, second, share, firstBonus,
  };
}

export function pressureRate(layer, time) {
  return CONFIG.pressureBase[layer - 1]
    * Math.exp((time / CONFIG.pressureTimes[layer - 1]) ** CONFIG.pressureExponent);
}

export function cheapest(items, prices, unlocked) {
  let best = -1;
  for (let i = 0; i < items.length; i++) {
    if (unlocked[i] && (best === -1 || prices[i] < prices[best])) best = i;
  }
  return best;
}

export function attackClock(credit, frequency) {
  const next = credit + frequency * CONFIG.dt;
  const hits = next >= 1 - 1e-12 ? 1 : 0;
  return { credit: Math.max(0, next - hits), hits };
}

export function suppress(pressure, hit, conversion) {
  const removed = Math.min(pressure, hit);
  return { pressure: pressure - removed, removed, resource: conversion * Math.log1p(removed) };
}

// ─────────────────────────────────────────────────────────────
// 层内片段：参考模拟器 segment() 的可步进版本（循环体原文照抄）
// ─────────────────────────────────────────────────────────────
export class Segment {
  constructor(layer, permanent, options = {}) {
    const items = specification(layer);
    this.items = items;
    this.layer = layer;
    this.permanent = permanent;
    this.runTicks = options.runTicks ?? 0;
    this.target = options.target ?? CONFIG.targets[layer - 1] / CONFIG.units[layer - 1];
    this.levels = items.map(() => 0);
    this.prices = items.map(i => i.firstPrice);
    this.unlocked = items.map(() => false);
    this.totals = Array(8).fill(0);
    this.unlocks = [];
    this.checkpoints = {};
    this.purchases = [];
    this.tickIndex = 0;
    this.power = 1;
    this.currency = 0;
    this.pressure = 0;
    this.credit = 0;
    this.hits = 0;
    this.burstHits = 0;
    this.purchaseCount = 0;
    this.purchaseTicks = 0;
    this.lastPurchase = 0;
    this.maxPurchaseGap = 0;
    this.zeroTicks = 0;
    this.recovered = false;
    this.compressed = false;
    this.salvageTotal = 0;
    this.removedTotal = 0;
    this.audit = !!options.audit;
    this.trace = !!options.trace;
    // 是否在 tick 内自动购买（默认开 = 数值基准；关掉之后由玩家手动买，
    // 只会改变"购买时机"，不会改变任何价格/效果公式）
    this.autoBuy = options.autoBuy !== false;
    // 外壳用：本 tick 的效果快照（不改动任何数值）
    this.lastEffects = null;
  }

  // 推进一个 tick；返回 null（进行中）或片段结果（与参考模拟器返回结构一致）
  tick() {
    const layer = this.layer, dt = CONFIG.dt, runTicks = this.runTicks;
    const items = this.items, levels = this.levels, prices = this.prices, unlocked = this.unlocked;
    const permanent = this.permanent, totals = this.totals;
    const tick = this.tickIndex;
    if (tick >= MAX_SEGMENT_TICKS) throw new Error(`Segment timeout at layer=${layer}`);

    for (let i = 0; i < items.length; i++) {
      if (!unlocked[i] && this.power >= items[i].threshold
          && (items[i].position === 0 || unlocked[i - 1])) {
        unlocked[i] = true;
        this.unlocks.push({ id: items[i].id, time: tick * dt, power: this.power });
      }
    }
    let bought = false;
    bought = this.autoBuy ? this.buyCheapestLoop(tick * dt) > 0 : false;
    if (bought) {
      this.purchaseTicks++;
      this.maxPurchaseGap = Math.max(this.maxPurchaseGap, tick * dt - this.lastPurchase);
      this.lastPurchase = tick * dt;
    }
    const elapsed = (runTicks + tick) * dt;
    const r = effects(layer, totals, permanent, this.pressure, elapsed);
    this.lastEffects = r;
    this.power += r.production * dt;
    this.currency += r.production * r.conversion * dt;
    this.pressure += pressureRate(layer, tick * dt) * dt;
    if (layer >= 3) {
      const clock = attackClock(this.credit, r.frequency);
      this.credit = clock.credit;
      if (clock.hits) {
        this.hits++;
        const enhanced = this.hits % CONFIG.failure.burstEvery === 0;
        if (enhanced) this.burstHits++;
        const hit = effects(layer, totals, permanent, this.pressure, elapsed).hit * (enhanced ? r.burst : 1);
        const outcome = suppress(this.pressure, hit, r.salvage);
        this.pressure = outcome.pressure;
        this.currency += outcome.resource;
        this.salvageTotal += outcome.resource;
        this.removedTotal += outcome.removed;
      }
    }
    if (![this.power, this.pressure, this.currency, this.credit].every(Number.isFinite)) {
      throw new Error(`Non-finite state at layer=${layer} tick=${tick}`);
    }
    if (layer >= 3 && this.pressure === 0) { this.zeroTicks++; this.compressed = true; }
    if (this.compressed && this.pressure > 0) this.recovered = true;
    for (const mark of [10, 25, 50, 100, 1000, 1e6, 1e12, 1e18]) {
      if (this.power >= mark && this.checkpoints[mark] === undefined) this.checkpoints[mark] = (tick + 1) * dt;
    }
    const win = this.power >= this.target;
    this.tickIndex++;
    if (win || this.pressure >= this.power) return this.result(win);
    return null;
  }

  // 购买循环（tick 的第 2 步）。手动「购买最大数量」调用的就是**这一段**，
  // 所以手动与自动的记账完全一致（§4.4：买一次就重排一次，同价按数组顺序）。
  buyCheapestLoop(timeStamp = this.tickIndex * CONFIG.dt) {
    const items = this.items, levels = this.levels, prices = this.prices, unlocked = this.unlocked;
    let bought = 0;
    for (let count = 0; ; count++) {
      if (count > 1000000) throw new Error('Purchase runaway');
      const i = cheapest(items, prices, unlocked);
      if (i === -1 || this.currency < prices[i]) break;
      if (this.audit) {
        for (let j = 0; j < items.length; j++) if (unlocked[j]) assert(prices[i] <= prices[j]);
      }
      this.currency -= prices[i];
      levels[i]++;
      this.totals[(items[i].owner - 1) * 2 + items[i].kind] += 1 / items[i].density;
      prices[i] = items[i].firstPrice * Math.exp(items[i].logStep * levels[i]);
      this.purchaseCount++;
      bought++;
      if (this.trace) this.purchases.push({ id: items[i].id, time: timeStamp, level: levels[i] });
    }
    return bought;
  }

  // 手动购买指定一项（外壳按钮）。记账与上面的循环逐字相同，只是不重排、只买一级。
  buyItem(i) {
    const item = this.items[i];
    if (!item || !this.unlocked[i]) return false;
    if (!(this.currency >= this.prices[i])) return false;
    this.currency -= this.prices[i];
    this.levels[i]++;
    this.totals[(item.owner - 1) * 2 + item.kind] += 1 / item.density;
    this.prices[i] = item.firstPrice * Math.exp(item.logStep * this.levels[i]);
    this.purchaseCount++;
    return true;
  }

  result(win) {
    const tick = this.tickIndex;
    const layer = this.layer;
    return {
      layer, permanent: snapshot(this.permanent), win, ticks: tick, time: tick * CONFIG.dt,
      runTicks: this.runTicks, peak: this.power, actualPeak: this.power * CONFIG.units[layer - 1],
      pressure: this.pressure, currency: this.currency,
      levels: this.levels, unlocked: this.unlocked, totals: this.totals, unlocks: this.unlocks,
      checkpoints: this.checkpoints, hits: this.hits, burstHits: this.burstHits,
      salvageTotal: this.salvageTotal, removedTotal: this.removedTotal,
      purchaseCount: this.purchaseCount, purchaseTicks: this.purchaseTicks,
      maxPurchaseGap: this.maxPurchaseGap, zeroSeconds: this.zeroTicks * CONFIG.dt,
      recovered: this.recovered,
      ...(this.trace ? { purchases: this.purchases } : {}),
    };
  }

  // ── 外壳用：存档 / 读档（只搬状态，不改数值）──
  toJSON() {
    return {
      layer: this.layer, runTicks: this.runTicks, target: this.target, tickIndex: this.tickIndex,
      levels: this.levels, prices: this.prices, unlocked: this.unlocked, totals: this.totals,
      power: this.power, currency: this.currency, pressure: this.pressure, credit: this.credit,
      hits: this.hits, burstHits: this.burstHits, purchaseCount: this.purchaseCount,
      purchaseTicks: this.purchaseTicks, lastPurchase: this.lastPurchase,
      maxPurchaseGap: this.maxPurchaseGap, zeroTicks: this.zeroTicks,
      recovered: this.recovered, compressed: this.compressed,
      salvageTotal: this.salvageTotal, removedTotal: this.removedTotal,
      unlocks: this.unlocks, checkpoints: this.checkpoints,
      autoBuy: this.autoBuy,
    };
  }

  static fromJSON(layer, permanent, obj) {
    const seg = new Segment(layer, permanent, { runTicks: obj.runTicks ?? 0, target: obj.target, autoBuy: obj.autoBuy !== false });
    seg.tickIndex = obj.tickIndex ?? 0;
    if (Array.isArray(obj.levels)) seg.levels = obj.levels.map(Number);
    if (Array.isArray(obj.prices)) seg.prices = obj.prices.map(Number);
    if (Array.isArray(obj.unlocked)) seg.unlocked = obj.unlocked.map(Boolean);
    if (Array.isArray(obj.totals)) seg.totals = obj.totals.map(Number);
    for (const k of ['power', 'currency', 'pressure', 'credit']) {
      if (Number.isFinite(obj[k])) seg[k] = obj[k];
    }
    for (const k of ['hits', 'burstHits', 'purchaseCount', 'purchaseTicks', 'lastPurchase',
      'maxPurchaseGap', 'zeroTicks', 'salvageTotal', 'removedTotal']) {
      if (Number.isFinite(obj[k])) seg[k] = obj[k];
    }
    seg.recovered = !!obj.recovered;
    seg.compressed = !!obj.compressed;
    if (Array.isArray(obj.unlocks)) seg.unlocks = obj.unlocks;
    if (obj.checkpoints && typeof obj.checkpoints === 'object') seg.checkpoints = obj.checkpoints;
    return seg;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// 参考模拟器的 segment()：整段跑完（对拍用）
export function segment(layer, permanent, options = {}) {
  const seg = new Segment(layer, permanent, options);
  for (;;) {
    const result = seg.tick();
    if (result) return result;
  }
}

// 参考模拟器的 campaign()：整程跑完（对拍用）
export function campaign(options = {}) {
  const permanent = initialPermanent(), runs = [], failures = [0, 0, 0, 0];
  const firstWins = [], firstEntries = [];
  for (let run = 1; run <= 300; run++) {
    const before = snapshot(permanent), segments = [], settlements = [];
    let runTicks = 0;
    for (let layer = 1; layer <= 4; layer++) {
      const s = segment(layer, permanent, { ...options, runTicks });
      firstEntries[layer - 1] ??= { run, ...s };
      segments.push(s);
      runTicks += s.ticks;
      const settlement = settle(permanent, s);
      settlements.push(settlement);
      if (s.win) firstWins[layer - 1] ??= { run, ...s };
      if (!s.win || layer === 4) {
        if (!s.win) failures[layer - 1]++;
        runs.push({
          run, before, after: snapshot(permanent), time: runTicks * CONFIG.dt,
          failedLayer: s.win ? null : layer, complete: s.win && layer === 4,
          segments, settlements,
        });
        if (s.win) return { failures, permanent: snapshot(permanent), runs, firstWins, firstEntries };
        break;
      }
    }
  }
  throw new Error('Campaign did not finish in 300 runs');
}
