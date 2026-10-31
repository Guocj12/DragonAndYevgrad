// src/v8.js — 数值核（V8：八层 + 终局）
//
// 唯一权威：docs/数值设计.md（V8，2026-10-29）§1–§14。
// 本文件是 §14「完整独立模拟器」的**逐字移植**：同一个 CONFIG、同一个 Scientific、
// 同一个 specification/effects/settle，循环体按语句顺序照抄，只把「整段 for 循环」
// 拆成可增量步进的 Segment（外壳要暂停 / 剧情 / 存档续跑 / 离线补算）。
//
// 铁律（与 V5 相同，加一条更硬的）：
//   1) 不得"优化"、不得重排、不得合并表达式 —— 否则浮点末位会漂；
//   2) 不得把 2.49e2492 之类的目标写成 Number 字面量（会变 Infinity），只能从字符串解析；
//   3) 1–4 层必须走逐级购买（保持开局浮点路径），5 层起走等价批量。
//
// 对拍入口：tools/v8-reference.cjs（由 tools/extract-reference.mjs 从文档 §14 原样抽出）。
// 验收：tools/v8-verify.mjs 逐字段比 campaign；tools/v8-engine-verify.mjs 走引擎 tick 循环。

// ─────────────────────────────────────────────────────────────
// §14 CONFIG（原文照抄）
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  dt: 0.05,
  targets: ['2.49e24', '2.49e249', '2.49e2492', '2.49e24920',
    '2.49e249209', '2.49e2492094', '2.49e24920949', '2.49e249209494', '2.49e2492094949'],
  coordinates: [2.49e24, 249, 249.2, 249.2, 249.2, 249.2, 249.2, 249.2, 249.2],
  firstUnlocks: [1, 32, 96, 240, 1e5, 1e9, 1e14, 1e20],
  firstCosts: [2.2, 10, 25, 50, 1e5, 1e9, 1e14, 1e20],
  firstRatios: [6, 4.3, 6, 4.3, 6, 4.3, 6, 4.3],
  unlocks: [1, 3, 7, 15, 35, 75, 140, 200],
  baseCosts: [2.2, 2.5, 2.8, 3.2, 3.6, 4, 4.5, 5],
  ratios: [[1.32, 1.4], [1.36, 1.44], [1.4, 1.4], [1.2, 1.4],
    [1.35, 1.4], [1.35, 1.4], [1.35, 1.4], [1.35, 1.4]],
  alpha: [0.3, 0.0051, 0.0025, 0.0009, 0.00026, 0.000105, 0.000047, 0.000019, 0.000012],
  pressureBase: [0.001, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
  pressureTime: [530, 400, 270, 250, 300, 330, 350, 370, 400],
  pressurePower: 8,
  failBase: [4, 40, 400, 8000, 40000, 400000, 4000000, 40000000],
  failRatio: 1.35,
  successBase: [4, 4.1, 4.2, 4.3],
  successRatio: [1.6, 1.6, 1.6, 1.6],
  productionTech: [0.2, 0.032, 0.058, 0.068, 0.05, 0.05, 0.05, 0.05, 0.05],
  productionReplayKnee: [0, 5, 10, 15, 20, 25, 30, 35, 35],
  productionReplay: [0, 0.15, 0.06, 0.05, 0.04, 0.04, 0.04, 0.04, 0.04],
  suppressionTech: 0.06,
  successRewardTech: 0.02,
  failureRewardTech: 0.02,
  firstBase: 6.3, firstSynergy: 0.15, firstCompression: 0.02,
  syncKnee: 10, syncFeedback: 0.1,
  energyCharge: 0.02, energyDamage: 2, energyCooldownTicks: 200, recoveryTime: 30,
  bufferGeneration: 0.1, bufferEfficiency: 0.2, regenDecay: 30,
  erosionDeposit: 0.01, erosionDecay: 60, erosionEfficiency: 0.1, fatigueDecay: 120,
};

// §11.4 调试护栏（触及即抛错，不给奖励、不强制判输）
export const GUARDS = {
  segmentTicks: 20 * 7200,     // 单个片段 7200 秒
  campaignRuns: 400,           // 全流程 400 轮
  sequentialBuys: 1000000,     // 逐级尾部百万次
  permanentBuys: 10000,        // 单次永久购买 10000 次
};

// 成功四科技的显示顺序（与 settle / permanentCost 的 index 一致）
export const SUCCESS_KEYS = ['up', 'ud', 'us', 'uf'];

// ─────────────────────────────────────────────────────────────
// §2.1 Scientific（原文照抄）
// ─────────────────────────────────────────────────────────────
export class Scientific {
  constructor(mantissa, exponent = 0) {
    if (!Number.isFinite(mantissa) || mantissa < 0 || !Number.isSafeInteger(exponent)) {
      throw new RangeError('Scientific requires a nonnegative finite mantissa and safe integer exponent');
    }
    if (mantissa === 0) {
      this.mantissa = 0;
      this.exponent = 0;
      return;
    }
    const shift = Math.floor(Math.log10(mantissa));
    let m = shift < -308 ? (mantissa / 1e-300) * 10 ** (-shift - 300) : mantissa / 10 ** shift;
    let e = exponent + shift;
    if (m >= 10) { m /= 10; e++; }
    if (m < 1) { m *= 10; e--; }
    if (!Number.isFinite(m) || m < 1 || m >= 10 || !Number.isSafeInteger(e)) {
      throw new RangeError('Scientific normalization exceeded its supported range');
    }
    this.mantissa = m;
    this.exponent = e;
  }

