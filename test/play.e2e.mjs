// test/play.e2e.mjs — 用 Playwright「真的玩一段」（V5 外壳 + 新默认设置）
//
// 覆灭弹窗 → 点结算 → 自动购买科技升级 → 切到基准模式跑出第一次守护 → 存档刷新续玩 → 窄屏
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

// 一直 tick 到条件成立（每块 2000 tick；__dny.tick 只调 engine.tick，不跳时间）
const tickUntil = async (src, label, chunk = 2000, maxLoops = 800) => {
  for (let i = 0; i < maxLoops; i++) {
    const st = await page.evaluate(([s, n]) => {
      window.__dny.tick(n);
      const v = window.__dny.view();
      // eslint-disable-next-line no-new-func
      const pred = new Function('v', `return (${s});`);
      return { done: pred(v), layer: v.layer, runs: v.stats.runs, guards: v.stats.guards, collapses: v.stats.collapses, ticks: v.stats.ticks, pending: !!v.pending };
    }, [src, chunk]);
    if (st.done) { console.log(`  · ${label}：${st.ticks} ticks`); return st; }
  }
  throw new Error(`等不到条件：${label}`);
};

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });

console.log('\n[1] 默认设置：全手动 + 覆灭弹窗');
const st0 = await page.evaluate(() => {
  const v = window.__dny.view();
  return { autoBuyLv: v.autoBuyLv, auto: v.auto };
});
ok(Object.values(st0.autoBuyLv).every((x) => x === 0), `自动购买科技默认全 0 级（${JSON.stringify(st0.autoBuyLv)}）`);
ok(st0.auto.collapse === false && st0.auto.guard === false, '自动覆灭 / 自动守护默认都关');

const p1 = await tickUntil('!!v.pending', '等到覆灭弹窗');
ok(p1.pending === true, '片段结束后进入待结算（弹窗）');
const modalVisible = await page.isVisible('.c-modal--pending').catch(() => false);
ok(modalVisible, '覆灭 / 守护 弹窗可见');
const modalText = await page.textContent('.c-modal--pending').catch(() => '');
ok(/覆灭|守护/.test(modalText), `弹窗标题正确：${(modalText || '').split('\n')[0].slice(0, 20)}`);

// 弹窗期间 tick 必须冻结
const a1 = await page.evaluate(() => window.__dny.view().stats.ticks);
await page.evaluate(() => window.__dny.tick(200));
const a2 = await page.evaluate(() => window.__dny.view().stats.ticks);
ok(a1 === a2, `弹窗期间 tick 冻结（${a1} → ${a2}）`);

await page.screenshot({ path: path.join(shotDir, 'v5-pending-modal.png') });

// 点「覆灭结算」继续
await page.click('[data-action="resolve"]');
await page.waitForTimeout(300);
const afterResolve = await page.evaluate(() => window.__dny.view());
ok(!afterResolve.pending, '点结算后弹窗消失');
ok(afterResolve.layer === 1, '覆灭后回到第 1 层');
const ledger0 = await page.evaluate(() => window.__dny.engine.state.ledger[0]);
ok(ledger0 && ledger0.kind === 'failure', `首轮结算 = 失败（${JSON.stringify(ledger0 && ledger0.kind)}）`);
ok(JSON.stringify(afterResolve.permanent.failure) === '[1,0,0,0]',
  `F = ${JSON.stringify(afterResolve.permanent.failure)}`);

console.log('\n[2] 自动购买科技：升级 + 效果切换');
await page.evaluate(() => { window.__dny.engine.permanent.failureWallet = 100; });   // 只给 MP，测试用
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '科技');
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const beforeLv = await page.evaluate(() => window.__dny.view().autoBuyLv['249']);
const clicked = await page.locator('.c-upgrade-btn--tech .c-buy-btn').first().click({ timeout: 3000 })
  .then(() => true).catch(() => false);
await page.waitForTimeout(250);
const afterLv = await page.evaluate(() => window.__dny.view().autoBuyLv['249']);
const mpLeft = await page.evaluate(() => window.__dny.view().wallets.mp);
ok(clicked, '点到了自动购买科技的升级按钮');
ok(afterLv === beforeLv + 1, `等级 ${beforeLv} → ${afterLv}`);
ok(mpLeft === 100 - 2, `MP 扣了 2（剩 ${mpLeft}）`);
const techText = await page.textContent('.l-upgrade-grid').catch(() => '');
ok(/第 1 个升级/.test(techText), '1 级效果文案：每 1 秒买第 1 个升级');

console.log('\n[3] 切到基准模式，跑出第一次守护');
await page.evaluate(() => {
  const e = window.__dny.engine;
  for (const id of ['249', 'yewei', 'baiqi', 'heng']) e.s.autoBuyLv[id] = 22;   // 满级 = 20Hz 购买最大数量
  e.s.auto.collapse = true;
  e.s.auto.guard = true;
});
const g1 = await tickUntil('v.stats.guards >= 1', '第一次守护', 4000);
ok(g1.layer === 2, `守护后进入第 2 层（实际 ${g1.layer}）`);
const v2 = await page.evaluate(() => window.__dny.view());
ok(v2.layerName === '耶维城', `档名 = ${v2.layerName}`);
ok(JSON.stringify(v2.permanent.success) === '[1,0,0,0]', `U = ${JSON.stringify(v2.permanent.success)}`);
const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
ok(body.includes('耶维奇'), '耶维奇页签出现');
ok(!body.includes('恒'), '第 2 层还没解锁恒');
await page.screenshot({ path: path.join(shotDir, 'v5-after-guard.png') });

console.log('\n[4] 存档 → 刷新续玩');
const before = await page.evaluate(() => {
  window.__dny.save();
  const v = window.__dny.view();
  return { ticks: v.stats.ticks, layer: v.layer, F: v.permanent.failure, lv: v.autoBuyLv };
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });
const after = await page.evaluate(() => {
  const v = window.__dny.view();
  return { ticks: v.stats.ticks, layer: v.layer, F: v.permanent.failure, lv: v.autoBuyLv };
});
ok(after.layer === before.layer, `刷新后仍在第 ${after.layer} 层`);
ok(JSON.stringify(after.F) === JSON.stringify(before.F), '永久状态未丢');
ok(JSON.stringify(after.lv) === JSON.stringify(before.lv), '自动购买科技等级未丢');

console.log('\n[5] 窄屏');
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
