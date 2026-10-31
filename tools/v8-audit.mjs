// tools/v8-audit.mjs — 独立自查（不依赖参考物，只查「我们自己的实现满足文档 §12.7 的性质」）
//
//   node tools/v8-audit.mjs
//
// 覆盖：
//   · 704 组价格恒等式（§12.7）
//   · 项数 / 唯一 id / kind 交替 / 当前层门槛递增
//   · 真实量与工作坐标互逆、边界、toNumber 超范围抛错
//   · 同步只补弱侧、平衡不补、强侧回馈非递归
//   · 蓄能触发边界（0 / 相等 / 199 / 200）
//   · 缓冲三态（安全 / 救活 / 耗尽仍失败）
//   · 四个成功科技作用域互不串联
//   · 批量与逐级购买的等级/钱包/有效量一致（12 组）+ 18 亿级预算
//   · 终局永不成功、越标线只记标志
//   · 全流程账目：收入 − 支出 == 余额；八层成功事件恰好 8 次
//   · 前四前缀与四层检查点逐事件相同
import assert from 'node:assert/strict';
import {
  CONFIG, Scientific, specification, initialPermanent, snapshot, forceFromWork, workFromForce,
  permanentCost, rewardMultiplier, settle, effects, syncFactors, releaseReady, absorbBuffer,
  cheapest, batchCost, buySequential, buyBulk, segment, campaign,
} from '../src/v8.js';
import { itemsOf } from '../src/db.js';