  static fromNumber(value) { return new Scientific(value); }

  static parse(text) {
    const match = /^(\d+(?:\.\d+)?)(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) throw new RangeError(`Invalid scientific literal: ${text}`);
    return new Scientific(Number(match[1]), Number(match[2] ?? 0));
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object'
      || !Number.isFinite(value.mantissa) || !Number.isSafeInteger(value.exponent)) {
      throw new RangeError('Invalid Scientific JSON');
    }
    return new Scientific(value.mantissa, value.exponent);
  }

  compare(other) {
    if (this.mantissa === 0 || other.mantissa === 0) {
      return Math.sign(this.mantissa - other.mantissa);
    }
    return Math.sign(this.exponent - other.exponent) || Math.sign(this.mantissa - other.mantissa);
  }

  add(other) {
    if (this.mantissa === 0) return new Scientific(other.mantissa, other.exponent);
    if (other.mantissa === 0) return new Scientific(this.mantissa, this.exponent);
    const [large, small] = this.compare(other) >= 0 ? [this, other] : [other, this];
    const difference = small.exponent - large.exponent;
    if (difference < -18) return new Scientific(large.mantissa, large.exponent);
    return new Scientific(large.mantissa + small.mantissa * 10 ** difference, large.exponent);
  }

  subtract(other) {
    const comparison = this.compare(other);
    if (comparison < 0) throw new RangeError('Negative Scientific subtraction');
    if (comparison === 0) return new Scientific(0);
    if (other.mantissa === 0) return new Scientific(this.mantissa, this.exponent);
    const difference = other.exponent - this.exponent;
    if (difference < -18) return new Scientific(this.mantissa, this.exponent);
    return new Scientific(this.mantissa - other.mantissa * 10 ** difference, this.exponent);
  }

  multiply(other) {
    return new Scientific(this.mantissa * other.mantissa, this.exponent + other.exponent);
  }

  divide(other) {
    if (other.mantissa === 0) throw new RangeError('Scientific division by zero');
    return new Scientific(this.mantissa / other.mantissa, this.exponent - other.exponent);
  }

  pow(power) {
    if (!Number.isFinite(power)) throw new RangeError('Scientific power must be finite');
    if (power === 0) return new Scientific(1);
    if (this.mantissa === 0) {
      if (power < 0) throw new RangeError('Zero cannot have a negative power');
      return new Scientific(0);
    }
    // Keep the large integer exponent separate from the small mantissa logarithm.
    const exponentProduct = this.exponent * power;
    const whole = Math.floor(exponentProduct);
    const fraction = exponentProduct - whole + Math.log10(this.mantissa) * power;
    const carry = Math.floor(fraction);
    return new Scientific(10 ** (fraction - carry), whole + carry);
  }

  log10() {
    if (this.mantissa === 0) throw new RangeError('Zero has no finite logarithm');
    return this.exponent + Math.log10(this.mantissa);
  }

  toNumber() {
    const value = this.exponent < -308
      ? this.mantissa * 10 ** (this.exponent + 300) * 1e-300
      : this.mantissa * 10 ** this.exponent;
    if (!Number.isFinite(value) || (value === 0 && this.mantissa !== 0)) {
      throw new RangeError('Scientific value cannot be represented as Number');
    }
    return value;
  }

  toString() { return this.mantissa === 0 ? '0' : `${this.mantissa}e${this.exponent}`; }

  toJSON() { return { mantissa: this.mantissa, exponent: this.exponent }; }
}

// ─────────────────────────────────────────────────────────────
// §2.2 永久状态
// ─────────────────────────────────────────────────────────────
export function initialPermanent() {
  return {
    failure: Array(8).fill(0), success: Array(4).fill(0),
    failureWallet: 0, successWallet: 0,
  };
}

export function snapshot(permanent) {
  return { ...permanent, failure: [...permanent.failure], success: [...permanent.success] };
}

// ─────────────────────────────────────────────────────────────
// §2.1 工作坐标 ↔ 真实量
// ─────────────────────────────────────────────────────────────
export function forceFromWork(stage, work) {
  if (!Number.isFinite(work) || work < 0) throw new RangeError('Invalid work coordinate');
  if (work === 0) return new Scientific(0);
  if (stage === 1) return Scientific.fromNumber(work);
  return Scientific.parse(CONFIG.targets[stage - 1])
    .pow(Math.log10(work) / Math.log10(CONFIG.coordinates[stage - 1]));
}

export function workFromForce(stage, value) {
  if (!value.mantissa) return 0;
  if (stage === 1) return value.toNumber();
  return 10 ** (value.log10() / Scientific.parse(CONFIG.targets[stage - 1]).log10()
    * Math.log10(CONFIG.coordinates[stage - 1]));
}

