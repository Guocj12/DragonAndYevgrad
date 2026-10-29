// test/v8.e2e.mjs — 浏览器闸门 + 全角色全界面截图
//
//   node server.mjs 8080
//   node test/v8.e2e.mjs [url]
//
// 检查项：
//   ① 控制台 0 报错（pageerror / console.error）
//   ② 八个角色页都能打开，科技树恒为 5 个节点（根 + 四叶）
//   ③ HUD 上显示的净化力/深渊/mtc 与引擎 view() 完全一致（经 num.js 同一套格式化）
//   ④ 截图：每个角色 × 升级页 / 科技树页，外加守护 / 排行榜 / 统计 / 设置
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { formatDisplay, formatInteger, scaled1000 } from '../src/num.js';
import { ITEM_NAMES } from '../src/db.js';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const shotDir = path.join('test', 'screens', 'v8');
fs.mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) problems.push(msg);
};

const CHARS = [
  [1, '249'], [2, 'yewei'], [3, 'baiqi'], [4, 'heng'],
  [5, 'shuangjin'], [6, 'xixi'], [7, 'kongmiao'], [8, 'xyt'],
];
const CHAR_NAME = {
  249: '249', yewei: '耶维奇', baiqi: '白琦', heng: '恒',
  shuangjin: '双禁', xixi: '曦曦', kongmiao: '空喵', xyt: 'XyT',
};

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 15000 });
ok(true, '页面加载完成，__dny 钩子可用');

// 干净起点：清掉上一轮浏览器留下的档，并进入纯数值模式
await page.evaluate(() => {
  localStorage.removeItem('dny-save-v8');
  window.__dny.clearStory();
});

const headerValue = (i) => page.locator('.c-header-res__value').nth(i).innerText();

for (const [stage, id] of CHARS) {
  // 场景：解锁全部项目 + 给一笔 mtc，让 8 张卡与等级都长出来（截图用，不改公式）
  await page.evaluate(([s]) => window.__dny.scene(s, 0, { demo: 16 }), [stage]);
  await page.evaluate(() => window.__dny.clearStory());
  const v = await page.evaluate(() => window.__dny.view());

  ok(v.stage === stage, `第 ${stage} 层场景就绪（${v.stageName}）`);

  await page.locator('.l-tab-bar .o-tab-btn', { hasText: CHAR_NAME[id] }).first().click();
  await page.waitForTimeout(60);

  // HUD == 引擎值（同一套 num.js 格式化）
  const powerText = await headerValue(0);
  const pressureText = await headerValue(1);
  const mtcValue = await headerValue(2);
  ok(powerText === formatDisplay(v.force), `HUD 净化力 == 引擎值（${powerText}）`);
  ok(pressureText === formatDisplay(v.pressureForce), `HUD 深渊 == 引擎值（${pressureText}）`);
  ok(mtcValue === formatInteger(scaled1000(v.wallet)), `HUD mtc == 引擎值（${mtcValue}）`);
  ok(!/NaN|undefined|Infinity/.test(`${powerText}${pressureText}${mtcValue}`), 'HUD 无 NaN/Infinity');

  // 标签数：每个角色 2 个（升级 / 科技），只有 249 多一个科技树
  const subNames = await page.locator('.c-subtab-button-container .o-tab-btn').allInnerTexts();
  const want = id === '249' ? ['升级', '科技', '科技树'] : ['升级', '科技'];
  ok(subNames.join('/') === want.join('/'),
    `${CHAR_NAME[id]} 标签 = ${subNames.join(' / ')}${id === '249' ? '（含科技树）' : ''}`);

  // 升级页：只有本角色 8 项
  await page.locator('.c-subtab-button-container .o-tab-btn', { hasText: '升级' }).first().click();
  await page.waitForTimeout(60);
  const cards = await page.locator('.c-upgrade-card').count();
  ok(cards === 8, `升级页卡片数 ${cards} == 8（本角色 8 项）`);
  const titles = await page.locator('.c-upgrade-card .c-upgrade-card__name').allInnerTexts();
  ok(titles.every((s) => ITEM_NAMES[stage].some((n) => s.startsWith(n))),
    `升级页只显示 ${CHAR_NAME[id]} 的 8 项（${titles.map((s) => s.trim()).join(' / ')}）`);
  await page.screenshot({ path: path.join(shotDir, `stage${stage}-${id}-upgrades.png`), fullPage: true });

  // 科技页：两个（自动购买 + 该角色专属永久升级）
  await page.locator('.c-subtab-button-container .o-tab-btn', { hasText: '科技' }).first().click();
  await page.waitForTimeout(80);
  const techs = await page.locator('.c-upgrade-btn--tech').count();
  ok(techs === 2, `科技页卡片数 ${techs} == 2（自动购买 + 专属永久升级）`);
  await page.screenshot({ path: path.join(shotDir, `stage${stage}-${id}-techs.png`), fullPage: true });

  // 科技树：只有 249 有
  if (id === '249') {
    await page.locator('.c-subtab-button-container .o-tab-btn', { hasText: '科技树' }).first().click();
    await page.waitForTimeout(120);
    const nodes = await page.locator('.c-tree-node').count();
    ok(nodes === 5, `科技树节点数 ${nodes} == 5（根 + 四叶）`);
    const leafNames = await page.locator('.c-tree-node--leaf .c-tree-node__title').allInnerTexts();
    ok(leafNames.join('/') === '记忆·生产/记忆·削减/守护·余响/覆灭·余烬',
      `四叶为四个成功科技（${leafNames.join(' / ')}）`);
    await page.screenshot({ path: path.join(shotDir, 'stage1-249-techtree.png'), fullPage: true });
  }
}

