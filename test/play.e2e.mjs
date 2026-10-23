// test/play.e2e.mjs — 用 Playwright「真的玩一段」：
// 剧情 → 点升级 → 暂停/继续 → 守护结算 → 覆灭结算 → 保存刷新续玩 → 窄屏
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const shotDir = path.join('test', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (!c) problems.push(m); };

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : { channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.l-tab-bar');

console.log('\n[1] 开场剧情 + 点 30 次升级');
for (let i = 0; i < 24; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(150);
}
// 条件剧情会随时插入暂停；本脚本测的是操作流，先关掉（ui.e2e 的 [10] 单独测它）
await page.evaluate(() => { window.__dny.engine().storyConditions = false; });
const clicks = await page.evaluate(async () => {
  let n = 0;
  for (let i = 0; i < 30; i++) {
    const btn = [...document.querySelectorAll('.l-upgrade-grid .c-upgrade-btn')].find((b) => !b.disabled);
    if (btn) { btn.click(); n++; }
    await new Promise((r) => setTimeout(r, 200));
  }
  return n;
});
ok(clicks > 0, `点到 ${clicks} 次升级`);
const s1 = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { lv: e.s.chars['249'].upgrades[0], prod: e.bonuses().prodTotal.log10(), t: e.s.t };
});
ok(s1.lv > 0 && s1.prod > 0, `进度：Lv${s1.lv}，产量 log=${s1.prod.toFixed(1)}`);
await page.screenshot({ path: path.join(shotDir, '40-play-early.png') });

console.log('\n[2] 暂停 → 继续');
await page.click('.c-pause-btn');
await page.waitForTimeout(120);
const p1 = await page.evaluate(() => window.__dny.engine().s.t);
await page.waitForTimeout(500);
const p2 = await page.evaluate(() => window.__dny.engine().s.t);
ok(p1 === p2, '暂停时时间冻结');
await page.click('.c-pause-btn');
await page.waitForTimeout(300);
const p3 = await page.evaluate(() => window.__dny.engine().s.t);
ok(p3 > p2, '继续后时间恢复');

console.log('\n[3] 守护结算（点「净化」）');
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('0');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(300);
for (let i = 0; i < 10; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(150);
}
ok(await page.isVisible('.c-pending-box'), '出现净化结算框');
await page.click('[data-action="resolve"]');
await page.waitForTimeout(400);
for (let i = 0; i < 30; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(120);
}
const g = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { tier: e.s.tier, mp: e.s.mp.toNumber(), paused: e.s.paused, pending: e.s.pending };
});
ok(g.tier === 1, `进入档 ${g.tier}`);
ok(g.mp > 0 && Number.isInteger(g.mp), `获得整数 MP（${g.mp}）`);
ok(!g.paused && !g.pending, '结算后自动继续');
await page.screenshot({ path: path.join(shotDir, '41-play-after-guard.png') });

console.log('\n[4] 覆灭结算（升级清空）');
await page.evaluate(() => window.__dny.give({ mtc: '1e8' }));
await page.evaluate(() => { window.__dny.engine().buyUpgrade('249', 0, 6); });
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('1e999999');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(300);
for (let i = 0; i < 10; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(140);
}
await page.click('[data-action="resolve"]');
await page.waitForTimeout(400);
for (let i = 0; i < 30; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(120);
}
const c = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { tier: e.s.tier, ups: e.s.chars['249'].upgrades.slice(), cycles: e.s.stats.cycles, paused: e.s.paused };
});
ok(c.tier === 0, '回到档 0');
ok(c.ups.every((x) => x === 0), '升级全部清空');
ok(!c.paused, '覆灭结算后自动继续');

console.log('\n[5] 存档刷新续玩');
await page.evaluate(() => window.__dny.act('save'));
const before = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { cycles: e.s.stats.cycles, tier: e.s.tier };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.l-tab-bar');
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { cycles: e.s.stats.cycles, tier: e.s.tier };
});
ok(after.cycles === before.cycles, `刷新后覆灭数保持（${before.cycles} → ${after.cycles}）`);
ok(after.tier === before.tier, `刷新后档位保持（${before.tier} → ${after.tier}）`);

console.log('\n[6] 窄屏');
await page.setViewportSize({ width: 420, height: 820 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 2, `无横向溢出（${overflow}px）`);
await page.screenshot({ path: path.join(shotDir, '42-play-mobile.png') });

await browser.close();
console.log('\n================ 结果 ================');
if (problems.length) {
  console.log(`❌ ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exitCode = 1;
} else {
  console.log('✅ 模拟游玩通过：剧情/升级/暂停/净化/覆灭/续玩/窄屏都正常');
}