// ─────────────────────────────────────────────────────────────
// §3 / §4 临时项目与价格
// ─────────────────────────────────────────────────────────────
export function specification(stage) {
  const layer = Math.min(stage, 8), items = [];
  for (let owner = 1; owner <= layer; owner++) for (let position = 0; position < 8; position++) {
    const kind = position % 2, tier = Math.floor(position / 2);
    const density = stage === 1 ? 1 : 8 * 10 ** (layer - owner);
    const ratio = stage === 1 ? CONFIG.firstRatios[position]
      : CONFIG.ratios[owner - 1][kind] ** (1 + tier * 0.1);
    const base = stage === 1 ? CONFIG.firstCosts[position] : CONFIG.baseCosts[position] * 0.1 ** (owner - 1);
    const step = Math.log(ratio) / density;
    items.push({
      id: `${owner}${String.fromCharCode(65 + position)}`,
      owner, position, kind, tier, density, ratio, base, step,
      firstPrice: base * Math.expm1(step) / (ratio - 1),
      threshold: stage === 1 ? CONFIG.firstUnlocks[position]
        : owner === layer && stage <= 8 ? CONFIG.unlocks[position] : 1 + position * 0.1,
    });
  }
  return items;
}

// totals 的 16 个分量（§3.3）：[a,b,c,d,e,f,g,j,sP,sD,cE,dE,bG,bE,eD,eE]
export const TOTALS_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'j',
  'sP', 'sD', 'cE', 'dE', 'bG', 'bE', 'eD', 'eE'];

// ─────────────────────────────────────────────────────────────
// §10.2 / §10.3 永久价格与奖励
// ─────────────────────────────────────────────────────────────
export function permanentCost(kind, index, level) {
  return Math.ceil(kind === 'failure'
    ? CONFIG.failBase[index] * CONFIG.failRatio ** level
    : CONFIG.successBase[index] * CONFIG.successRatio[index] ** level);
}

export function rewardMultiplier(kind, p) {
  const index = kind === 'success' ? 2 : 3;
  const coefficient = kind === 'success' ? CONFIG.successRewardTech : CONFIG.failureRewardTech;
  return (1 + p.success[index]) ** coefficient;
}

// 失败收入（§10.2）：只算数，不改钱包；预览与 settle 共用同一个函数，避免两套口径。
export function failureReward(stage, peak, permanent) {
  const owner = Math.min(stage, 8) - 1;
  const target = CONFIG.coordinates[stage - 1];
  const progress = stage === 1 ? Math.log10(peak) / Math.log10(target)
    : (peak - 1) / (target - 1);
  // 终局没有成功奖励；它的失败进度做对数软延展（不把 p 硬截到 1）。
  const effectiveProgress = stage === 9 && progress > 1 ? 1 + Math.log1p(progress - 1) : progress;
  const base = 4 * 10 ** (owner + effectiveProgress);
  return { owner: owner + 1, progress, effectiveProgress, base, gained: Math.floor(base * rewardMultiplier('failure', permanent)) };
}

export function successReward(stage, permanent) {
  const owner = Math.min(stage, 8) - 1;
  const base = 40 * 10 ** owner;
  return { owner: owner + 1, base, gained: Math.floor(base * rewardMultiplier('success', permanent)) };
}

// ─────────────────────────────────────────────────────────────
// §11.2 结算（唯一永久入口）
//   options.buy === false：只发币、不自动购买（实际游戏里由科技树节点解锁后才自动买）。
//   默认（不传 / true）就是文档行为，campaign 与参考模拟器都走这条路径，数值不变。
// ─────────────────────────────────────────────────────────────
export function settle(p, result, options = {}) {
  const owner = Math.min(result.stage, 8) - 1, kind = result.win ? 'success' : 'failure';
  if (result.stage === 9 && result.win) throw new Error('Endgame must not succeed');
  const base = result.win ? 40 * 10 ** owner : 4 * 10 ** (owner + effectiveProgressOf(result));
  const gained = Math.floor(base * rewardMultiplier(kind, p));
  if (!Number.isSafeInteger(gained)) throw new RangeError('Reward exceeds exact wallet range');
  const wallet = `${kind}Wallet`;
  p[wallet] += gained;
  if (!Number.isSafeInteger(p[wallet])) throw new RangeError('Wallet exceeds exact range');
  let spent = 0, bought = 0;
  const autoBuy = options.buy !== false;
  while (autoBuy) {
    let index = owner;
    if (kind === 'success') {
      index = 0;
      for (let i = 1; i < 4; i++) {
        if (permanentCost(kind, i, p.success[i]) < permanentCost(kind, index, p.success[index])) index = i;
      }
    }
    const cost = permanentCost(kind, index, p[kind][index]);
    if (cost > p[wallet]) break;
    p[wallet] -= cost;
    p[kind][index]++;
    spent += cost;
    if (++bought > GUARDS.permanentBuys) throw new Error('Permanent purchase runaway');
  }
  return { kind, owner: owner + 1, gained, spent, after: snapshot(p) };
}

// settle 内部复用 §10.2 的进度口径；单独提出是为了 failureReward/failurePreview 不至于三份。
function effectiveProgressOf(result) {
  const target = CONFIG.coordinates[result.stage - 1];
  const progress = result.stage === 1 ? Math.log10(result.peak) / Math.log10(target)
    : (result.peak - 1) / (target - 1);
  return result.stage === 9 && progress > 1 ? 1 + Math.log1p(progress - 1) : progress;
}