let checks = 0;
const ok = (label) => { checks++; return label; };
const close = (a, b, tol, label) => {
  const t = tol ?? 1e-7;
  assert(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b} (±${t})`);
};

// ── 1. 价格恒等式（704 组）──
let priceChecks = 0;
for (let stage = 1; stage <= 9; stage++) {
  const items = specification(stage);
  assert.equal(items.length, Math.min(stage, 8) * 8, ok(`stage ${stage} 项数`));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, ok('id 唯一'));
  for (const item of items) {
    assert.equal(item.kind, item.position % 2, ok('kind 交替'));
    for (const old of [0, 3]) {
      close(batchCost(item.firstPrice * Math.exp(item.step * old * item.density), item.step, item.density),
        item.base * item.ratio ** old, 1e-9, `${item.id} L${old} 总价`);
      priceChecks++;
    }
  }
  // 当前层门槛递增
  const layer = Math.min(stage, 8);
  for (let p = 1; p < 8; p++) {
    const prev = items[(layer - 1) * 8 + p - 1], cur = items[(layer - 1) * 8 + p];
    assert(cur.threshold > prev.threshold, ok(`${prev.id} < ${cur.id} 门槛`));
  }
}
assert.equal(priceChecks, 704, `价格检查组数 ${priceChecks}`);

// ── 2. 真实量 / 工作坐标 ──
for (let stage = 1; stage <= 9; stage++) {
  assert.equal(forceFromWork(stage, 1).toNumber(), 1, ok('work=1 → F=1'));
  assert.equal(forceFromWork(stage, CONFIG.coordinates[stage - 1]).toString(), CONFIG.targets[stage - 1],
    ok(`stage ${stage} 目标字符串`));
  const value = Scientific.parse(CONFIG.targets[stage - 1]);
  assert.deepEqual(Scientific.fromJSON(JSON.parse(JSON.stringify(value))), value, ok('Scientific JSON 往返'));
  assert.equal(value.pow(1).toString(), CONFIG.targets[stage - 1], ok('pow(1) 恒等'));
  assert(forceFromWork(stage, CONFIG.coordinates[stage - 1] * (1 - 1e-7)).compare(value) < 0, ok('下方边界'));
  assert(forceFromWork(stage, CONFIG.coordinates[stage - 1] * (1 + 1e-7)).compare(value) > 0, ok('上方边界'));
  close(workFromForce(stage, forceFromWork(stage, 2)), 2, 1e-12, ok('互逆'));
  if (value.exponent > 308) assert.throws(() => value.toNumber(), RangeError, ok('toNumber 抛错'));
}

// ── 3. 同步 ──
{
  const weakP = syncFactors(5, 1, 100, 4, 4, 0);
  assert(weakP.sp > 1 && weakP.sd === 1, ok('生产弱 → 只补 SP'));
  const weakD = syncFactors(5, 100, 1, 4, 4, 0);
  assert(weakD.sd > 1 && weakD.sp === 1, ok('削减弱 → 只补 SD'));
  const equal = syncFactors(5, 10, 10, 4, 4, 4);
  assert.equal(equal.sp, 1); assert.equal(equal.sd, 1, ok('相等不补'));
  const deep = syncFactors(5, 1, 100, 8, 0, 0);
  const deep2 = syncFactors(5, 1, 100, 8, 0, 0);
  assert.equal(deep.sp, deep2.sp, ok('同输入同输出（非递归）'));
  const low = syncFactors(4, 1, 100, 4, 4, 0);
  assert.equal(low.sp, 1); assert.equal(low.sd, 1, ok('四层不启用同步'));
}

// ── 4. 蓄能触发边界 ──
assert.equal(releaseReady(0, 1, 0, -200), false, ok('E=0 不触发'));
assert.equal(releaseReady(2, 2, 0, -200), false, ok('h==E 不触发'));
assert.equal(releaseReady(2, 3, 199, 0), false, ok('199 tick 不触发'));
assert.equal(releaseReady(2, 3, 200, 0), true, ok('200 tick 触发'));
assert.equal(releaseReady(2, 3, 0, -200), true, ok('首次可释放'));

// ── 5. 缓冲三态 ──
{
  const safe = absorbBuffer(9, 10, 8, 100, 2);
  assert.equal(safe.used, 0, ok('安全不消耗'));
  const rescued = absorbBuffer(12, 10, 8, 5, 2);
  assert(rescued.pressure < 10 && rescued.buffer < 5, ok('足够时救活'));
  close(rescued.absorbed, rescued.used * 2, 1e-12, ok('absorbed = used × 效率'));
  const exhausted = absorbBuffer(100, 10, 8, 1, 1);
  assert(exhausted.pressure >= 10 && exhausted.buffer === 0, ok('不足时耗尽仍失败'));
}

// ── 6. 四个成功科技作用域 ──
{
  const base = initialPermanent();
  base.success = [3, 3, 3, 3];
  const e0 = effects(4, Array(16).fill(1), base, 10, 600);
  const up = snapshot(base); up.success[0]++;
  const e1 = effects(4, Array(16).fill(1), up, 10, 600);
  assert(e1.production > e0.production, ok('up 只增生产'));
  close(e1.hit, e0.hit, 1e-12, ok('up 不增削减'));
  const ud = snapshot(base); ud.success[1]++;
  const e2 = effects(4, Array(16).fill(1), ud, 10, 600);
  assert(e2.hit > e0.hit, ok('ud 只增削减'));
  close(e2.production, e0.production, 1e-12, ok('ud 不增生产'));
  const us = snapshot(base); us.success[2]++;
  assert(rewardMultiplier('success', us) > rewardMultiplier('success', base), ok('us 只增成功收入'));
  close(rewardMultiplier('failure', us), rewardMultiplier('failure', base), 1e-12, ok('us 不增失败收入'));
  const uf = snapshot(base); uf.success[3]++;
  assert(rewardMultiplier('failure', uf) > rewardMultiplier('failure', base), ok('uf 只增失败收入'));
  close(rewardMultiplier('success', uf), rewardMultiplier('success', base), 1e-12, ok('uf 不增成功收入'));
}

// ── 7. 批量 vs 逐级（12 组）──
{
  const cases = [];
  for (const stage of [2, 3, 4]) for (const wallet of [0.01, 1, 25, 100]) {
    const items = specification(stage), n = items.length, unlocked = Array(n).fill(true);
    const a = Array(n).fill(0), b = Array(n).fill(0);
    const pa = items.map((i) => i.firstPrice), pb = [...pa];
    const ta = Array(16).fill(0), tb = Array(16).fill(0);
    const x = buySequential(items, a, pa, unlocked, ta, wallet, true);
    const y = buyBulk(items, b, pb, unlocked, tb, wallet);
    assert.deepEqual(a, b, ok(`stage ${stage} wallet ${wallet} 等级一致`));
    close(x.wallet, y.wallet, 1e-7, ok('钱包一致'));
    ta.forEach((v, i) => close(v, tb[i], 1e-7, ok('有效量一致')));
    assert.equal(x.count, y.count, ok('购买次数一致'));
    cases.push([stage, wallet, x.count]);
  }
  // 18 亿级预算压力测试
  const high = specification(8), hl = Array(64).fill(0), hp = high.map((i) => i.firstPrice);
  const ht = Array(16).fill(0), hu = Array(64).fill(true);
  const hb = buyBulk(high, hl, hp, hu, ht, 100);
  assert(hb.count > 1e7, `亿级批量购买次数 ${hb.count}`);
  assert(hp[cheapest(hp, hu)] > hb.wallet, ok('买完仍不够下一项'));
  hl.forEach((v, i) => assert(Number.isSafeInteger(v), ok(`level[${i}] 安全整数`)));
}

// ── 8. 终局永不成功 ──
{
  const p = initialPermanent();
  p.failure = [9, 9, 9, 9, 9, 9, 9, 9];
  const s = segment(9, p, {});
  assert.equal(s.win, false, ok('终局永不 success'));
  // 越标线只是统计标志，不换层、不停机（§11.2）；是否越线取决于本片段实际峰值
  assert.equal(s.crossedEndgameMarker, s.peak >= CONFIG.coordinates[8], ok('越标线标志与实际峰值一致'));
  const ev = settle(p, s);
  assert.equal(ev.kind, 'failure', ok('终局失败结算'));
  assert.equal(ev.owner, 8, ok('终局失败归属八层'));
  assert.throws(() => settle(initialPermanent(), { ...s, win: true }), /Endgame must not succeed/, ok('终局不允许成功结算'));
}

// ── 9. 全流程账目 + 结构 ──
const eight = campaign({});
{
  const ledger = initialPermanent();
  const income = { success: 0, failure: 0 }, expense = { success: 0, failure: 0 };
  let savedTicks = 0, releases = 0, successEvents = 0, winSegments = 0;
  for (const r of eight.runs) {
    assert.deepEqual(r.before, ledger, ok('轮开始 permanent 一致'));
    let rt = 0;
    for (let i = 0; i < r.segments.length; i++) {
      const s = r.segments[i], ev = r.settlements[i], items = specification(s.stage);
      assert.deepEqual(s.permanent, ledger, ok('片段 permanent 快照一致'));
      assert.equal(s.runTicks, rt, ok('runTicks 累加'));
      rt += s.ticks;
      assert.equal(s.burstHits, Math.floor(s.hits / 5), ok('第五次强化计数'));
      if (s.stage < 3) assert.equal(s.hits, 0, ok('一、二层不攻击'));
      if (s.stage < 6) assert.equal(s.releases, 0, ok('六层前不释放'));
      if (s.stage === 3) assert.equal(s.hits, Math.floor(s.time + 1e-8), ok('三层每秒一次'));
      assert(s.energy >= 0 && s.buffer >= -1e-10 && s.erosion >= 0 && s.fatigue >= 0, ok('状态非负'));
      assert(s.levels.every((v) => Number.isSafeInteger(v) && v >= 0), ok('等级安全整数'));
      for (let k = 1; k < s.releaseTicks.length; k++) {
        assert(s.releaseTicks[k] - s.releaseTicks[k - 1] >= 200, ok('释放间隔 ≥ 200 tick'));
      }
      // totals 可由 levels/density 复算
      const totals = Array(16).fill(0);
      for (let j = 0; j < items.length; j++) {
        totals[(items[j].owner - 1) * 2 + items[j].kind] += s.levels[j] / items[j].density;
      }
      totals.forEach((v, j) => close(v, s.totals[j], 1e-7, ok(`totals[${j}] 复算`)));
      assert.equal(s.purchases, s.levels.reduce((a, b) => a + b, 0), ok('purchases == Σlevels'));
      // 用本地 ledger 独立重放每一次结算：既验证 settle 可重放，也验证账目序列
      const next = snapshot(ledger);
      const replayed = settle(next, s);
      assert.deepEqual(replayed, ev, ok('settle 可重放'));
      ledger.failure = next.failure; ledger.success = next.success;
      ledger.failureWallet = next.failureWallet; ledger.successWallet = next.successWallet;
      income[ev.kind] += ev.gained; expense[ev.kind] += ev.spent;
      if (ev.kind === 'success') successEvents++;
      if (s.win) winSegments++;
      savedTicks += s.savedTicks; releases += s.releases;
    }
    assert.equal(r.time, rt * CONFIG.dt, ok('轮时间 = Σticks×dt'));
    assert.deepEqual(r.after, ledger, ok('轮结束 permanent 一致'));
  }
  assert(savedTicks > 0 && releases > 0, `缓冲救活 ${savedTicks} tick / 释放 ${releases} 次`);
  assert.equal(income.failure - expense.failure, ledger.failureWallet, ok('失败钱包账目'));
  assert.equal(income.success - expense.success, ledger.successWallet, ok('成功钱包账目'));
  assert.equal(successEvents, winSegments, `成功事件数 ${successEvents} 应等于成功片段数 ${winSegments}`);
  assert.equal(eight.runs.at(-1).segments.filter((s) => s.win).length, 8, ok('末轮八段全成功'));
  assert.equal(eight.runs.length, 50, ok('八层检查点 50 轮'));
  assert.deepEqual(eight.permanent.failure, [7, 6, 8, 4, 9, 9, 8, 9], ok('最终失败永久'));
  assert.deepEqual(eight.permanent.success, [37, 37, 36, 36], ok('最终成功科技'));
  console.log(`  · 缓冲救活 ${savedTicks} tick，蓄能释放 ${releases} 次，`
    + `收入 F${income.failure}/S${income.success}，支出 F${expense.failure}/S${expense.success}`);
}

// ── 10. 前四前缀与四层检查点逐事件相同 ──
{
  const four = campaign({ through: 4 });
  const lastFourRun = four.runs.at(-1);
  const firstEightRun = eight.runs[four.firstWins[3].run - 1];
  assert.deepEqual(firstEightRun.segments.slice(0, 4), lastFourRun.segments, ok('八层流程的前四段 == 四层检查点'));
  assert.deepEqual(firstEightRun.settlements.slice(0, 4), lastFourRun.settlements, ok('前四结算一致'));
  assert.equal(four.runs.length, 23, ok('四层检查点 23 轮'));
  const fourSeconds = four.runs.reduce((s, r) => s + r.time, 0);
  close(fourSeconds, 15935, 1e-12, ok('四层时长 15935.00s'));
}

// ── 11. 科技树（外壳）：中心 0 级零影响 / 等级效果 / 前置 / 价格 ──
{
  const { Engine: Eng, createInitialState: init } = await import('../src/engine.js');
  const { treeInterval: iv, centerCost: cCost, TREE_NODE_TOTAL } = await import('../src/tree.js');
  const mk = (center) => {
    const e = new Eng(init());
    e.headless = true;
    e.s.tree.center = center;
    e.permanent.successWallet = 1e6;
    e.permanent.failureWallet = 1e6;
    return e;
  };
  const zero = mk(0);
  for (let i = 0; i < 200; i++) zero.treeAutoStep(0.05);
  assert(!Object.values(zero.s.autoBuyLv).some((v) => v > 0), ok('中枢 0 级不自动买角色科技'));
  assert(zero.permanent.success.every((v) => v === 0), ok('中枢 0 级不自动买主干'));
  assert(zero.s.auto.collapse === false && zero.s.auto.guard === false, ok('中枢 0 级不改自动结算'));

  const four = mk(4);
  for (let i = 0; i < 200; i++) four.treeAutoStep(0.05);
  assert(Object.values(four.s.autoBuyLv).every((v) => v > 0), ok('中枢 1 级起自动买全角色科技'));
  assert(four.s.auto.collapse && four.s.auto.guard, ok('中枢 2/3 级开自动覆灭/守护'));
  assert(four.permanent.success[0] > 0 && four.permanent.success[1] === 0,
    ok('中枢 4 级只自动买「净化效率」'));

  const seven = mk(7);
  for (let i = 0; i < 400; i++) seven.treeAutoStep(0.05);
  assert(seven.permanent.success.every((v) => v > 0), ok('中枢 7 级四个主干全自动买'));

  const low = mk(0);
  assert.equal(low.buyTreeNode('trunk-up').ok, false, ok('中枢未买时主干不可购买（前置）'));
  low.s.tree.center = 1;
  assert.equal(low.buyTreeNode('trunk-up').ok, true, ok('中枢 1 级后主干可购买'));
  assert.equal(low.buyTreeNode('xyt-a1').ok, false, ok('角色节点不可购买'));

  assert.equal(cCost(0), 2); assert.equal(cCost(6), 2); assert.equal(cCost(7), 4);
  assert.equal(cCost(12), 128); assert.equal(cCost(13), null, ok('中枢价格：前 7 级 2 PP，之后每级 ×2'));
  assert.equal(iv(0), Infinity); assert.equal(iv(7), 1); assert.equal(iv(8), 0.8);
  assert.equal(iv(13), 0.05, ok('中枢间隔：1 秒 → 每级 ×0.8 → 满级 0.05 秒'));

  // 结算自动购买：默认关（实际游戏），科技树 Lv1 解锁后才自动买
  {
    const runUntilSettle = (e, limit = 80000) => {
      for (let i = 0; i < limit && e.state.ledger.length === 0; i++) e.tick();
      return e.state.ledger[0];
    };
    const idle = new Eng(init());
    idle.s.auto.collapse = true;
    idle.s.auto.guard = true;
    const first = runUntilSettle(idle);
    assert(first && first.spent === 0, ok('未解锁：结算不替玩家花钱'));
    assert(idle.permanent.failure.every((v) => v === 0), ok('未解锁：永久升级保持 0 级'));
    assert(idle.permanent.failureWallet > 0, ok('未解锁：钱留在钱包里'));

    const unlocked = new Eng(init());
    unlocked.s.auto.collapse = true;
    unlocked.s.auto.guard = true;
    unlocked.s.tree.center = 1;
    const second = runUntilSettle(unlocked);
    assert(second && second.spent > 0, ok('中枢 Lv1 解锁后：结算开始自动购买'));
    assert(unlocked.permanent.failure[0] > 0, ok('中枢 Lv1 解锁后：专属永久升级涨级'));

    const manual = new Eng(init());
    manual.permanent.failureWallet = 100;
    assert.equal(manual.buyFailureTech(1), true, ok('科技页可手动购买专属永久升级'));
    assert.equal(manual.permanent.failure[0], 1, ok('手动购买后等级 +1'));
  }
  const nodes = zero.treeNodes();
  assert.equal(nodes.length, TREE_NODE_TOTAL, ok(`科技树节点数 ${nodes.length}`));
  assert.equal(nodes.filter((n) => n.slot === 'trunk').length, 4, ok('四个主干'));
  assert.equal(nodes.filter((n) => n.slot === 'leaf').length, 8, ok('八个叶子'));
  assert.equal(nodes.filter((n) => n.slot === 'char').length, 72, ok('8 角色 × 9 节点'));
  assert(nodes.filter((n) => n.slot === 'leaf').every((n) => n.cost === 0), ok('叶子价格 0'));
  assert(nodes.filter((n) => n.slot === 'char').every((n) => n.canBuy === false), ok('角色节点不可购买'));
}
console.log(`[v8-audit] 通过：${checks} 项检查（其中价格恒等式 ${priceChecks} 组）。`);
