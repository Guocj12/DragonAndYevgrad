"use strict";

const assert = require("node:assert/strict");

const CONFIG = {
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

function specification(layer) {
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

function initialPermanent() {
  return { failure: [0, 0, 0, 0], success: [0, 0, 0, 0], failureWallet: 0, successWallet: 0 };
}

function snapshot(permanent) {
  return { ...permanent, failure: [...permanent.failure], success: [...permanent.success] };
}

function successPlaceholder(layer, levels) {
  const global = levels.reduce((sum, level, i) => sum + CONFIG.success.placeholderExponent[i] * level, 0);
  return 10 ** (global + CONFIG.success.ownPlaceholderExponent[layer - 1] * levels[layer - 1]);
}

function failureReward(result) {
  const target = CONFIG.targets[result.layer - 1] / CONFIG.units[result.layer - 1];
  const progress = result.layer === 1
    ? Math.log10(result.peak) / Math.log10(target) : (result.peak - 1) / (target - 1);
  return Math.floor(4 * 10 ** (result.layer - 1 + progress));
}

function permanentCost(kind, layer, level) {
  return Math.ceil(CONFIG[kind].costBase[layer - 1] * CONFIG[kind].costRatio[layer - 1] ** level);
}

function settle(permanent, result) {
  const kind = result.win ? "success" : "failure";
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

function effects(layer, totals, permanent, pressure, runTime) {
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

function pressureRate(layer, time) {
  return CONFIG.pressureBase[layer - 1]
    * Math.exp((time / CONFIG.pressureTimes[layer - 1]) ** CONFIG.pressureExponent);
}

function cheapest(items, prices, unlocked) {
  let best = -1;
  for (let i = 0; i < items.length; i++) {
    if (unlocked[i] && (best === -1 || prices[i] < prices[best])) best = i;
  }
  return best;
}

function attackClock(credit, frequency) {
  const next = credit + frequency * CONFIG.dt;
  const hits = next >= 1 - 1e-12 ? 1 : 0;
  return { credit: Math.max(0, next - hits), hits };
}

function suppress(pressure, hit, conversion) {
  const removed = Math.min(pressure, hit);
  return { pressure: pressure - removed, removed, resource: conversion * Math.log1p(removed) };
}

function segment(layer, permanent, options = {}) {
  const items = specification(layer), dt = CONFIG.dt, runTicks = options.runTicks ?? 0;
  const levels = items.map(() => 0), prices = items.map(i => i.firstPrice);
  const unlocked = items.map(() => false), totals = Array(8).fill(0);
  const target = options.target ?? CONFIG.targets[layer - 1] / CONFIG.units[layer - 1];
  const unlocks = [], checkpoints = {}, purchases = [];
  let power = 1, currency = 0, pressure = 0, credit = 0, hits = 0, burstHits = 0;
  let purchaseCount = 0, purchaseTicks = 0, lastPurchase = 0, maxPurchaseGap = 0;
  let zeroTicks = 0, recovered = false, compressed = false, salvageTotal = 0, removedTotal = 0;
  for (let tick = 0; tick < 20 * 7200; tick++) {
    for (let i = 0; i < items.length; i++) {
      if (!unlocked[i] && power >= items[i].threshold
          && (items[i].position === 0 || unlocked[i - 1])) {
        unlocked[i] = true;
        unlocks.push({ id: items[i].id, time: tick * dt, power });
      }
    }
    let bought = false;
    for (let count = 0;; count++) {
      if (count > 1000000) throw new Error("Purchase runaway");
      const i = cheapest(items, prices, unlocked);
      if (i === -1 || currency < prices[i]) break;
      if (options.audit) {
        for (let j = 0; j < items.length; j++) if (unlocked[j]) assert(prices[i] <= prices[j]);
      }
      currency -= prices[i];
      levels[i]++;
      totals[(items[i].owner - 1) * 2 + items[i].kind] += 1 / items[i].density;
      prices[i] = items[i].firstPrice * Math.exp(items[i].logStep * levels[i]);
      purchaseCount++;
      bought = true;
      if (options.trace) purchases.push({ id: items[i].id, time: tick * dt, level: levels[i] });
    }
    if (bought) {
      purchaseTicks++;
      maxPurchaseGap = Math.max(maxPurchaseGap, tick * dt - lastPurchase);
      lastPurchase = tick * dt;
    }
    const elapsed = (runTicks + tick) * dt;
    const r = effects(layer, totals, permanent, pressure, elapsed);
    power += r.production * dt;
    currency += r.production * r.conversion * dt;
    pressure += pressureRate(layer, tick * dt) * dt;
    if (layer >= 3) {
      const clock = attackClock(credit, r.frequency);
      credit = clock.credit;
      if (clock.hits) {
        hits++;
        const enhanced = hits % CONFIG.failure.burstEvery === 0;
        if (enhanced) burstHits++;
        const hit = effects(layer, totals, permanent, pressure, elapsed).hit * (enhanced ? r.burst : 1);
        const outcome = suppress(pressure, hit, r.salvage);
        pressure = outcome.pressure;
        currency += outcome.resource;
        salvageTotal += outcome.resource;
        removedTotal += outcome.removed;
      }
    }
    if (![power, pressure, currency, credit].every(Number.isFinite)) {
      throw new Error(`Non-finite state at layer=${layer} tick=${tick}`);
    }
    if (layer >= 3 && pressure === 0) { zeroTicks++; compressed = true; }
    if (compressed && pressure > 0) recovered = true;
    for (const mark of [10, 25, 50, 100, 1000, 1e6, 1e12, 1e18]) {
      if (power >= mark && checkpoints[mark] === undefined) checkpoints[mark] = (tick + 1) * dt;
    }
    const win = power >= target;
    if (win || pressure >= power) {
      return {
        layer, permanent: snapshot(permanent), win, ticks: tick + 1, time: (tick + 1) * dt,
          runTicks, peak: power, actualPeak: power * CONFIG.units[layer - 1], pressure, currency,
          levels, unlocked, totals, unlocks, checkpoints, hits, burstHits, salvageTotal, removedTotal,
          purchaseCount, purchaseTicks, maxPurchaseGap, zeroSeconds: zeroTicks * dt, recovered,
          ...(options.trace ? { purchases } : {}),
        };
    }
  }
  throw new Error(`Segment timeout at layer=${layer}`);
}

function campaign(options = {}) {
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
  throw new Error("Campaign did not finish in 300 runs");
}

function summary(result) {
  const view = s => ({
      layer: s.layer, run: s.run, permanent: s.permanent, time: s.time, peak: s.actualPeak,
        levels: s.levels, unlocks: s.unlocks,
      });
  return {
    failures: result.failures, permanent: result.permanent,
      seconds: result.runs.reduce((sum, r) => sum + r.time, 0),
      firstWins: result.firstWins.map(view), firstEntries: result.firstEntries.map(view),
      runs: result.runs.map(r => ({
          run: r.run, layer: r.failedLayer ?? "complete", time: r.time, before: r.before, after: r.after,
            settlements: r.settlements, levels: r.segments.at(-1).levels,
          })),
    };
}

function verify() {
  const close = (actual, expected, tolerance = 1e-8) => {
    assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
        `${actual} != ${expected}`);
  };
  let priceChecks = 0;
  for (let layer = 1; layer <= 4; layer++) {
    const items = specification(layer);
    assert.equal(items.length, layer * 8);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    for (const item of items) {
      assert.equal(item.kind, item.position % 2);
      if (item.position) assert(item.threshold > items[(item.owner - 1) * 8 + item.position - 1].threshold);
      for (const oldLevel of [0, 3]) {
        let total = 0;
        for (let i = 0; i < item.density; i++) {
          total += item.firstPrice * Math.exp(item.logStep * (oldLevel * item.density + i));
        }
        close(total, item.base * item.ratio ** oldLevel);
        priceChecks++;
      }
    }
  }
  assert.equal(cheapest([{}, {}, {}], [1, 1, 0.5], [true, true, false]), 0);
  assert.equal(cheapest([{}, {}, {}], [3, 1, 2], [true, true, true]), 1);
  for (const frequency of [1, 2.5, 19, 20]) {
    let credit = 0, hits = 0;
    for (let tick = 0; tick < 1600; tick++) {
      const clock = attackClock(credit, frequency);
      assert(clock.hits === 0 || clock.hits === 1);
      credit = clock.credit;
      hits += clock.hits;
    }
    assert.equal(hits, frequency * 80);
  }
  assert.deepEqual(suppress(0, 100, 100), { pressure: 0, removed: 0, resource: 0 });
  close(suppress(2, 100, 0.5).resource, 0.5 * Math.log(3));
  const permanent = initialPermanent();
  permanent.failure = [3, 2, 4, 5];
  permanent.success = [2, 1, 1, 0];
  const totals = [4, 4, 4, 4, 4, 4, 4, 4];
  const baseline = effects(4, totals, permanent, 100, 600);
  const before = snapshot(permanent);
  assert(baseline.firstBonus > effects(4, Array(8).fill(0), permanent, 100, 600).firstBonus);
  close(baseline.first, baseline.rawFirst + baseline.share * (baseline.rawSecond - 1));
  close(baseline.second, baseline.rawSecond + baseline.share * (baseline.rawFirst - 1));
  assert(baseline.share >= 0 && baseline.share < 1);
  close(baseline.burst, 1 + CONFIG.failure.burstCoefficient * Math.log1p(4));
  close(baseline.timeMultiplier, 1 + CONFIG.failure.timeCoefficient * Math.log1p(5));
  assert(effects(4, totals, permanent, 100, 1200).hit > baseline.hit);
  close(effects(4, totals, permanent, 100, 1200).production, baseline.production);
  const firstOnly = initialPermanent();
  firstOnly.failure[0] = 3;
  assert(effects(1, [1, 1, 0, 0, 0, 0, 0, 0], firstOnly, 0, 0).production
    > effects(1, Array(8).fill(0), firstOnly, 0, 0).production);
  for (let i = 0; i < 4; i++) {
    const changed = snapshot(permanent);
    changed.failure[i]++;
    const next = effects(4, totals, changed, 100, 600);
    if (i === 0 || i === 1) { assert(next.production > baseline.production); close(next.hit, baseline.hit); }
    if (i === 2) {
      assert(next.burst > baseline.burst);
      close(next.production, baseline.production);
      close(next.hit, baseline.hit);
    }
    if (i === 3) { assert(next.hit > baseline.hit); close(next.production, baseline.production); }
  }
  assert.deepEqual(permanent, before);
  const upgraded = snapshot(permanent);
  upgraded.success[0]++;
  const nextSuccess = effects(4, totals, upgraded, 100, 600);
  close(nextSuccess.production / baseline.production, nextSuccess.hit / baseline.hit);
  close(nextSuccess.frequency, baseline.frequency);
  close(nextSuccess.salvage, baseline.salvage);
  const fAt = n => effects(4, totals.map((value, i) => i === 6 ? n : value), permanent, 100, 600);
  close(fAt(9.5).frequency, 20);
  close(fAt(9.5 - 1e-8).hit, fAt(9.5 + 1e-8).hit);
  assert(fAt(100).hit > fAt(10).hit);
  const accountProbe = initialPermanent();
  accountProbe.failureWallet = 7;
  const successful = settle(accountProbe, { layer: 2, win: true });
  assert.equal(successful.gained, 400);
  assert.deepEqual(accountProbe.failure, [0, 0, 0, 0]);
  assert.equal(accountProbe.failureWallet, 7);
  assert.deepEqual(accountProbe.success, [0, 1, 0, 0]);
  const successBeforeFailure = [...accountProbe.success];
  settle(accountProbe, { layer: 3, win: false, peak: 100 });
  assert.deepEqual(accountProbe.success, successBeforeFailure);
  assert.equal(accountProbe.successWallet, 0);
  assert.deepEqual(accountProbe.failure.slice(0, 2), [0, 0]);
  const result = campaign({ audit: true });
  assert.deepEqual(result.failures, [6, 5, 6, 4]);
  assert.equal(result.runs.length, 22);
  assert.deepEqual(result.permanent, {
      failure: [5, 6, 6, 3], success: [11, 4, 1, 1], failureWallet: 18327, successWallet: 5670,
      });
  const seconds = result.runs.reduce((sum, r) => sum + r.time, 0);
  assert(seconds >= 4 * 3600 && seconds <= 8 * 3600);
  const ledger = initialPermanent(), income = { failure: 0, success: 0 }, expenses = { failure: 0, success: 0 };
  const failed = result.runs.filter(run => run.failedLayer);
  for (const run of failed) assert(run.time >= 480 && run.time <= 900);
  for (const run of result.runs) {
    assert.deepEqual(run.before, ledger);
    let accumulatedTicks = 0;
    for (let i = 0; i < run.segments.length; i++) {
      const s = run.segments[i], logged = run.settlements[i];
      assert.deepEqual(s.permanent, ledger);
      assert.equal(s.runTicks, accumulatedTicks);
      accumulatedTicks += s.ticks;
      assert.equal(s.time, s.ticks * CONFIG.dt);
      assert(s.levels.every(Number.isInteger));
      assert.equal(s.purchaseCount, s.levels.reduce((sum, n) => sum + n, 0));
      assert.equal(s.burstHits, Math.floor(s.hits / 5));
      if (s.layer < 3) assert.equal(s.hits, 0);
      if (s.layer === 3) assert.equal(s.hits, Math.floor(s.time + 1e-8));
      assert(s.hits <= s.ticks);
      const items = specification(s.layer), reconstructed = Array(8).fill(0);
      for (let j = 0; j < items.length; j++) {
        if (!s.unlocked[j]) assert.equal(s.levels[j], 0);
        reconstructed[(items[j].owner - 1) * 2 + items[j].kind] += s.levels[j] / items[j].density;
      }
      reconstructed.forEach((value, j) => close(s.totals[j], value));
      assert(s.pressure >= 0 && s.currency >= 0 && s.salvageTotal >= 0);
      const target = CONFIG.targets[s.layer - 1] / CONFIG.units[s.layer - 1];
      if (s.win) assert(s.peak >= target);
      else assert(s.peak < target && s.pressure >= s.peak);
      const event = settle(ledger, s);
      assert.deepEqual(event, logged);
      income[event.kind] += event.gained;
      expenses[event.kind] += event.spent;
    }
    assert.equal(run.time, accumulatedTicks * CONFIG.dt);
    assert.deepEqual(run.after, ledger);
  }
  assert.equal(income.failure - expenses.failure, ledger.failureWallet);
  assert.equal(income.success - expenses.success, ledger.successWallet);
  assert.equal(result.runs.at(-1).settlements.at(-1).kind, "success");
  assert.equal(result.runs.at(-1).settlements.at(-1).layer, 4);
  const first = result.firstEntries[0];
  assert(first.peak >= 1e3 && first.peak < 1e4);
  assert(first.unlocks[1].time >= 50);
  const firstLevels = result.firstWins[0].levels;
  assert(firstLevels.reduce((sum, n) => sum + n, 0) >= 180);
  assert(firstLevels.reduce((sum, n) => sum + n, 0) <= 220);
  const stress = [];
  for (let layer = 1; layer <= 4; layer++) {
    for (const boost of [0, 2, 5, 8]) {
      const state = initialPermanent();
      state.failure.fill(boost);
      state.success.fill(Math.floor(boost / 2));
      const s = segment(layer, state, { target: Infinity, runTicks: 12000 });
      assert(!s.win && Number.isFinite(s.time));
      assert.equal(s.burstHits, Math.floor(s.hits / 5));
      stress.push({ layer, boost, time: s.time, zeroSeconds: s.zeroSeconds, recovered: s.recovered });
    }
  }
  assert(stress.some(s => s.layer === 4 && s.zeroSeconds > 0 && s.recovered));
  assert.deepEqual(campaign(), result);
  return {
    passed: true, priceChecks, failures: result.failures, runs: result.runs.length,
      permanent: result.permanent, seconds,
      failureSecondsRange: [Math.min(...failed.map(r => r.time)), Math.max(...failed.map(r => r.time))],
      income, expenses, firstWins: result.firstWins, firstEntries: result.firstEntries, stress,
    };
}

if (require.main === module) {
  const result = process.argv.includes("--verify") ? verify()
    : process.argv.includes("--json") ? campaign() : summary(campaign());
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  CONFIG, specification, initialPermanent, snapshot, successPlaceholder, failureReward,
    permanentCost, settle, effects, pressureRate, cheapest, attackClock, suppress, segment, campaign, summary, verify,
  };