// ─────────────────────────────────────────────────────────────
// §5.1 / §5.2 / §5.3 效果
// ─────────────────────────────────────────────────────────────
export function effects(stage, totals, p, pressure, runTime) {
  const [a, b, c, d, e, f, g, j, syncP, syncD] = totals;
  const n = p.failure;
  const firstLog = Math.log1p(n[0]) * (CONFIG.firstBase + CONFIG.firstSynergy * Math.log1p((a + b) / 20));
  const bonus = stage === 1 ? Math.exp(firstLog) : 1 + CONFIG.firstCompression * firstLog;
  const rawFirst = stage === 1 ? 1.5 ** a * bonus : (1 + a) * bonus;
  const rawSecond = 1 + 3 * c, share = n[1] / (3 + n[1]);
  const first = rawFirst + (stage >= 2 ? share * (rawSecond - 1) : 0);
  const second = rawSecond + share * (rawFirst - 1);
  const global = Math.sqrt(1 + d / 10);
  const replay = Math.max(0, p.success[0] - CONFIG.productionReplayKnee[stage - 1]);
  const productionMultiplier = 10 ** (CONFIG.productionTech[stage - 1] * p.success[0]
    + CONFIG.productionReplay[stage - 1] * replay * replay / (8 + replay));
  const suppressionMultiplier = 10 ** (CONFIG.suppressionTech * p.success[1]);
  const rawP = CONFIG.alpha[stage - 1] * productionMultiplier * global
    * (stage === 1 ? first : first + second - 1);
  const frequency = Math.min(20, 1 + 2 * g), overflow = Math.sqrt(Math.max(1, (1 + 2 * g) / 20));
  const time = 1 + 0.5 * Math.log1p(n[3]) * Math.sqrt(runTime / 600);
  const baseHit = suppressionMultiplier * global * (1 + e) * overflow * time
    * (1 + Math.log1p(j) / 10 * Math.sqrt(pressure / 10));
  const burst = 1 + 3 * Math.log1p(n[2]);
  // Compare nominal rates without pressure-dependent conversion, sync, energy or buffer.
  const nominalD = stage >= 3 ? suppressionMultiplier * global * (1 + e) * overflow * time
    * frequency * (4 + burst) / 5 : 0;
  const { sp, sd, feedback } = syncFactors(stage, rawP, nominalD, syncP, syncD, n[4]);
  const production = rawP * sp * (1 + feedback * Math.log(sd));
  const hit = baseHit * sd * (1 + feedback * Math.log(sp));
  return {
    production, hit, frequency, burst, conversion: Math.sqrt(1 + b / 10),
    salvage: 0.1 * Math.log1p(f), rawP, nominalD, sp, sd,
    actionMultiplier: suppressionMultiplier * global * time * sd * (1 + feedback * Math.log(sp)),
    // 以下仅展示用，不参与任何计算
    first, second, rawFirst, rawSecond, share, firstLog, bonus, global, overflow, time,
    productionMultiplier, suppressionMultiplier, replay, feedback,
  };
}

export function syncFactors(stage, production, suppression, productionLevel, suppressionLevel, permanent) {
  let sp = 1, sd = 1;
  if (stage >= 5) {
    if (production < suppression) sp += Math.log(suppression / Math.max(production, 1e-300))
      * Math.log1p(productionLevel) / CONFIG.syncKnee;
    if (suppression < production) sd += Math.log(production / Math.max(suppression, 1e-300))
      * Math.log1p(suppressionLevel) / CONFIG.syncKnee;
  }
  return { sp, sd, feedback: CONFIG.syncFeedback * Math.log1p(permanent) };
}

export function pressureRate(stage, time, erosion) {
  const eroded = stage >= 8 ? CONFIG.erosionEfficiency * erosion : 0;
  void eroded;
  return CONFIG.pressureBase[stage - 1]
    * Math.exp((time / CONFIG.pressureTime[stage - 1]) ** CONFIG.pressurePower);
}

// ─────────────────────────────────────────────────────────────
// §7 / §8 蓄能、缓冲
// ─────────────────────────────────────────────────────────────
export function releaseReady(energy, pressure, tick, lastRelease) {
  return energy > 0 && pressure > energy && tick - lastRelease >= CONFIG.energyCooldownTicks;
}

export function absorbBuffer(pressure, power, beforeGrowth, buffer, efficiency) {
  if (pressure < power || buffer <= 0) return { pressure, buffer, used: 0, absorbed: 0 };
  const needed = pressure - power + Math.max(1e-10, power * 1e-10);
  const absorbed = Math.min(needed, Math.max(0, pressure - beforeGrowth), buffer * efficiency);
  const used = absorbed / efficiency;
  return { pressure: pressure - absorbed, buffer: Math.max(0, buffer - used), used, absorbed };
}

// ─────────────────────────────────────────────────────────────
// §4.1 / §4.2 购买
// ─────────────────────────────────────────────────────────────
export function cheapest(prices, unlocked) {
  let best = -1;
  for (let i = 0; i < prices.length; i++) if (unlocked[i] && (best < 0 || prices[i] < prices[best])) best = i;
  return best;
}

