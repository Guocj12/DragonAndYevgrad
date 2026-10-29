// tools/v8-reference.cjs — 由 tools/extract-reference.mjs 从 docs/数值设计.md §14 原样抽出。
// 禁止手改：文档是唯一权威，要改就改文档再重抽。

"use strict";
const assert = require("node:assert/strict");

class Scientific {
  constructor(mantissa, exponent = 0) {
    if (!Number.isFinite(mantissa) || mantissa < 0 || !Number.isSafeInteger(exponent)) {
      throw new RangeError("Scientific requires a nonnegative finite mantissa and safe integer exponent");
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
      throw new RangeError("Scientific normalization exceeded its supported range");
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
    if (!value || typeof value !== "object"
      || !Number.isFinite(value.mantissa) || !Number.isSafeInteger(value.exponent)) {
      throw new RangeError("Invalid Scientific JSON");
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
    if (comparison < 0) throw new RangeError("Negative Scientific subtraction");
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
    if (other.mantissa === 0) throw new RangeError("Scientific division by zero");
    return new Scientific(this.mantissa / other.mantissa, this.exponent - other.exponent);
  }

  pow(power) {
    if (!Number.isFinite(power)) throw new RangeError("Scientific power must be finite");
    if (power === 0) return new Scientific(1);
    if (this.mantissa === 0) {
      if (power < 0) throw new RangeError("Zero cannot have a negative power");
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
    if (this.mantissa === 0) throw new RangeError("Zero has no finite logarithm");
    return this.exponent + Math.log10(this.mantissa);
  }

  toNumber() {
    const value = this.exponent < -308
      ? this.mantissa * 10 ** (this.exponent + 300) * 1e-300
      : this.mantissa * 10 ** this.exponent;
    if (!Number.isFinite(value) || (value === 0 && this.mantissa !== 0)) {
      throw new RangeError("Scientific value cannot be represented as Number");
    }
    return value;
  }

  toString() { return this.mantissa === 0 ? "0" : `${this.mantissa}e${this.exponent}`; }

  toJSON() { return { mantissa: this.mantissa, exponent: this.exponent }; }
}


const CONFIG = {
  dt: 0.05,
  targets: ["2.49e24", "2.49e249", "2.49e2492", "2.49e24920",
    "2.49e249209", "2.49e2492094", "2.49e24920949", "2.49e249209494", "2.49e2492094949"],
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

function initialPermanent() {
  return { failure: Array(8).fill(0), success: Array(4).fill(0),
    failureWallet: 0, successWallet: 0 };
}
function snapshot(p) {
  return { ...p, failure: [...p.failure], success: [...p.success] };
}
function forceFromWork(stage, work) {
  if (!Number.isFinite(work) || work < 0) throw new RangeError("Invalid work coordinate");
  if (work === 0) return new Scientific(0);
  if (stage === 1) return Scientific.fromNumber(work);
  return Scientific.parse(CONFIG.targets[stage - 1])
    .pow(Math.log10(work) / Math.log10(CONFIG.coordinates[stage - 1]));
}
function workFromForce(stage, value) {
  if (!value.mantissa) return 0;
  if (stage === 1) return value.toNumber();
  return 10 ** (value.log10() / Scientific.parse(CONFIG.targets[stage - 1]).log10()
    * Math.log10(CONFIG.coordinates[stage - 1]));
}
function specification(stage) {
  const layer = Math.min(stage, 8), items = [];
  for (let owner = 1; owner <= layer; owner++) for (let position = 0; position < 8; position++) {
    const kind = position % 2, tier = Math.floor(position / 2);
    const density = stage === 1 ? 1 : 8 * 10 ** (layer - owner);
    const ratio = stage === 1 ? CONFIG.firstRatios[position]
      : CONFIG.ratios[owner - 1][kind] ** (1 + tier * 0.1);
    const base = stage === 1 ? CONFIG.firstCosts[position] : CONFIG.baseCosts[position] * 0.1 ** (owner - 1);
    const step = Math.log(ratio) / density;
    items.push({ id: `${owner}${String.fromCharCode(65 + position)}`, owner, position, kind,
      density, ratio, base, step, firstPrice: base * Math.expm1(step) / (ratio - 1),
      threshold: stage === 1 ? CONFIG.firstUnlocks[position]
        : owner === layer && stage <= 8 ? CONFIG.unlocks[position] : 1 + position * 0.1 });
  }
  return items;
}
function permanentCost(kind, index, level) {
  return Math.ceil(kind === "failure" ? CONFIG.failBase[index] * CONFIG.failRatio ** level
    : CONFIG.successBase[index] * CONFIG.successRatio[index] ** level);
}
function rewardMultiplier(kind, p) {
  const index = kind === "success" ? 2 : 3;
  const coefficient = kind === "success" ? CONFIG.successRewardTech : CONFIG.failureRewardTech;
  return (1 + p.success[index]) ** coefficient;
}
function settle(p, result) {
  const owner = Math.min(result.stage, 8) - 1, kind = result.win ? "success" : "failure";
  if (result.stage === 9 && result.win) throw new Error("Endgame must not succeed");
  const target = CONFIG.coordinates[result.stage - 1];
  const progress = result.stage === 1 ? Math.log10(result.peak) / Math.log10(target)
    : (result.peak - 1) / (target - 1);
  // Endgame has no success reward; its failure progress receives a logarithmic soft continuation.
  const effectiveProgress = result.stage === 9 && progress > 1 ? 1 + Math.log1p(progress - 1) : progress;
  const base = result.win ? 40 * 10 ** owner : 4 * 10 ** (owner + effectiveProgress);
  const gained = Math.floor(base * rewardMultiplier(kind, p));
  if (!Number.isSafeInteger(gained)) throw new RangeError("Reward exceeds exact wallet range");
  const wallet = `${kind}Wallet`;
  p[wallet] += gained;
  if (!Number.isSafeInteger(p[wallet])) throw new RangeError("Wallet exceeds exact range");
  let spent = 0, bought = 0;
  for (;;) {
    let index = owner;
    if (kind === "success") {
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
    if (++bought > 10000) throw new Error("Permanent purchase runaway");
  }
  return { kind, owner: owner + 1, gained, spent, after: snapshot(p) };
}
function effects(stage, totals, p, pressure, runTime) {
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
  return { production, hit, frequency, burst, conversion: Math.sqrt(1 + b / 10),
    salvage: 0.1 * Math.log1p(f), rawP, nominalD, sp, sd,
    actionMultiplier: suppressionMultiplier * global * time * sd * (1 + feedback * Math.log(sp)) };
}
function syncFactors(stage, production, suppression, productionLevel, suppressionLevel, permanent) {
  let sp = 1, sd = 1;
  if (stage >= 5) {
    if (production < suppression) sp += Math.log(suppression / Math.max(production, 1e-300))
      * Math.log1p(productionLevel) / CONFIG.syncKnee;
    if (suppression < production) sd += Math.log(production / Math.max(suppression, 1e-300))
      * Math.log1p(suppressionLevel) / CONFIG.syncKnee;
  }
  return { sp, sd, feedback: CONFIG.syncFeedback * Math.log1p(permanent) };
}
function releaseReady(energy, pressure, tick, lastRelease) {
  return energy > 0 && pressure > energy && tick - lastRelease >= CONFIG.energyCooldownTicks;
}
function absorbBuffer(pressure, power, beforeGrowth, buffer, efficiency) {
  if (pressure < power || buffer <= 0) return { pressure, buffer, used: 0, absorbed: 0 };
  const needed = pressure - power + Math.max(1e-10, power * 1e-10);
  const absorbed = Math.min(needed, Math.max(0, pressure - beforeGrowth), buffer * efficiency);
  const used = absorbed / efficiency;
  return { pressure: pressure - absorbed, buffer: Math.max(0, buffer - used), used, absorbed };
}
function cheapest(prices, unlocked) {
  let best = -1;
  for (let i = 0; i < prices.length; i++) if (unlocked[i] && (best < 0 || prices[i] < prices[best])) best = i;
  return best;
}
function batchCost(price, step, count) {
  if (count === 0) return 0;
  return price * Math.expm1(step * count) / Math.expm1(step);
}
function buySequential(items, levels, prices, unlocked, totals, wallet, audit = false) {
  let count = 0;
  for (;;) {
    const i = cheapest(prices, unlocked);
    if (i < 0 || prices[i] > wallet) break;
    if (++count > 1000000) throw new Error("Sequential purchase runaway");
    if (audit) for (let j = 0; j < prices.length; j++) if (unlocked[j]) assert(prices[i] <= prices[j]);
    wallet -= prices[i];
    levels[i]++;
    totals[(items[i].owner - 1) * 2 + items[i].kind] += 1 / items[i].density;
    prices[i] = items[i].firstPrice * Math.exp(items[i].step * levels[i]);
  }
  return { wallet, count };
}
function buyBulk(items, levels, prices, unlocked, totals, wallet) {
  const first = cheapest(prices, unlocked);
  if (first < 0 || prices[first] > wallet) return { wallet, count: 0 };
  const min = prices[first];
  const countsAt = threshold => items.map((item, i) => unlocked[i] && prices[i] <= threshold
    ? Math.max(0, Math.floor(Math.log(threshold / prices[i]) / item.step) + 1) : 0);
  const totalAt = counts => counts.reduce((sum, n, i) => sum + batchCost(prices[i], items[i].step, n), 0);
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
    if (!Number.isSafeInteger(levels[i])) throw new RangeError("Upgrade level exceeds exact range");
    totals[(items[i].owner - 1) * 2 + items[i].kind] += n / items[i].density;
    prices[i] = items[i].firstPrice * Math.exp(items[i].step * levels[i]);
    count += n;
  }
  const tail = buySequential(items, levels, prices, unlocked, totals, wallet);
  return { wallet: tail.wallet, count: count + tail.count };
}
function segment(stage, p, options = {}) {
  const items = specification(stage), n = items.length, dt = CONFIG.dt;
  const levels = Array(n).fill(0), prices = items.map(i => i.firstPrice), unlocked = Array(n).fill(false);
  const totals = Array(16).fill(0), unlocks = [];
  let x = 1, h = 0, wallet = 0, credit = 0, hits = 0, burstHits = 0, purchases = 0;
  let energy = 0, residual = 0, lastRelease = -CONFIG.energyCooldownTicks, releases = 0;
  let buffer = 0, emergency = 0, bufferSpent = 0, erosion = 0, fatigue = 0;
  let salvaged = 0, removedTotal = 0, zeroTicks = 0, savedTicks = 0;
  let crossedEndgameMarker = false;
  const releaseTicks = [], runTicks = options.runTicks ?? 0;
  const target = options.target ?? CONFIG.coordinates[stage - 1];
  const limit = options.tickLimit ?? 20 * 7200;
  for (let tick = 0; tick < limit; tick++) {
    for (let i = 0; i < n; i++) if (!unlocked[i] && x >= items[i].threshold
      && (items[i].position === 0 || unlocked[i - 1])) {
      unlocked[i] = true; unlocks.push({ id: items[i].id, time: tick * dt });
    }
    const bought = (stage <= 4 && !options.bulk ? buySequential : buyBulk)(
      items, levels, prices, unlocked, totals, wallet, options.audit);
    wallet = bought.wallet; purchases += bought.count;
    const r = effects(stage, totals, p, h, (runTicks + tick) * dt);
    const previousX = x;
    x += r.production * dt; wallet += r.production * r.conversion * dt;
    if (stage >= 6) {
      const recharge = residual * -Math.expm1(-dt / CONFIG.recoveryTime);
      residual -= recharge;
      energy += recharge + CONFIG.energyCharge * Math.log1p(totals[10]) * r.production * dt;
    }
    if (stage >= 7) {
      buffer += CONFIG.bufferGeneration * Math.log1p(totals[12])
        * (1 + Math.log1p(emergency)) * dt;
      emergency *= Math.exp(-dt / CONFIG.regenDecay);
    }
    if (stage >= 8) {
      const oldErosion = erosion;
      fatigue += (Math.log1p(p.failure[7]) * Math.log1p(oldErosion) - fatigue / CONFIG.fatigueDecay) * dt;
      erosion *= Math.exp(-dt / CONFIG.erosionDecay);
    }
    const eroded = stage >= 8 ? CONFIG.erosionEfficiency * Math.log1p(totals[15]) * erosion
      * (1 + Math.log1p(fatigue)) : 0;
    const growth = CONFIG.pressureBase[stage - 1]
      * Math.exp((tick * dt / CONFIG.pressureTime[stage - 1]) ** CONFIG.pressurePower) / (1 + eroded);
    const beforeGrowth = h;
    h += growth * dt;
    const remove = amount => {
      const removed = Math.min(h, amount);
      h -= removed;
      const salvage = r.salvage * Math.log1p(removed);
      wallet += salvage; salvaged += salvage; removedTotal += removed;
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
    if (stage >= 6 && releaseReady(energy, h, tick, lastRelease)) {
      const spent = energy; energy = 0; lastRelease = tick; releases++; releaseTicks.push(tick);
      remove(spent * (1 + CONFIG.energyDamage * Math.log1p(totals[11]))
        * r.actionMultiplier);
      residual += spent * p.failure[5] / (10 + p.failure[5]);
    }
    const win = stage !== 9 && Number.isFinite(target) && x >= target;
    if (!win && stage >= 7 && h >= x && buffer > 0) {
      // Absorb only newly-added pressure that would reach the failure boundary.
      const efficiency = 1 + CONFIG.bufferEfficiency * Math.log1p(totals[13]);
      const absorbed = absorbBuffer(h, x, beforeGrowth, buffer, efficiency);
      buffer = absorbed.buffer; h = absorbed.pressure; bufferSpent += absorbed.used;
      emergency += 0.1 * Math.log1p(p.failure[6]) * Math.log1p(absorbed.used);
      if (h < x && absorbed.used > 0) savedTicks++;
    }
    if (![x, h, wallet, energy, residual, buffer, emergency, erosion, fatigue].every(Number.isFinite)) {
      throw new Error(`Nonfinite state at stage ${stage}, tick ${tick}`);
    }
    if (h === 0) zeroTicks++;
    if (stage === 9 && x >= CONFIG.coordinates[8]) crossedEndgameMarker = true;
    if (win || h >= x) {
      const force = forceFromWork(stage, x);
      return { stage, win, ticks: tick + 1, time: (tick + 1) * dt, runTicks,
        permanent: snapshot(p), peak: x, pressure: h, actualPeak: force.toString(),
        actualForce: force.toJSON(), actualPressure: forceFromWork(stage, h).toJSON(),
        wallet, levels, totals, unlocked, unlocks, hits, burstHits, purchases, releases, releaseTicks,
        energy, residual, buffer, emergency, bufferSpent, erosion, fatigue, salvaged, removedTotal,
        savedTicks, crossedEndgameMarker, zeroSeconds: zeroTicks * dt };
    }
    if (options.audit) {
      assert(h >= 0 && wallet >= 0 && buffer >= -1e-10);
      assert(x >= previousX);
    }
  }
  throw new Error(`Stage ${stage} exceeded ${limit} ticks`);
}
function campaign(options = {}) {
  const p = initialPermanent(), runs = [], failures = Array(8).fill(0), firstWins = [], firstEntries = [];
  const maxRuns = options.maxRuns ?? 400, through = options.through ?? 8;
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
function summary(r) {
  return { failures: r.failures, permanent: r.permanent, runs: r.runs.length,
    seconds: r.runs.reduce((sum, r) => sum + r.time, 0),
    firstWins: r.firstWins.map(s => ({ stage: s.stage, run: s.run, time: s.time,
      permanent: s.permanent, levels: s.levels, releases: s.releases, bufferSpent: s.bufferSpent, erosion: s.erosion })),
    runData: r.runs.map(r => ({ run: r.run, stage: r.failedStage, time: r.time, after: r.after,
      rewards: r.settlements.map(e => [e.kind, e.gained]) })) };
}
function verify() {
  const close = (a, b, tol = 1e-7) =>
    assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
  const baseline = campaign({ through: 4, audit: true });
  assert.deepEqual(baseline.failures.slice(0, 4), [6, 5, 7, 4]);
  const baselineSeconds = baseline.runs.reduce((sum, r) => sum + r.time, 0);
  assert(baselineSeconds >= 15228.9 * 0.9 && baselineSeconds <= 15228.9 * 1.15);
  for (const r of baseline.runs.filter(r => r.failedStage)) assert(r.time >= 480 && r.time <= 900);
  assert.deepEqual(baseline.runs.slice(0, 7).map(r => r.segments[0].purchases),
    [11, 39, 67, 91, 121, 169, 204]);
  const campaignResult = campaign();
  assert.deepEqual(campaignResult.failures, [6, 5, 7, 4, 7, 7, 5, 8]);
  assert.equal(campaignResult.runs.length, 50);
  const firstFourRun = campaignResult.runs[campaignResult.firstWins[3].run - 1];
  assert.deepEqual(firstFourRun.segments.slice(0, 4), baseline.runs.at(-1).segments);
  assert.deepEqual(firstFourRun.settlements.slice(0, 4), baseline.runs.at(-1).settlements);
  const totalSeconds = campaignResult.runs.reduce((sum, r) => sum + r.time, 0);
  assert(totalSeconds > baselineSeconds * 2);
  let priceChecks = 0;
  for (let stage = 1; stage <= 9; stage++) {
    const items = specification(stage);
    assert.equal(items.length, Math.min(stage, 8) * 8);
    assert.equal(new Set(items.map(i => i.id)).size, items.length);
    for (const item of items) {
      assert.equal(item.kind, item.position % 2);
      for (const old of [0, 3]) {
        close(batchCost(item.firstPrice * Math.exp(item.step * old * item.density), item.step, item.density),
          item.base * item.ratio ** old);
        priceChecks++;
      }
    }
    assert.equal(forceFromWork(stage, 1).toNumber(), 1);
    assert.equal(forceFromWork(stage, CONFIG.coordinates[stage - 1]).toString(), CONFIG.targets[stage - 1]);
    const value = Scientific.parse(CONFIG.targets[stage - 1]);
    assert.deepEqual(Scientific.fromJSON(JSON.parse(JSON.stringify(value))), value);
    assert.equal(value.pow(1).toString(), CONFIG.targets[stage - 1]);
    assert(forceFromWork(stage, CONFIG.coordinates[stage - 1] * (1 - 1e-7)).compare(value) < 0);
    assert(forceFromWork(stage, CONFIG.coordinates[stage - 1] * (1 + 1e-7)).compare(value) > 0);
    close(workFromForce(stage, forceFromWork(stage, 2)), 2);
    if (value.exponent > 308) assert.throws(() => value.toNumber(), RangeError);
  }
  const buyingCases = [];
  for (const stage of [2, 3, 4]) for (const wallet of [0.01, 1, 25, 100]) {
    const items = specification(stage), n = items.length, unlocked = Array(n).fill(true);
    const a = Array(n).fill(0), b = Array(n).fill(0);
    const pa = items.map(i => i.firstPrice), pb = [...pa];
    const ta = Array(16).fill(0), tb = Array(16).fill(0);
    const x = buySequential(items, a, pa, unlocked, ta, wallet, true);
    const y = buyBulk(items, b, pb, unlocked, tb, wallet);
    assert.deepEqual(a, b);
    close(x.wallet, y.wallet);
    ta.forEach((value, i) => close(value, tb[i]));
    assert.equal(x.count, y.count);
    buyingCases.push({ stage, wallet, count: x.count });
  }
  const high = specification(8), hl = Array(64).fill(0), hp = high.map(i => i.firstPrice);
  const ht = Array(16).fill(0), hu = Array(64).fill(true);
  const hb = buyBulk(high, hl, hp, hu, ht, 100);
  assert(hb.count > 1e7);
  assert(hp[cheapest(hp, hu)] > hb.wallet);
  const weakP = syncFactors(5, 1, 100, 4, 4, 0), weakD = syncFactors(5, 100, 1, 4, 4, 0);
  assert(weakP.sp > 1 && weakP.sd === 1);
  assert(weakD.sd > 1 && weakD.sp === 1);
  const equal = syncFactors(5, 10, 10, 4, 4, 4);
  assert.equal(equal.sp, 1); assert.equal(equal.sd, 1);
  assert.equal(releaseReady(0, 1, 0, -200), false);
  assert.equal(releaseReady(2, 2, 0, -200), false);
  assert.equal(releaseReady(2, 3, 199, 0), false);
  assert.equal(releaseReady(2, 3, 200, 0), true);
  assert.equal(releaseReady(2, 3, 0, -200), true);
  const safe = absorbBuffer(9, 10, 8, 100, 2);
  assert.equal(safe.used, 0);
  const rescued = absorbBuffer(12, 10, 8, 5, 2);
  assert(rescued.pressure < 10 && rescued.buffer < 5);
  close(rescued.absorbed, rescued.used * 2);
  const exhausted = absorbBuffer(100, 10, 8, 1, 1);
  assert(exhausted.pressure >= 10 && exhausted.buffer === 0);
  const probes = initialPermanent();
  probes.success = [3, 3, 3, 3];
  const e0 = effects(4, Array(16).fill(1), probes, 10, 600);
  const pOnly = snapshot(probes); pOnly.success[0]++;
  const e1 = effects(4, Array(16).fill(1), pOnly, 10, 600);
  assert(e1.production > e0.production); close(e1.hit, e0.hit);
  const dOnly = snapshot(probes); dOnly.success[1]++;
  const e2 = effects(4, Array(16).fill(1), dOnly, 10, 600);
  assert(e2.hit > e0.hit); close(e2.production, e0.production);
  const successOnly = snapshot(probes); successOnly.success[2]++;
  assert(rewardMultiplier("success", successOnly) > rewardMultiplier("success", probes));
  close(rewardMultiplier("failure", successOnly), rewardMultiplier("failure", probes));
  const failureOnly = snapshot(probes); failureOnly.success[3]++;
  assert(rewardMultiplier("failure", failureOnly) > rewardMultiplier("failure", probes));
  close(rewardMultiplier("success", failureOnly), rewardMultiplier("success", probes));
  const ledger = initialPermanent(), income = { success: 0, failure: 0 }, expenses = { success: 0, failure: 0 };
  let savedTicks = 0, releaseEvents = 0;
  for (const r of campaignResult.runs) {
    assert.deepEqual(r.before, ledger);
    let rt = 0;
    for (let i = 0; i < r.segments.length; i++) {
      const s = r.segments[i], event = r.settlements[i], items = specification(s.stage);
      assert.deepEqual(s.permanent, ledger);
      assert.equal(s.runTicks, rt); rt += s.ticks;
      assert.equal(s.burstHits, Math.floor(s.hits / 5));
      if (s.stage === 3) assert.equal(s.hits, Math.floor(s.time + 1e-8));
      if (s.stage < 3) assert.equal(s.hits, 0);
      assert(s.hits <= s.ticks);
      assert.equal(s.releases, s.releaseTicks.length);
      for (let k = 1; k < s.releaseTicks.length; k++) {
        assert(s.releaseTicks[k] - s.releaseTicks[k - 1] >= 200);
      }
      if (s.stage < 6) assert.equal(s.releases, 0);
      assert(s.energy >= 0 && s.buffer >= -1e-10 && s.erosion >= 0 && s.fatigue >= 0);
      const totals = Array(16).fill(0);
      for (let j = 0; j < items.length; j++) {
        assert(Number.isSafeInteger(s.levels[j]) && s.levels[j] >= 0);
        if (!s.unlocked[j]) assert.equal(s.levels[j], 0);
        totals[(items[j].owner - 1) * 2 + items[j].kind] += s.levels[j] / items[j].density;
      }
      totals.forEach((value, j) => close(value, s.totals[j]));
      assert.equal(s.purchases, s.levels.reduce((sum, value) => sum + value, 0));
      assert.deepEqual(settle(ledger, s), event);
      income[event.kind] += event.gained; expenses[event.kind] += event.spent;
      savedTicks += s.savedTicks; releaseEvents += s.releases;
    }
    assert.equal(r.time, rt * CONFIG.dt);
    assert.deepEqual(r.after, ledger);
  }
  assert(savedTicks > 0 && releaseEvents > 0);
  assert.equal(income.failure - expenses.failure, ledger.failureWallet);
  assert.equal(income.success - expenses.success, ledger.successWallet);
  const terminal = campaign({ endgameRuns: 3, maxRuns: 100 });
  const terminalRows = terminal.runs.filter(r => r.failedStage === 9);
  assert.equal(terminalRows.length, 3);
  assert(terminalRows.some(r => r.segments.at(-1).crossedEndgameMarker));
  for (const r of terminalRows) {
    const s = r.segments.at(-1);
    assert.equal(s.stage, 9); assert.equal(s.win, false); assert.equal(s.levels.length, 64);
    assert.equal(r.settlements.at(-1).kind, "failure"); assert.equal(r.settlements.at(-1).owner, 8);
    assert.equal(r.settlements.filter(e => e.kind === "success").length, 8);
  }
  return { passed: true, priceChecks, buyingCases, billionScalePurchases: hb.count,
    firstFour: { failures: baseline.failures.slice(0, 4), seconds: baselineSeconds,
      firstWins: baseline.firstWins.map(s => [s.stage, s.run, s.time]) },
    eight: { failures: campaignResult.failures, runs: campaignResult.runs.length, seconds: totalSeconds,
      permanent: campaignResult.permanent,
      firstWins: campaignResult.firstWins.map(s => [s.stage, s.run, s.time]) },
    income, expenses, savedTicks, releaseEvents,
    terminal: terminalRows.map(r => ({ run: r.run, time: r.time, stageSeconds: r.segments.at(-1).time,
      peak: r.segments.at(-1).peak, crossedMarker: r.segments.at(-1).crossedEndgameMarker,
      reward: r.settlements.at(-1).gained })) };
}
if (require.main === module) {
  if (process.argv.includes("--verify")) console.log(JSON.stringify(verify(), null, 2));
  else {
    const result = campaign({ through: process.argv.includes("--four") ? 4 : 8,
      endgameRuns: process.argv.includes("--endgame") ? 3 : 0 });
    console.log(JSON.stringify(process.argv.includes("--json") ? result : summary(result), null, 2));
  }
}
module.exports = { CONFIG, Scientific, initialPermanent, snapshot, forceFromWork, workFromForce,
  specification, permanentCost, rewardMultiplier, settle, effects, cheapest, batchCost,
  buySequential, buyBulk, syncFactors, releaseReady, absorbBuffer, segment, campaign, summary, verify };
