// test/v8.e2e.mjs — 浏览器闸门 + 全角色全界面截图
//
//   node server.mjs 8080
//   node test/v8.e2e.mjs [url]
//
// 检查项：
//   ① 控制台 0 报错（pageerror / console.error）
//   ② 八层页签都能打开；每角色「升级 / 科技」，只有 249 多一个「科技树」
//   ③ 升级页只显示该角色 8 项；科技页两张卡（自动购买 + 专属永久升级）
//   ④ 科技树：85 节点（1 中枢 + 4 主干 + 8 叶子 + 8×9 角色节点），主干是四项成功科技
//   ⑤ mtc 口径 ×10（249 第一个升级 = 22 奶茶币）
//   ⑥ 截图：每角色 × 升级 / 科技，249 科技树（含初始与八角色全解锁），外加通用页
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { formatDisplay, formatInteger, scaledMtc } from '../src/num.js';
import { ITEM_NAMES } from '../src/db.js';
import { TREE_NODE_TOTAL } from '../src/tree.js';

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

await page.evaluate(() => {
  localStorage.removeItem('dny-save-v8');
  window.__dny.clearStory();
});

const headerValue = (i) => page.locator('.c-header-res__value').nth(i).innerText();
const clickSub = async (name) => {
  await page.locator('.c-subtab-button-container .o-tab-btn', { hasText: name }).first().click();
  await page.waitForTimeout(80);
};

// ── 初始状态：249 第一个升级的价格必须是 22 奶茶币（2.2 × 10 四舍五入）──
await page.evaluate(() => window.__dny.scene(1, 0));
await page.waitForTimeout(150);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: '249' }).first().click();
await page.waitForTimeout(100);
await clickSub('升级');
const firstPrice = (await page.locator('.c-buy-btn__price').first().innerText()).trim();
ok(firstPrice === '22 奶茶币', `249 第一个升级价格 = ${firstPrice}（期望 22 奶茶币）`);
await page.screenshot({ path: path.join(shotDir, 'common-initial-249-upgrades.png'), fullPage: true });

for (const [stage, id] of CHARS) {
  await page.evaluate(([s]) => window.__dny.scene(s, 0, { demo: 16 }), [stage]);
  await page.evaluate(() => window.__dny.clearStory());
  const v = await page.evaluate(() => window.__dny.view());
  ok(v.stage === stage, `第 ${stage} 层场景就绪（${v.stageName}）`);

  await page.locator('.l-tab-bar .o-tab-btn', { hasText: CHAR_NAME[id] }).first().click();
  await page.waitForTimeout(80);

  const powerText = await headerValue(0);
  const pressureText = await headerValue(1);
  const mtcValue = await headerValue(2);
  ok(powerText === formatDisplay(v.force), `HUD 净化力 == 引擎值（${powerText}）`);
  ok(pressureText === formatDisplay(v.pressureForce), `HUD 深渊 == 引擎值（${pressureText}）`);
  ok(mtcValue === formatInteger(scaledMtc(v.wallet)), `HUD mtc == 引擎值（${mtcValue}）`);
  ok(!/NaN|undefined|Infinity/.test(`${powerText}${pressureText}${mtcValue}`), 'HUD 无 NaN/Infinity');

  const subNames = await page.locator('.c-subtab-button-container .o-tab-btn').allInnerTexts();
  const want = id === '249' ? ['升级', '科技', '科技树'] : ['升级', '科技'];
  ok(subNames.join('/') === want.join('/'),
    `${CHAR_NAME[id]} 标签 = ${subNames.join(' / ')}${id === '249' ? '（含科技树）' : ''}`);

  await clickSub('升级');
  const cards = await page.locator('.c-upgrade-card').count();
  ok(cards === 8, `升级页卡片数 ${cards} == 8（本角色 8 项）`);
  const titles = await page.locator('.c-upgrade-card .c-upgrade-card__name').allInnerTexts();
  ok(titles.every((s) => ITEM_NAMES[stage].some((n) => s.startsWith(n))),
    `升级页只显示 ${CHAR_NAME[id]} 的 8 项`);
  await page.screenshot({ path: path.join(shotDir, `stage${stage}-${id}-upgrades.png`), fullPage: true });

  await clickSub('科技');
  const techs = await page.locator('.c-upgrade-btn--tech').count();
  ok(techs === 2, `科技页卡片数 ${techs} == 2（自动购买 + 专属永久升级）`);
  await page.screenshot({ path: path.join(shotDir, `stage${stage}-${id}-techs.png`), fullPage: true });
}