export function batchCost(price, step, count) {
  if (count === 0) return 0;
  return price * Math.expm1(step * count) / Math.expm1(step);
}

export function buySequential(items, levels, prices, unlocked, totals, wallet, audit = false) {
  let count = 0;
  for (;;) {
    const i = cheapest(prices, unlocked);
    if (i < 0 || prices[i] > wallet) break;
    if (++count > GUARDS.sequentialBuys) throw new Error('Sequential purchase runaway');
    if (audit) {
      for (let j = 0; j < prices.length; j++) if (unlocked[j] && !(prices[i] <= prices[j])) {
        throw new Error(`Cheapest-first violated at ${items[i].id}`);
      }
    }
    wallet -= prices[i];
    levels[i]++;
    totals[(items[i].owner - 1) * 2 + items[i].kind] += 1 / items[i].density;
    prices[i] = items[i].firstPrice * Math.exp(items[i].step * levels[i]);
  }
  return { wallet, count };
}

export function buyBulk(items, levels, prices, unlocked, totals, wallet) {
  const first = cheapest(prices, unlocked);
  if (first < 0 || prices[first] > wallet) return { wallet, count: 0 };
  const min = prices[first];
  const countsAt = (threshold) => items.map((item, i) => unlocked[i] && prices[i] <= threshold
    ? Math.max(0, Math.floor(Math.log(threshold / prices[i]) / item.step) + 1) : 0);
  const totalAt = (counts) => counts.reduce((sum, n, i) => sum + batchCost(prices[i], items[i].step, n), 0);
  let low = min, high = min + wallet;
  if (totalAt(countsAt(low)) > wallet) return buySequential(items, levels, prices, unlocked, totals, wallet);
  for (let k = 0; k < 64; k++) {
    const mid = (low + high) / 2;
    if (totalAt(countsAt(mid)) <= wallet) low = mid; else high = mid;
  }
  const counts = countsAt(low), spent = totalAt(counts);
  wallet -= spent;
  let count = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i]) {
    const n = counts[i];
    levels[i] += n;
    if (!Number.isSafeInteger(levels[i])) throw new RangeError('Upgrade level exceeds exact range');
    totals[(items[i].owner - 1) * 2 + items[i].kind] += n / items[i].density;
    prices[i] = items[i].firstPrice * Math.exp(items[i].step * levels[i]);
    count += n;
  }
  const tail = buySequential(items, levels, prices, unlocked, totals, wallet);
  return { wallet: tail.wallet, count: count + tail.count };
}

// ─────────────────────────────────────────────────────────────
// §11.1 片段：参考模拟器 segment() 的可步进版（循环体原文照抄）
// ─────────────────────────────────────────────────────────────
export class Segment {
  constructor(stage, permanent, options = {}) {
    this.stage = stage;
    this.permanent = permanent;
    this.items = specification(stage);
    this.runTicks = options.runTicks ?? 0;
    this.target = options.target ?? CONFIG.coordinates[stage - 1];
    this.bulk = !!options.bulk;
    this.audit = !!options.audit;
    this.tickLimit = options.tickLimit ?? GUARDS.segmentTicks;

    this.levels = Array(this.items.length).fill(0);
    this.prices = this.items.map((i) => i.firstPrice);
    this.unlocked = Array(this.items.length).fill(false);
    this.totals = Array(16).fill(0);
    this.unlocks = [];

    this.tickIndex = 0;
    this.power = 1;
    this.pressure = 0;
    this.wallet = 0;
    this.credit = 0;
    this.hits = 0;
    this.burstHits = 0;
    this.purchases = 0;
    this.energy = 0;
    this.residual = 0;
    this.lastRelease = -CONFIG.energyCooldownTicks;
    this.releases = 0;
    this.releaseTicks = [];
    this.buffer = 0;
    this.emergency = 0;
    this.bufferSpent = 0;
    this.erosion = 0;
    this.fatigue = 0;
    this.salvaged = 0;
    this.removedTotal = 0;
    this.zeroTicks = 0;
    this.savedTicks = 0;
    this.crossedEndgameMarker = false;
    // 统计（只读）：累计清理掉的深渊，按真实量逐事件累加 Phi(h_before)-Phi(h_after)。
    // 只读取 h 的前后值，不参与任何数值判定，也不改变运算顺序。
    this.cleared = new Scientific(0);
    this.targetSci = Scientific.parse(CONFIG.targets[stage - 1]);
    this.logCoord = Math.log10(CONFIG.coordinates[stage - 1]);

    // 外壳注入：buyer(seg) 返回本次买了几级；返回 undefined/false = 没接管，走数值默认路径。
    this.buyer = null;
    this.lastEffects = null;
  }

  get stageTargets() { return this.target; }

  /** 工作坐标 → 真实量（与 forceFromWork 等价，只是把目标解析与常数缓存下来；纯读取） */
  phi(x) {
    if (!(x > 0)) return new Scientific(0);
    if (this.stage === 1) return Scientific.fromNumber(x);
    return this.targetSci.pow(Math.log10(x) / this.logCoord);
  }

