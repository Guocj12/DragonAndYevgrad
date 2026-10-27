// test/v5-campaign.e2e.mjs — 端到端验收：在真浏览器里把整程跑完，结果必须等于
// docs/数值设计.md §10.1 的基准（22 轮 / F[5,6,6,3] / U[11,4,1,1] / WF 18327 / WS 5670 / 14997.2s）。
//
// 走的是 `window.__dny.tick(n)`，即页面主循环用的同一个 engine.tick()，
// 不跳时间、不改数值。用法：node server.mjs 8080  然后 node test/v5-campaign.e2e.mjs [url]

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const problems = [];
const consoleErrors = [];
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.log(`  ✗ ${msg}`); problems.push(msg); } };

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });

// 「基准模式」：自动购买科技全 22 级 + 自动结算开（页面上就是把这几个开关拨到位，
// 与玩家手动点等价，不跳时间、不改数值）
await page.evaluate(() => {
  const e = window.__dny.engine;
  for (const id of ['249', 'yewei', 'baiqi', 'heng']) e.s.autoBuyLv[id] = 22;
  e.s.auto.collapse = true;
  e.s.auto.guard = true;
});

// 记录每次片段结束（通过 runIndex / layer / collapses 变化观察），顺便累计 tick
const marks = [];
let lastKey = '';
let totalTicks = 0;
let guard = 0;
const CHUNK = 2000;
while (guard++ < 2000) {
  const st = await page.evaluate((n) => {
    window.__dny.tick(n);
    const v = window.__dny.view();
    return {
      finished: v.finished, layer: v.layer, runIndex: v.runIndex,
      collapses: v.stats.collapses, guards: v.stats.guards, ticks: v.stats.ticks,
      F: v.permanent.failure, U: v.permanent.success,
      WF: v.wallets.mp, WS: v.wallets.pp, layerTime: v.layerTime,
    };
  }, CHUNK);
  totalTicks = st.ticks;
  const key = `${st.layer}|${st.runIndex}|${st.collapses}|${st.guards}`;
  if (key !== lastKey) { marks.push({ ...st, tickAt: st.ticks }); lastKey = key; }
  if (st.finished) break;
}

const final = await page.evaluate(() => window.__dny.view());

console.log(`  跑完 ${totalTicks} ticks = ${(totalTicks * 0.05).toFixed(1)}s`);

// 1. 基准硬指标（数值设计 §10.1）
ok(final.finished === true, '第四层成功，游戏完成');
ok(final.stats.runs === 22, `轮数 = 22（实际 ${final.stats.runs}）`);
ok(JSON.stringify(final.stats.failures) === '[6,5,6,4]', `每层失败次数 = [6,5,6,4]（实际 ${JSON.stringify(final.stats.failures)}）`);
ok(JSON.stringify(final.permanent.failure) === '[5,6,6,3]', `F = [5,6,6,3]（实际 ${JSON.stringify(final.permanent.failure)}）`);
ok(JSON.stringify(final.permanent.success) === '[11,4,1,1]', `U = [11,4,1,1]（实际 ${JSON.stringify(final.permanent.success)}）`);
ok(final.wallets.mp === 18327, `失败余额 = 18327（实际 ${final.wallets.mp}）`);
ok(final.wallets.pp === 5670, `成功余额 = 5670（实际 ${final.wallets.pp}）`);
ok(Math.abs(totalTicks * 0.05 - 14997.2) < 1e-9, `累计游戏时间 = 14997.2s（实际 ${(totalTicks * 0.05).toFixed(4)}）`);
ok(totalTicks === 299944, `总 tick 数 = 299944（实际 ${totalTicks}）`);

// 2. 首轮覆灭时刻（§10.2：722.85s）
//    用引擎账本里的片段时长（账本是逐事件记录的，不受采样粒度影响）
const ledger = await page.evaluate(() => window.__dny.engine.state.ledger.slice(0, 3));
ok(ledger.length > 0, '账本记录了结算事件');
if (ledger.length) {
  ok(Math.abs(ledger[0].time - 722.85) < 1e-9, `首轮覆灭于 ${ledger[0].time}s（基准 722.85s）`);
  ok(ledger[0].kind === 'failure' && ledger[0].layer === 1, '首轮结算类型 = 第 1 层失败');
}

// 3. 通关后不再推进
const t1 = await page.evaluate(() => { window.__dny.tick(100); return window.__dny.view().stats.ticks; });
const t2 = await page.evaluate(() => { window.__dny.tick(100); return window.__dny.view().stats.ticks; });
ok(t1 === t2, '通关后 tick 不再推进');

// 4. 控制台
ok(consoleErrors.length === 0, `控制台/页面 0 报错（${consoleErrors.length}）`);
for (const e of consoleErrors) console.log('    ' + e);

// 与参考模拟器交叉核对一遍（同进程，不经浏览器）
const { campaign } = await import('../src/v5.js');
const ref = campaign();
const refTicks = ref.runs.reduce((a, r) => a + r.segments.reduce((b, s) => b + s.ticks, 0), 0);
ok(refTicks === totalTicks, `浏览器里的 tick 数与参考模拟器一致（${refTicks}）`);
ok(JSON.stringify(ref.permanent) === JSON.stringify(final.permanent), '永久状态与参考模拟器一致');

await page.screenshot({ path: 'test/screens/v5-finished.png' });
await browser.close();

if (problems.length) {
  console.log(`\n有 ${problems.length} 个问题：`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('\n[v5-campaign] 端到端与 数值设计.md §10.1 完全一致');