// ── 实际游戏口径（headless=false）：科技页给手动按钮，未解锁时提示去科技树 ──
{
  await page.evaluate(() => {
    window.__dny.scene(1, 0);
    window.__dny.engine.headless = false;
    window.__dny.engine.permanent.failureWallet = 100;
    window.__dny.view();
  });
  await page.waitForTimeout(150);
  await page.locator('.l-tab-bar .o-tab-btn', { hasText: '249' }).first().click();
  await page.waitForTimeout(100);
  await clickSub('科技');
  const manualBtn = page.locator('.c-upgrade-btn--tech button', { hasText: '手动升级' });
  ok(await manualBtn.count() === 1, '科技页有「手动升级」按钮（专属永久升级可手动买）');
  const notes = await page.locator('.c-upgrade-btn__preview').allInnerTexts();
  ok(notes.some((s) => s.includes('科技树')), `未解锁时提示去科技树（${notes.join(' | ').slice(0, 60)}…）`);
  const before = await page.evaluate(() => window.__dny.engine.permanent.failure[0]);
  await manualBtn.click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__dny.engine.permanent.failure[0]);
  ok(after === before + 1, `点「手动升级」后专属永久升级 ${before} → ${after}`);
  await page.screenshot({ path: path.join(shotDir, 'common-tech-manual-buy.png'), fullPage: true });
}

// ── 科技树：八角色全解锁后的整棵树 ──
await page.evaluate(() => window.__dny.scene(8, 0, { demo: 16 }));
await page.waitForTimeout(150);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: '249' }).first().click();
await page.waitForTimeout(80);
await clickSub('科技树');
await page.waitForSelector('.c-tree-host canvas', { timeout: 8000 });
await page.waitForTimeout(700);

const tree = await page.evaluate(() => window.__dny.view().tree);
ok(tree.length === TREE_NODE_TOTAL, `科技树节点数 ${tree.length} == ${TREE_NODE_TOTAL}（1 中枢 + 4 主干 + 8 叶 + 8×9 角色）`);
const trunks = tree.filter((n) => n.slot === 'trunk').map((n) => n.name);
ok(trunks.join('/') === '净化效率/伤害效率/记忆点数倍率/守护点数倍率', `四个主干 = ${trunks.join(' / ')}`);
const charNodes = tree.filter((n) => n.slot === 'char');
ok(charNodes.length === 72, `角色节点 ${charNodes.length} == 72（8 角色 × 9）`);
ok(charNodes.every((n) => n.canBuy === false), '角色节点全部不可购买');
ok(tree.filter((n) => n.slot === 'leaf').every((n) => n.cost === 0), '八个叶子价格都是 0');
const canvas = await page.locator('.c-tree-host canvas').count();
ok(canvas >= 1, `vis-network 画布已渲染（${canvas} 个 canvas）`);
await page.screenshot({ path: path.join(shotDir, 'common-techtree-8chars.png'), fullPage: true });

// 交付图：2 倍像素的元素级截图（整棵树，文字清晰）
const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1150 }, deviceScaleFactor: 2 });
const page2 = await ctx2.newPage();
await page2.goto(URL, { waitUntil: 'load' });
await page2.waitForFunction(() => window.__dny && window.__dny.view, null, { timeout: 15000 });
await page2.evaluate(() => {
  localStorage.removeItem('dny-save-v8');
  window.__dny.scene(8, 0, { demo: 16 });
  window.__dny.clearStory();
});
await page2.waitForTimeout(200);
await page2.locator('.l-tab-bar .o-tab-btn', { hasText: '249' }).first().click();
await page2.waitForTimeout(100);
await page2.locator('.c-subtab-button-container .o-tab-btn', { hasText: '科技树' }).first().click();
await page2.waitForSelector('.c-tree-host canvas', { timeout: 8000 });
await page2.waitForTimeout(900);
await page2.evaluate(() => {
  const bar = document.querySelector('.l-status-bar');
  if (bar) bar.style.display = 'none';
});
await page2.waitForTimeout(120);
await page2.locator('.c-tree-host').screenshot({ path: path.join(shotDir, 'common-techtree-8chars-2x.png') });
await ctx2.close();
ok(true, '截图 科技树（2× 元素级）');