  // ── 默认购买路径（= 参考模拟器第 2 步）──
  defaultBuy() {
    const res = (this.stage <= 4 && !this.bulk ? buySequential : buyBulk)(
      this.items, this.levels, this.prices, this.unlocked, this.totals, this.wallet, this.audit,
    );
    this.wallet = res.wallet;
    this.purchases += res.count;
    return res.count;
  }

  // 只买一项一级（外壳手动按钮；记账与 defaultBuy 内的单次购买逐字相同）
  buyItem(index) {
    if (!this.unlocked[index]) return 0;
    const price = this.prices[index];
    if (!(price <= this.wallet)) return 0;
    this.wallet -= price;
    this.levels[index]++;
    this.totals[(this.items[index].owner - 1) * 2 + this.items[index].kind] += 1 / this.items[index].density;
    this.prices[index] = this.items[index].firstPrice * Math.exp(this.items[index].step * this.levels[index]);
    this.purchases++;
    return 1;
  }

  /**
   * 只把**某一个所属层**的 8 项买到买不起（「一键买满」/ 满级自动购买用）。
   * 记账与逐级购买完全同源；不碰其他所属层的项。
   */
  buyOwnerLoop(owner) {
    let count = 0;
    const from = (owner - 1) * 8, to = owner * 8;
    for (;;) {
      let best = -1;
      for (let i = from; i < to && i < this.items.length; i++) {
        if (!this.unlocked[i]) continue;
        if (best === -1 || this.prices[i] < this.prices[best]) best = i;
      }
      if (best === -1 || !(this.prices[best] <= this.wallet)) break;
      this.wallet -= this.prices[best];
      this.levels[best]++;
      this.totals[(this.items[best].owner - 1) * 2 + this.items[best].kind] += 1 / this.items[best].density;
      this.prices[best] = this.items[best].firstPrice * Math.exp(this.items[best].step * this.levels[best]);
      this.purchases++;
      count++;
      if (count > GUARDS.sequentialBuys) throw new Error('Owner purchase runaway');
    }
    return count;
  }
  // 该所属层 8 项里最便宜的一级（自动购买科技 9–21 级用）
  buyCheapestForOwner(owner) {
    let best = -1;
    const from = (owner - 1) * 8, to = owner * 8;
    for (let i = from; i < to && i < this.items.length; i++) {
      if (!this.unlocked[i]) continue;
      if (best === -1 || this.prices[i] < this.prices[best]) best = i;
    }
    return best === -1 ? 0 : this.buyItem(best);
  }

