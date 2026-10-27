// tools/v5-audit.mjs — 数值设计 §11「已执行」清单的自查（对本仓库实现跑）
//
// 与 tools/v5-verify.mjs 的分工：
//   verify  : 完整流程逐字段对拍参考模拟器（等价性）
//   audit   : §11 列出的那批具体审计项（价格、最便宜、攻击计数、双向借用、第五次强化、
//             跨层整程时间、双币账目、压力追上等），保证这些不变量在本实现里也成立
//
// 用法：node tools/v5-audit.mjs

import assert from 'node:assert/strict';
import {
  CONFIG, specification, initialPermanent, snapshot, successPlaceholder, failureReward,
  permanentCost, settle, effects, pressureRate, cheapest, attackClock, suppress, segment, campaign,
} from '../src/v5.js';
import { itemsOf } from '../src/db.js';

const close = (actual, expected, tolerance = 1e-8, label = '') => {
  assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${label} ${actual} != ${expected}`);
};
let checks = 0;
const ok = (name) => { checks++; return name; };

// ── 1. 160 个价格检查：每密度区间总价 = base·ratio^n（§4.3）──
let priceChecks = 0;
for (let layer = 1; layer <= 4; layer++) {
  const items = specification(layer);
  assert.equal(items.length, layer * 8);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const item of items) {
    assert.equal(item.kind, item.position % 2);
    if (item.position) {
      assert(item.threshold > items[(item.owner - 1) * 8 + item.position - 1].threshold);
    }
    for (const oldLevel of [0, 3]) {
      let total = 0;
      for (let i = 0; i < item.density; i++) {
        total += item.firstPrice * Math.exp(item.logStep * (oldLevel * item.density + i));
      }
      close(total, item.base * item.ratio ** oldLevel, 1e-8, `${item.id} L${oldLevel}`);
      priceChecks++;
    }
  }
}
ok('价格密度');

// ── 2. 32 项名字覆盖 & 与 specification 一一对应（外壳层）──
for (let layer = 1; layer <= 4; layer++) {
  const defs = itemsOf(layer);
  assert.equal(defs.length, layer * 8);
  for (const d of defs) {
    assert(d.name && typeof d.name === 'string', `${d.id} 缺名字`);
    assert(d.group && typeof d.group === 'string', `${d.id} 缺分组`);
  }
}
ok('命名覆盖');

// ── 3. 最便宜优先：同价取数组序（§4.4）──
assert.equal(cheapest([{}, {}, {}], [1, 1, 0.5], [true, true, false]), 0);
assert.equal(cheapest([{}, {}, {}], [3, 1, 2], [true, true, true]), 1);
assert.equal(cheapest([{}, {}, {}], [3, 1, 2], [false, false, false]), -1);
ok('最便宜');

// ── 4. 固定 20Hz 攻击计数（§6.2）：1600 tick = 80 秒，命中数 = frequency×80 ──
for (const frequency of [1, 2.5, 19, 20]) {
  let credit = 0, hits = 0;
  for (let tick = 0; tick < 1600; tick++) {
    const clock = attackClock(credit, frequency);
    assert(clock.hits === 0 || clock.hits === 1);
    credit = clock.credit;
    hits += clock.hits;
  }
  assert.equal(hits, frequency * 80, `freq=${frequency}`);
}
ok('攻击计数');

// ── 5. 压力 0 回收 0；回收只按实际 removed（§5.7）──
assert.deepEqual(suppress(0, 100, 100), { pressure: 0, removed: 0, resource: 0 });
close(suppress(2, 100, 0.5).resource, 0.5 * Math.log(3));
assert.equal(suppress(2, 1, 0.5).removed, 1);
ok('削减回收');

// ── 6. 效果：双向借用用同一份原始快照，不递归（§5.3）──
const permanent = initialPermanent();
permanent.failure = [3, 2, 4, 5];
permanent.success = [2, 1, 1, 0];
const totals = [4, 4, 4, 4, 4, 4, 4, 4];
const baseline = effects(4, totals, permanent, 100, 600);
const before = snapshot(permanent);
assert(baseline.firstBonus > effects(4, Array(8).fill(0), permanent, 100, 600).firstBonus);
close(baseline.first, baseline.rawFirst + baseline.share * (baseline.rawSecond - 1), 1e-8, 'first');
close(baseline.second, baseline.rawSecond + baseline.share * (baseline.rawFirst - 1), 1e-8, 'second');
assert(baseline.share >= 0 && baseline.share < 1);
close(baseline.burst, 1 + CONFIG.failure.burstCoefficient * Math.log1p(4), 1e-8, 'burst');
close(baseline.timeMultiplier, 1 + CONFIG.failure.timeCoefficient * Math.log1p(5), 1e-8, 'timeMul');
assert(effects(4, totals, permanent, 100, 1200).hit > baseline.hit, 'F4 应随地整程时间提高');
close(effects(4, totals, permanent, 100, 1200).production, baseline.production, 1e-8, 'production 不随 runTime');

// F1 在第一层用 exp 版本
const firstOnly = initialPermanent();
firstOnly.failure[0] = 3;
assert(effects(1, [1, 1, 0, 0, 0, 0, 0, 0], firstOnly, 0, 0).production
  > effects(1, Array(8).fill(0), firstOnly, 0, 0).production);

// 每个 F 只影响自己的机制
for (let i = 0; i < 4; i++) {
  const changed = snapshot(permanent);
  changed.failure[i]++;
  const next = effects(4, totals, changed, 100, 600);
  if (i === 0 || i === 1) {
    assert(next.production > baseline.production);
    close(next.hit, baseline.hit, 1e-8, `F${i + 1} 不应改变 hit`);
  }
  if (i === 2) {
    assert(next.burst > baseline.burst);
    close(next.production, baseline.production, 1e-8, 'F3 不应改变 production');
    close(next.hit, baseline.hit, 1e-8, 'F3 不应改变 hit');
  }
  if (i === 3) {
    assert(next.hit > baseline.hit);
    close(next.production, baseline.production, 1e-8, 'F4 不应改变 production');
  }
}
assert.deepEqual(permanent, before, 'effects() 不得修改 permanent');

// U 只乘生产与普通削减，不动频率/回收（§7.4）
const upgraded = snapshot(permanent);
upgraded.success[0]++;
const nextSuccess = effects(4, totals, upgraded, 100, 600);
close(nextSuccess.production / baseline.production, nextSuccess.hit / baseline.hit, 1e-8, 'U 同标量');
close(nextSuccess.frequency, baseline.frequency);
close(nextSuccess.salvage, baseline.salvage);

// 频率上限 20 + 溢出转效率（§5.5）
const fAt = (n) => effects(4, totals.map((v, i) => (i === 6 ? n : v)), permanent, 100, 600);
close(fAt(9.5).frequency, 20);
close(fAt(9.5 - 1e-8).hit, fAt(9.5 + 1e-8).hit, 1e-8, '上限处连续');
assert(fAt(100).hit > fAt(10).hit);
ok('效果不变量');

// ── 7. 结算规则（§7.2/§7.3）──
const accountProbe = initialPermanent();
accountProbe.failureWallet = 7;
const successful = settle(accountProbe, { layer: 2, win: true });
assert.equal(successful.gained, 400);
assert.deepEqual(accountProbe.failure, [0, 0, 0, 0], '成功结算不得动 F');
assert.equal(accountProbe.failureWallet, 7, '成功结算不得动失败钱包');
assert.deepEqual(accountProbe.success, [0, 1, 0, 0]);
const successBefore = [...accountProbe.success];
settle(accountProbe, { layer: 3, win: false, peak: 100 });
assert.deepEqual(accountProbe.success, successBefore, '失败结算不得动 U');
assert.equal(accountProbe.successWallet, 0);
assert.deepEqual(accountProbe.failure.slice(0, 2), [0, 0]);
// 只买本次事件所属层
const onlyThisLayer = initialPermanent();
onlyThisLayer.failureWallet = 1e6;
settle(onlyThisLayer, { layer: 3, win: false, peak: 1 });
assert.deepEqual(onlyThisLayer.failure.slice(0, 2).concat(onlyThisLayer.failure[3]), [0, 0, 0]);
assert(onlyThisLayer.failure[2] > 0);
ok('结算规则');

// ── 8. 整程账目回放 + 片段不变量（§11）──
const result = campaign({ audit: true });
assert.deepEqual(result.failures, [6, 5, 6, 4]);
assert.equal(result.runs.length, 22);
assert.deepEqual(result.permanent, {
  failure: [5, 6, 6, 3], success: [11, 4, 1, 1], failureWallet: 18327, successWallet: 5670,
});
const ledger = initialPermanent(), income = { failure: 0, success: 0 }, expenses = { failure: 0, success: 0 };
let accumulated = 0;
for (const run of result.runs) {
  assert.deepEqual(run.before, ledger);
  let accumulatedTicks = 0;
  for (let i = 0; i < run.segments.length; i++) {
    const s = run.segments[i], logged = run.settlements[i];
    assert.deepEqual(s.permanent, ledger, '片段进入时 permanent 必须等于账本');
    assert.equal(s.runTicks, accumulatedTicks, 'runTicks 必须累加');
    accumulatedTicks += s.ticks;
    assert.equal(s.time, s.ticks * CONFIG.dt);
    assert(s.levels.every(Number.isInteger));
    assert.equal(s.purchaseCount, s.levels.reduce((a, n) => a + n, 0), '逐级购买次数');
    assert.equal(s.burstHits, Math.floor(s.hits / 5));
    if (s.layer < 3) assert.equal(s.hits, 0, '一、二层不执行削减');
    if (s.layer === 3) assert.equal(s.hits, Math.floor(s.time + 1e-8));
    assert(s.hits <= s.ticks, '每 tick 至多一次攻击');
    // 临时总量重建一致（totals 与 levels/density 一致）
    const items = specification(s.layer), rebuilt = Array(8).fill(0);
    for (let j = 0; j < items.length; j++) {
      if (!s.unlocked[j]) assert.equal(s.levels[j], 0, '未解锁不得有等级');
      rebuilt[(items[j].owner - 1) * 2 + items[j].kind] += s.levels[j] / items[j].density;
    }
    rebuilt.forEach((v, j) => close(s.totals[j], v, 1e-8, `totals[${j}]`));
    assert(s.pressure >= 0 && s.currency >= 0 && s.salvageTotal >= 0);
    const target = CONFIG.targets[s.layer - 1] / CONFIG.units[s.layer - 1];
    if (s.win) assert(s.peak >= target); else assert(s.peak < target && s.pressure >= s.peak);
    const event = settle(ledger, s);
    assert.deepEqual(event, logged);
    income[event.kind] += event.gained;
    expenses[event.kind] += event.spent;
  }
  assert.equal(run.time, accumulatedTicks * CONFIG.dt);
  assert.deepEqual(run.after, ledger);
  accumulated += run.time;
}
assert.equal(income.failure - expenses.failure, ledger.failureWallet, '失败账目必须平衡');
assert.equal(income.success - expenses.success, ledger.successWallet, '成功账目必须平衡');
assert.equal(result.runs.at(-1).settlements.at(-1).kind, 'success');
assert.equal(result.runs.at(-1).settlements.at(-1).layer, 4, '第四层成功也要结算');
ok('账目回放');

// ── 9. 首次突破 / 首次解锁（§10.4）──
const first = result.firstEntries[0];
assert(first.peak >= 1e3 && first.peak < 1e4);
assert(first.unlocks[1].time >= 50);
const firstLevels = result.firstWins[0].levels;
const firstTotal = firstLevels.reduce((a, n) => a + n, 0);
assert(firstTotal >= 180 && firstTotal <= 220, '第一次守护时第一层总等级应约 200');
ok('首次突破');

// ── 10. 压力追上测试：4 层 × 4 组永久等级（§11 的 16 组关闭胜利）──
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
assert(stress.some((s) => s.layer === 4 && s.zeroSeconds > 0 && s.recovered), '第四层应出现压力被压到 0 的时刻');
ok('压力追上');

// ── 11. 确定性：两次 campaign 完全相同 ──
assert.deepEqual(campaign(), result);
ok('确定性');

// ── 12. 失败奖励公式与成功奖励表（§7.2/§7.3）──
assert.equal(failureReward({ layer: 1, peak: 2.49e24 }), Math.floor(4 * 10 ** 1));
assert.equal(failureReward({ layer: 1, peak: 1 }), 4);
assert.equal(permanentCost('success', 2, 0), 400);
assert.equal(permanentCost('failure', 1, 0), 4);
close(successPlaceholder(1, [1, 0, 0, 0]), 10 ** 0.48);
ok('奖励/价格');

console.log(`[v5-audit] 全部通过：${priceChecks} 个价格检查 + ${checks} 组不变量`);
console.log(`  轮数 ${result.runs.length}  失败 ${JSON.stringify(result.failures)}  累计 ${accumulated}s`);
console.log(`  压力追上 16 组：${stress.map((s) => `${s.layer}/${s.boost}:${s.time.toFixed(0)}s`).join(' ')}`);