// 回归：树 ↔ 升级 往返不得残留画布、不得把页面撑高（Vue 复用 ref 节点导致的老 bug）
{
  const heights = [];
  for (let i = 0; i < 3; i++) {
    await clickSub('科技树');
    await page.waitForTimeout(650);
    await clickSub('升级');
    await page.waitForTimeout(650);
    const snap = await page.evaluate(() => ({
      vis: document.querySelectorAll('.vis-network').length,
      host: document.querySelectorAll('.c-tree-host').length,
      cards: document.querySelectorAll('.c-upgrade-card').length,
      bodyH: document.body.scrollHeight,
    }));
    heights.push(snap.bodyH);
    ok(snap.vis === 0 && snap.host === 0, `第 ${i + 1} 次往返后无 vis 残留（vis=${snap.vis}, host=${snap.host}）`);
    ok(snap.cards === 8, `第 ${i + 1} 次往返后升级卡片 ${snap.cards} == 8`);
  }
  ok(Math.max(...heights) - Math.min(...heights) <= 80,
    `往返后页面高度稳定（${heights.join(' / ')}）`);
  await page.screenshot({ path: path.join(shotDir, 'common-back-to-upgrades.png'), fullPage: true });
}

// 给足 PP 后中枢应当可购买
await page.evaluate(() => {
  window.__dny.engine.permanent.successWallet = 500;
  window.__dny.view();
  window.__dny.tick(1);
});
const tree2 = await page.evaluate(() => window.__dny.view().tree);
ok(tree2.find((n) => n.slot === 'center').canBuy === true, 'PP 充足时中枢可购买');

// ── 通用页 ──
await page.evaluate(() => window.__dny.scene(8, 900, { demo: 18 }));
await page.waitForTimeout(200);
for (const [tab, file] of [['守护', 'guard'], ['排行榜', 'board'], ['统计', 'stats'], ['设置', 'options']]) {
  await page.locator('.l-tab-bar .o-tab-btn', { hasText: tab }).first().click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shotDir, `common-${file}.png`), fullPage: true });
  ok(true, `截图 ${file}`);
}

// ── 结算弹窗 ──
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
await page.waitForTimeout(250);
const hasPending = await page.locator('.c-modal--pending').count();
ok(hasPending === 1, '覆灭结算弹窗出现');
await page.screenshot({ path: path.join(shotDir, 'common-pending-collapse.png'), fullPage: true });

// ── 终局标题 ──
await page.evaluate(() => window.__dny.scene(9, 0, { demo: 18 }));
await page.waitForTimeout(200);
const tierText = await page.locator('.c-header-tier').innerText();
ok(/终局/.test(tierText) && !/第\s*9/.test(tierText), `终局标题正确（${tierText.replace(/\s+/g, ' ').trim()}）`);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: 'XyT' }).first().click();
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(shotDir, 'common-endgame.png'), fullPage: true });

// ── 窄屏 ──
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__dny.scene(8, 0, { demo: 18 }));
await page.waitForTimeout(200);
await page.locator('.l-tab-bar .o-tab-btn', { hasText: 'XyT' }).first().click();
await page.waitForTimeout(120);
await clickSub('升级');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 2, `窄屏无横向溢出（scrollWidth-clientWidth=${overflow}）`);
await page.screenshot({ path: path.join(shotDir, 'mobile-stage8-xyt-upgrades.png'), fullPage: false });
await page.setViewportSize({ width: 1440, height: 960 });

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