  // ── 一个 tick：参考模拟器 for 循环体逐句移植 ──
  tick() {
    const stage = this.stage, dt = CONFIG.dt, runTicks = this.runTicks;
    const items = this.items, levels = this.levels, prices = this.prices, unlocked = this.unlocked;
    const p = this.permanent, totals = this.totals;
    const tick = this.tickIndex;
    if (tick >= this.tickLimit) throw new Error(`Stage ${stage} exceeded ${this.tickLimit} ticks`);

    let x = this.power, h = this.pressure, wallet = this.wallet;
    let credit = this.credit, hits = this.hits, burstHits = this.burstHits;
    let energy = this.energy, residual = this.residual, lastRelease = this.lastRelease;
    let buffer = this.buffer, emergency = this.emergency, bufferSpent = this.bufferSpent;
    let erosion = this.erosion, fatigue = this.fatigue;
    let salvaged = this.salvaged, removedTotal = this.removedTotal, zeroTicks = this.zeroTicks;
    let savedTicks = this.savedTicks, crossed = this.crossedEndgameMarker;
    let releases = this.releases;
    let cleared = this.cleared;

    // 1) 解锁扫描
    for (let i = 0; i < items.length; i++) if (!unlocked[i] && x >= items[i].threshold
      && (items[i].position === 0 || unlocked[i - 1])) {
      unlocked[i] = true; this.unlocks.push({ id: items[i].id, time: tick * dt });
    }

    // 2) 购买（外壳可接管；默认 = 参考模拟器的逐级/批量分派）
    if (this.buyer) {
      const took = this.buyer(this);
      if (took === false || took === undefined) this.defaultBuy();
    } else {
      this.defaultBuy();
    }
    wallet = this.wallet;

    // 3) 用本 tick 开始压力和当前有效等级算效果
    const r = effects(stage, totals, p, h, (runTicks + tick) * dt);
    this.lastEffects = r;

    // 4) 生产推进 x 和 R
    const previousX = x;
    x += r.production * dt; wallet += r.production * r.conversion * dt;

    // 5) 六层起：余能回充 + 生产充能
    if (stage >= 6) {
      const recharge = residual * -Math.expm1(-dt / CONFIG.recoveryTime);
      residual -= recharge;
      energy += recharge + CONFIG.energyCharge * Math.log1p(totals[10]) * r.production * dt;
    }

    // 6) 七层起：缓冲积累 + 应急衰减
    if (stage >= 7) {
      buffer += CONFIG.bufferGeneration * Math.log1p(totals[12])
        * (1 + Math.log1p(emergency)) * dt;
      emergency *= Math.exp(-dt / CONFIG.regenDecay);
    }

    // 7) 八层起：旧侵蚀更新疲劳，侵蚀衰减
    if (stage >= 8) {
      const oldErosion = erosion;
      fatigue += (Math.log1p(p.failure[7]) * Math.log1p(oldErosion) - fatigue / CONFIG.fatigueDecay) * dt;
      erosion *= Math.exp(-dt / CONFIG.erosionDecay);
    }

    // 8) 记录 h_old，算侵蚀后的新增压力并加到 h
    const eroded = stage >= 8 ? CONFIG.erosionEfficiency * Math.log1p(totals[15]) * erosion
      * (1 + Math.log1p(fatigue)) : 0;
    const growth = CONFIG.pressureBase[stage - 1]
      * Math.exp((tick * dt / CONFIG.pressureTime[stage - 1]) ** CONFIG.pressurePower) / (1 + eroded);
    const beforeGrowth = h;
    h += growth * dt;

    // 9) 普通攻击
    const remove = (amount) => {
      const removed = Math.min(h, amount);
      const hBefore = h;
      h -= removed;
      // 统计：真实量口径的清理量（Phi 差），只读取，不改变 h 的任何取值
      if (removed > 0) cleared = cleared.add(this.phi(hBefore).subtract(this.phi(h)));
      const salvageGain = r.salvage * Math.log1p(removed);
      wallet += salvageGain; salvaged += salvageGain; removedTotal += removed;
      if (stage >= 8) erosion += CONFIG.erosionDeposit * Math.log1p(totals[14]) * Math.log1p(removed);
      return removed;
    };
    if (stage >= 3) {
      credit += r.frequency * dt;
      if (credit >= 1 - 1e-12) {
        credit = Math.max(0, credit - 1); hits++;
        const enhanced = hits % 5 === 0;
        if (enhanced) burstHits++;
        const updated = effects(stage, totals, p, h, (runTicks + tick) * dt);
        remove(updated.hit * (enhanced ? updated.burst : 1));
      }
    }

    // 10) 六层蓄能释放（最多一次）
    if (stage >= 6 && releaseReady(energy, h, tick, lastRelease)) {
      const spent = energy; energy = 0; lastRelease = tick; releases++; this.releaseTicks.push(tick);
      remove(spent * (1 + CONFIG.energyDamage * Math.log1p(totals[11])) * r.actionMultiplier);
      residual += spent * p.failure[5] / (10 + p.failure[5]);
    }

    // 11) 判成功（stage9 永远 false）；未成功且 h>=x 时消耗缓冲
    const win = stage !== 9 && Number.isFinite(this.target) && x >= this.target;
    if (!win && stage >= 7 && h >= x && buffer > 0) {
      const efficiency = 1 + CONFIG.bufferEfficiency * Math.log1p(totals[13]);
      const absorbed = absorbBuffer(h, x, beforeGrowth, buffer, efficiency);
      // 统计：缓冲吸收同样是"清理掉的压力"，按真实量计
      if (absorbed.absorbed > 0) cleared = cleared.add(this.phi(h).subtract(this.phi(absorbed.pressure)));
      buffer = absorbed.buffer; h = absorbed.pressure; bufferSpent += absorbed.used;
      emergency += 0.1 * Math.log1p(p.failure[6]) * Math.log1p(absorbed.used);
      if (h < x && absorbed.used > 0) savedTicks++;
    }

    // 12) 有限数 / 边界检查
    if (![x, h, wallet, energy, residual, buffer, emergency, erosion, fatigue].every(Number.isFinite)) {
      throw new Error(`Nonfinite state at stage ${stage}, tick ${tick}`);
    }
    if (h === 0) zeroTicks++;
    if (stage === 9 && x >= CONFIG.coordinates[8]) crossed = true;

    // 写回（与参考模拟器的局部变量在循环末尾继续存活等价）
    this.power = x; this.pressure = h; this.wallet = wallet;
    this.credit = credit; this.hits = hits; this.burstHits = burstHits;
    this.energy = energy; this.residual = residual; this.lastRelease = lastRelease;
    this.buffer = buffer; this.emergency = emergency; this.bufferSpent = bufferSpent;
    this.erosion = erosion; this.fatigue = fatigue;
    this.salvaged = salvaged; this.removedTotal = removedTotal; this.zeroTicks = zeroTicks;
    this.savedTicks = savedTicks; this.crossedEndgameMarker = crossed; this.releases = releases;
    this.cleared = cleared;
    void previousX;

    this.tickIndex++;
    if (win || h >= x) return this.result(win);
    return null;
  }

  // 与参考模拟器 segment() 的返回结构逐字段一致
  result(win) {
    const stage = this.stage;
    const force = forceFromWork(stage, this.power);
    return {
      stage, win, ticks: this.tickIndex, time: this.tickIndex * CONFIG.dt, runTicks: this.runTicks,
      permanent: snapshot(this.permanent), peak: this.power, pressure: this.pressure,
      actualPeak: force.toString(), actualForce: force.toJSON(),
      actualPressure: forceFromWork(stage, this.pressure).toJSON(),
      wallet: this.wallet, levels: this.levels, totals: this.totals, unlocked: this.unlocked,
      unlocks: this.unlocks, hits: this.hits, burstHits: this.burstHits, purchases: this.purchases,
      releases: this.releases, releaseTicks: this.releaseTicks,
      energy: this.energy, residual: this.residual, buffer: this.buffer, emergency: this.emergency,
      bufferSpent: this.bufferSpent, erosion: this.erosion, fatigue: this.fatigue,
      salvaged: this.salvaged, removedTotal: this.removedTotal, savedTicks: this.savedTicks,
      crossedEndgameMarker: this.crossedEndgameMarker, zeroSeconds: this.zeroTicks * CONFIG.dt,
    };
  }