// 通用页：守护 / 排行榜 / 统计 / 设置（在第 8 层截图，机制面板最全）
await page.evaluate(() => window.__dny.scene(8, 900, { demo: 18 }));
await page.waitForTimeout(200);
for (const [tab, file] of [['守护', 'guard'], ['排行榜', 'board'], ['统计', 'stats'], ['设置', 'options']]) {
  await page.locator('.l-tab-bar .o-tab-btn', { hasText: tab }).first().click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shotDir, `common-${file}.png`), fullPage: true });
  ok(true, `截图 ${file}`);
}

// 结算弹窗（覆灭）：自动结算关掉，手动跑到失败，弹窗必须出现
await page.evaluate(() => {
  window.__dny.settleAuto(false);
  window.__dny.scene(1, 0);
});
await page.evaluate(() => {
  const e = window.__dny.engine;
  e.s.auto.collapse = false;
  e.s.auto.guard = false;
  for (let i = 0; i < 40000 && !e.s.pending; i++) e.tick();
});
await page.waitForTimeout(200);
const hasPending = await page.locator('.c-modal--pending').count();
ok(hasPending === 1, '覆灭结算弹窗出现');
await page.screenshot({ path: path.join(shotDir, 'common-pending-collapse.png'), fullPage: true });

// 终局（stage 9）：标题必须是"终局"而不是"第 9 / 8 层"
await page.evaluate(() => window.__dny.scene(9, 0, { demo: 18 }));
await page.waitForTimeout(200);
const tierText = await page.locator('.c-header-tier').innerText();
ok(/终局/.test(tierText) && !/第\s*9/.test(tierText), `终局标题正确（${tierText.replace(/\s+/g, ' ').trim()}）`);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: 'XyT' }).first().click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(shotDir, 'common-endgame.png'), fullPage: true });

// 窄屏（390×844）：机制面板与科技树不能溢出
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__dny.scene(8, 0, { demo: 18 }));
await page.waitForTimeout(200);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: 'XyT' }).first().click();
await page.waitForTimeout(120);
await page.locator('.c-subtab-button-container .o-tab-btn', { hasText: '升级' }).first().click();
await page.waitForTimeout(120);
const overflow = await page.evaluate(() => {
  const doc = document.documentElement;
  return doc.scrollWidth - doc.clientWidth;
});
ok(overflow <= 2, `窄屏无横向溢出（scrollWidth-clientWidth=${overflow}）`);
await page.screenshot({ path: path.join(shotDir, 'mobile-stage8-xyt-upgrades.png'), fullPage: false });
await page.setViewportSize({ width: 1440, height: 960 });

// 控制台干净
ok(consoleErrors.length === 0, `控制台 0 报错${consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''}`);

await browser.close();

const files = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png'));
console.log(`\n截图 ${files.length} 张 → ${shotDir}`);
if (problems.length) {
  console.error(`\n[FAIL] ${problems.length} 项未通过：`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log('[v8.e2e] 全部通过。');
