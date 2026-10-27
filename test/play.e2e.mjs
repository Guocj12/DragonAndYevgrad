// test/play.e2e.mjs — 用 Playwright「真的玩一段」（V5 外壳）
//
// 覆灭 → 守护 → 解锁耶维奇 → 存档刷新续玩 → 窄屏。数值全部由 20Hz 自动结算跑，
// 这里只验证外壳在这条路径上不出错、计数与引擎一致。
//
// 用法：node server.mjs 8080  然后 node test/play.e2e.mjs [url]

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const shotDir = path.join('test', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const problems = [];
const consoleErrors = [];
const ok = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (!c) problems.push(m); };

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : { channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`); });

const tickUntil = async (predicateSrc, label, maxChunk = 4000, maxLoops = 400) => {
  for (let i = 0; i < maxLoops; i++) {
    const st = await page.evaluate(([src, n]) => {
      window.__dny.tick(n);
      const v = window.__dny.view();
      // eslint-disable-next-line no-new-func
      const pred = new Function('v', `return (${src});`);
      return { done: pred(v), layer: v.layer, runs: v.stats.runs, guards: v.stats.guards, collapses: v.stats.collapses, ticks: v.stats.ticks };
    }, [predicateSrc, maxChunk]);
    if (st.done) { console.log(`  · ${label}：${st.ticks} ticks`); return st; }
  }
  throw new Error(`等不到条件：${label}`);
};

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });
console.log('\n[1] 首轮覆灭');
const c1 = await tickUntil('v.stats.collapses >= 1', '第一次覆灭');
ok(c1.collapses === 1 && c1.layer === 1, '覆灭后回到第 1 层');
const ledger0 = await page.evaluate(() => window.__dny.engine.state.ledger[0]);
ok(Math.abs(ledger0.time - 722.85) < 1e-9, `首轮时长 ${ledger0.time}s（基准 722.85s）`);
ok(ledger0.kind === 'failure' && ledger0.layer === 1, '首轮结算 = 第 1 层失败');
const f1 = await page.evaluate(() => window.__dny.view().permanent.failure);
ok(JSON.stringify(f1) === '[1,0,0,0]', `F = ${JSON.stringify(f1)}`);
await page.screenshot({ path: path.join(shotDir, 'v5-after-collapse.png') });

console.log('\n[2] 第一次守护（第 7 轮）');
const g1 = await tickUntil('v.stats.guards >= 1', '第一次守护');
ok(g1.layer === 2, `守护后进入第 2 层（实际 ${g1.layer}）`);
const v2 = await page.evaluate(() => window.__dny.view());
ok(v2.layerName === '耶维城', `档名 = ${v2.layerName}`);
ok(JSON.stringify(v2.permanent.success) === '[1,0,0,0]', `U = ${JSON.stringify(v2.permanent.success)}`);
const tabs = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
ok(tabs.includes('耶维奇'), '耶维奇页签出现');
ok(!tabs.includes('恒'), '第 2 层还没解锁恒');
await page.screenshot({ path: path.join(shotDir, 'v5-after-guard.png') });

console.log('\n[3] 存档 → 刷新续玩');
const before = await page.evaluate(() => {
  window.__dny.save();
  return { ticks: window.__dny.view().stats.ticks, layer: window.__dny.view().layer, F: window.__dny.view().permanent.failure };
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });
const after = await page.evaluate(() => ({ ticks: window.__dny.view().stats.ticks, layer: window.__dny.view().layer, F: window.__dny.view().permanent.failure }));
ok(after.layer === before.layer, `刷新后仍在第 ${after.layer} 层`);
ok(Math.abs(after.ticks - before.ticks) <= 40, `刷新后续跑 tick 未倒退（${before.ticks} → ${after.ticks}）`);
ok(JSON.stringify(after.F) === JSON.stringify(before.F), '永久状态未丢');

console.log('\n[4] 窄屏');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 2, `窄屏无横向溢出（溢出 ${overflow}px）`);
await page.screenshot({ path: path.join(shotDir, 'v5-mobile.png'), fullPage: false });

ok(consoleErrors.length === 0, `控制台 0 报错（${consoleErrors.length}）`);
for (const e of consoleErrors) console.log('    ' + e);

await browser.close();
if (problems.length) {
  console.log(`\n有 ${problems.length} 个问题：`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('\n[play] 全部通过');