  // ── 存档（只搬状态，不改数值）──
  toJSON() {
    return {
      stage: this.stage, runTicks: this.runTicks, target: this.target, tickIndex: this.tickIndex,
      levels: this.levels, prices: this.prices, unlocked: this.unlocked, totals: this.totals,
      power: this.power, pressure: this.pressure, wallet: this.wallet, credit: this.credit,
      hits: this.hits, burstHits: this.burstHits, purchases: this.purchases,
      energy: this.energy, residual: this.residual, lastRelease: this.lastRelease,
      releases: this.releases, releaseTicks: this.releaseTicks,
      buffer: this.buffer, emergency: this.emergency, bufferSpent: this.bufferSpent,
      erosion: this.erosion, fatigue: this.fatigue,
      salvaged: this.salvaged, removedTotal: this.removedTotal,
      zeroTicks: this.zeroTicks, savedTicks: this.savedTicks,
      cleared: this.cleared.toJSON(),
      crossedEndgameMarker: this.crossedEndgameMarker, unlocks: this.unlocks,
    };
  }

  static fromJSON(stage, permanent, obj) {
    const seg = new Segment(stage, permanent, {
      runTicks: obj.runTicks ?? 0, target: obj.target,
    });
    for (const k of ['tickIndex', 'power', 'pressure', 'wallet', 'credit', 'hits', 'burstHits',
      'purchases', 'energy', 'residual', 'lastRelease', 'releases', 'buffer', 'emergency',
      'bufferSpent', 'erosion', 'fatigue', 'salvaged', 'removedTotal', 'zeroTicks', 'savedTicks']) {
      if (Number.isFinite(obj[k])) seg[k] = obj[k];
    }
    for (const k of ['levels', 'prices', 'totals']) {
      if (Array.isArray(obj[k])) seg[k] = obj[k].map(Number);
    }
    if (Array.isArray(obj.unlocked)) seg.unlocked = obj.unlocked.map(Boolean);
    if (obj.cleared) seg.cleared = Scientific.fromJSON(obj.cleared);
    if (Array.isArray(obj.releaseTicks)) seg.releaseTicks = obj.releaseTicks.slice();
    if (Array.isArray(obj.unlocks)) seg.unlocks = obj.unlocks.slice();
    seg.crossedEndgameMarker = !!obj.crossedEndgameMarker;
    return seg;
  }
}

// 参考模拟器的 segment()：整段跑完
export function segment(stage, permanent, options = {}) {
  const seg = new Segment(stage, permanent, options);
  for (;;) {
    const result = seg.tick();
    if (result) return result;
  }
}

// 参考模拟器的 campaign()：整程跑完
export function campaign(options = {}) {
  const p = initialPermanent(), runs = [], failures = Array(8).fill(0);
  const firstWins = [], firstEntries = [];
  const maxRuns = options.maxRuns ?? GUARDS.campaignRuns, through = options.through ?? 8;
  let terminalRuns = 0;
  for (let run = 1; run <= maxRuns; run++) {
    const before = snapshot(p), segments = [], settlements = [];
    let runTicks = 0;
    for (let stage = 1; stage <= Math.min(9, through + (options.endgameRuns ? 1 : 0)); stage++) {
      const s = segment(stage, p, { ...options, runTicks });
      firstEntries[stage - 1] ??= { run, ...s };
      segments.push(s); runTicks += s.ticks;
      const event = settle(p, s); settlements.push(event);
      if (s.win) firstWins[stage - 1] ??= { run, ...s };
      if (!s.win) {
        failures[Math.min(stage, 8) - 1]++;
        runs.push({ run, before, after: snapshot(p), time: runTicks * CONFIG.dt,
          failedStage: stage, segments, settlements });
        if (stage === 9 && ++terminalRuns >= (options.endgameRuns ?? Infinity)) {
          return { failures, permanent: snapshot(p), runs, firstWins, firstEntries };
        }
        break;
      }
      if (stage === through && !options.endgameRuns) {
        runs.push({ run, before, after: snapshot(p), time: runTicks * CONFIG.dt,
          failedStage: null, segments, settlements });
        return { failures, permanent: snapshot(p), runs, firstWins, firstEntries };
      }
    }
  }
  throw new Error(`Campaign did not reach checkpoint within ${maxRuns} runs`);
}

export function summary(r) {
  return {
    failures: r.failures, permanent: r.permanent, runs: r.runs.length,
    seconds: r.runs.reduce((sum, x) => sum + x.time, 0),
    firstWins: r.firstWins.map((s) => ({ stage: s.stage, run: s.run, time: s.time,
      permanent: s.permanent, levels: s.levels, releases: s.releases,
      bufferSpent: s.bufferSpent, erosion: s.erosion })),
    runData: r.runs.map((x) => ({ run: x.run, stage: x.failedStage, time: x.time, after: x.after,
      rewards: x.settlements.map((e) => [e.kind, e.gained]) })),
  };
}
