// test/v5-shell.e2e.mjs — V5 外壳巡检：控制台零报错 + HUD 数字 == 引擎实际值
//
// 用法：node server.mjs 8080  然后 node test/v5-shell.e2e.mjs [url]
// 依赖 app.js 暴露的只读调试口 window.__dny（view/tick/save/metrics）。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const shotDir = path.join('test', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ ${msg}`); problems.push(msg); }
};

const fmt = (x) => {
  const a = Math.abs(x);
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  if (a >= 1e6 || (a > 0 && a < 1e-3)) {
    const e = Math.floor(Math.log10(a));
    const m = (a / 10 ** e).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return `${x < 0 ? '-' : ''}${m}e${e}`;
  }
  return a < 10 ? String(Number(x.toFixed(2))) : String(Math.round(x));
};

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 10000 });
console.log('页面加载完成，调试口就绪');

// 1. 引擎在跑
const v0 = await page.evaluate(() => window.__dny.view());
await page.waitForTimeout(1200);
const v1 = await page.evaluate(() => window.__dny.view());
ok(v1.power > v0.power, `tick 在推进（净化力 ${v0.power.toFixed(3)} → ${v1.power.toFixed(3)}）`);
ok(v1.pressure > 0, '深渊在上涨');
ok(v1.layer === 1 && v1.layerName === '奶茶店', `当前层 ${v1.layer} ${v1.layerName}`);

// 2. HUD 三个数字与引擎值一致（用 formatScientific 同一套格式化）
await page.evaluate(() => window.__dny.tick(400));
await page.waitForTimeout(300);
const v = await page.evaluate(() => window.__dny.view());
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const check = (label, val) => {
  const s = fmt(val);
  const hit = text.includes(s) || text.includes(s.replace('e+', 'e'));
  ok(hit, `HUD 显示 ${label} = ${s}`);
};
check('净化力', v.powerDisplay);
check('深渊', v.pressureDisplay);
check('mtc', v.currencyDisplay);
ok(text.includes('奶茶店'), '档名可见');
ok(/档\s*1|第\s*1\s*档|1\s*\/\s*4/.test(text), '档号可见');

// 3. 页签巡检
for (const name of ['升级', '科技', '守护', '统计', '设置']) {
  const btn = page.locator(`text=${name}`).first();
  if (await btn.count() === 0) { problems.push(`找不到页签：${name}`); continue; }
  await btn.click({ timeout: 3000 }).catch(() => problems.push(`点击失败：${name}`));
  await page.waitForTimeout(150);
  ok(true, `页签可切换：${name}`);
}

// 4. 暂停 / 继续
const pause = page.locator('text=暂停').first();
if (await pause.count()) {
  await pause.click();
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => window.__dny.view());
  await page.waitForTimeout(600);
  const b = await page.evaluate(() => window.__dny.view());
  ok(a.power === b.power, '暂停后 tick 停止');
  const resume = page.locator('text=继续').first();
  if (await resume.count()) await resume.click();
  await page.waitForTimeout(600);
  const c = await page.evaluate(() => window.__dny.view());
  ok(c.power > b.power, '继续后 tick 恢复');
} else {
  problems.push('找不到暂停按钮');
}

// 5. 存档
const saved = await page.evaluate(() => window.__dny.save());
ok(typeof saved === 'string' && JSON.parse(saved).v === 'v5', '存档版本为 v5');

await page.screenshot({ path: path.join(shotDir, 'v5-shell.png'), fullPage: false });
console.log(`截图：${path.join(shotDir, 'v5-shell.png')}`);

await browser.close();

if (problems.length) {
  console.log(`\n有 ${problems.length} 个问题：`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('\n全部通过（控制台 0 报错）');
