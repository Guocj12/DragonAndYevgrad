// test/ui.e2e.mjs — Playwright 功能巡检（真浏览器）
// 覆盖：剧情播放、暂停、升级解锁链、整数资源、净化/覆灭结算、科技树（vis-network 缩放/拖动/购买）、
//       数据页、设置页弹窗、多角色页、窄屏
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const shotDir = path.join('test', 'screens');
fs.mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); problems.push(msg); }
};
// 把当前所有剧情点数完（跨条目）
const flushStory = async (max = 40) => {
  for (let i = 0; i < max; i++) {
    if (!(await page.isVisible('.l-story').catch(() => false))) break;
    await page.click('.l-story');
    await page.waitForTimeout(120);
  }
};
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : { channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
const http404 = [];
page.on('response', (r) => { if (r.status() >= 400) http404.push(`${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.l-tab-bar', { timeout: 10000 });

// ── 1. 开场剧情（5 段全屏 + 249 教学 5 段）──
console.log('\n[1] 开场剧情');
ok(await page.isVisible('.l-story--full'), '开场是全屏剧情层');
ok(await page.evaluate(() => window.__dny.engine().s.paused), '播放剧情时游戏暂停');
const t0 = await page.evaluate(() => window.__dny.engine().s.t);
await page.waitForTimeout(400);
ok((await page.evaluate(() => window.__dny.engine().s.t)) === t0, `暂停期间 tick 不推进（t=${t0.toFixed(2)}）`);
await flushStory();
ok(!(await page.isVisible('.l-story')), '点完最后一段后剧情层消失');
await page.waitForTimeout(500);
const t1 = await page.evaluate(() => window.__dny.engine().s.t);
ok(t1 > t0, `播完后自动继续（t ${t0.toFixed(1)} → ${t1.toFixed(1)}）`);
await page.screenshot({ path: path.join(shotDir, '30-intro-after.png') });

// 条件型剧情随时插入暂停会破坏后续断言的时序，先关掉；末尾 [10] 单独测它
await page.evaluate(() => { window.__dny.engine().storyConditions = false; });

const initialLocked = await page.$$eval('.c-upgrade-btn--locked', (els) => els.length);

// ── 2. 头部与暂停 ──
console.log('\n[2] 头部、深渊条、暂停');
const headerText = await page.textContent('.l-game-header');
ok(['奶茶币', '记忆点数', '净化点数', '觉醒点'].every((k) => headerText.includes(k)), '头部四资源齐全（中文名）');
ok(/你现在在\s*奶茶店/.test(headerText), '头部显示所在地「你现在在奶茶店」');
await page.click('.c-pause-btn');
await page.waitForTimeout(120);
ok(await page.evaluate(() => window.__dny.engine().s.paused), '点暂停后进入暂停');
const p1 = await page.evaluate(() => window.__dny.engine().s.t);
await page.waitForTimeout(700);
const p2 = await page.evaluate(() => window.__dny.engine().s.t);
ok(p1 === p2, `暂停期间 tick 不推进（t=${p1.toFixed(2)}）`);
await page.evaluate(() => window.__dny.give({ mtc: '1e6' }));
const beforeBuy = await page.evaluate(() => window.__dny.engine().s.chars['249'].upgrades[0]);
await page.click('.l-upgrade-grid .c-upgrade-btn');
await page.waitForTimeout(150);
const afterBuy = await page.evaluate(() => window.__dny.engine().s.chars['249'].upgrades[0]);
ok(afterBuy > beforeBuy, `暂停时仍能购买（Lv ${beforeBuy} → ${afterBuy}）`);
await page.click('.c-pause-btn');
await page.waitForTimeout(150);

// ── 3. 升级解锁链（Lv30 才开第二个）──
console.log('\n[3] 升级解锁链');
ok(initialLocked === 7, `初始只有第 1 个升级可用（锁定 ${initialLocked} 个）`);
await page.evaluate(() => window.__dny.give({ mtc: '1e14' }));
let unlocked2 = false;
for (let i = 0; i < 6 && !unlocked2; i++) {
  const btn = page.locator('.l-upgrade-grid .c-upgrade-btn:not(.c-upgrade-btn--disabled)').first();
  if (!(await btn.count())) break;
  await btn.click();
  await page.waitForTimeout(150);
  unlocked2 = await page.evaluate(() => window.__dny.engine().upgradeUnlocked('249', 1));
}
const u1 = await page.evaluate(() => window.__dny.engine().s.chars['249'].upgrades[0]);
ok(u1 >= 10, `灌装线买到 Lv${u1}（满级 10）`);
ok(unlocked2, '灌装线买满 10 级后「配方改良」解锁');
const previewText = await page.textContent('.l-upgrade-grid .c-upgrade-btn');
ok(/当前 .*(→ 下一级|已满级)/.test(previewText), `卡片显示「当前 → 下一级/已满级」：${previewText.replace(/\s+/g, ' ').slice(0, 60)}`);
await page.screenshot({ path: path.join(shotDir, '31-upgrade-locks.png') });

// ── 4. 科技页 ──
console.log('\n[4] 科技页（MP 整数）');
await page.click('.c-subtab-button-container .o-tab-btn--secondary:has-text("科技")');
await page.waitForTimeout(200);
const techCards = await page.$$('.l-upgrade-grid .c-upgrade-btn');
ok(techCards.length === 4, `科技卡 4 张（实际 ${techCards.length}）`);
await page.evaluate(() => window.__dny.give({ mp: '25' }));
await page.waitForTimeout(150);
await page.click('.l-upgrade-grid .c-upgrade-btn');
await page.waitForTimeout(200);
const mpNow = await page.evaluate(() => window.__dny.engine().s.mp.toNumber());
ok(Number.isInteger(mpNow), `MP 是整数（${mpNow}）`);

// ── 5. 科技树（vis-network）──
console.log('\n[5] 科技树：缩放 / 拖动 / 点击购买');
await page.click('.c-subtab-button-container .o-tab-btn--secondary:has-text("科技树")');
await page.waitForTimeout(700);
const treeInfo = await page.evaluate(() => {
  const t = window.__dny.tree();
  return t && t.network ? { nodes: t.nodes.length, edges: t.edges.length, scale: t.network.getScale() } : null;
});
ok(!!treeInfo, '科技树网络已创建');
ok(treeInfo && treeInfo.nodes >= 21 && treeInfo.edges >= 18, `节点 ${treeInfo?.nodes}、连线 ${treeInfo?.edges}`);
const hostBox = await page.$eval('.c-tree-host', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(hostBox.x, hostBox.y);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(350);
const scale2 = await page.evaluate(() => window.__dny.tree().network.getScale());
ok(Math.abs(scale2 - treeInfo.scale) > 0.01, `滚轮缩放生效（${treeInfo.scale.toFixed(2)} → ${scale2.toFixed(2)}）`);
const v1 = await page.evaluate(() => window.__dny.tree().network.getViewPosition());
await page.mouse.move(hostBox.x, hostBox.y);
await page.mouse.down();
await page.mouse.move(hostBox.x + 140, hostBox.y + 90, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
const v2 = await page.evaluate(() => window.__dny.tree().network.getViewPosition());
ok(Math.abs(v1.x - v2.x) + Math.abs(v1.y - v2.y) > 5, '拖动平移生效');
await page.evaluate(() => window.__dny.give({ pp: '5000' }));
await page.waitForTimeout(300);
await page.locator('.c-tree-host').scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const clickNode = async (id) => {
  const pt = await page.evaluate((nodeId) => {
    const tv = window.__dny.tree();
    const p = tv.network.getPositions()[nodeId];
    const c = tv.network.canvasToDOM(p);
    const r = document.querySelector('.c-tree-host').getBoundingClientRect();
    return { x: r.x + c.x, y: r.y + c.y };
  }, id);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(350);
};
// 叶子 g12 的前置是主干 g10，没买 g10 时应该买不到
await clickNode('g12');
const g12Blocked = await page.evaluate(() => window.__dny.engine().s.generic['g12'] || 0);
ok(g12Blocked === 0, '未买前置主干时，叶子节点买不了');
await clickNode('g7');   // 中心
await clickNode('g8');   // 东北主干（父 = 中心）
await clickNode('g1');   // 北叶子（父 = 东北主干）
const [g7, g8, g1] = await page.evaluate(() => [
  window.__dny.engine().s.generic['g7'] || 0,
  window.__dny.engine().s.generic['g8'] || 0,
  window.__dny.engine().s.generic['g1'] || 0,
]);
ok(g7 > 0 && g8 > 0, `中心 → 主干 可购买（g7 Lv${g7}，g8 Lv${g8}）`);
ok(g1 > 0, `主干买过之后叶子可买（产量共鸣 Lv${g1}）`);
const ppNow = await page.evaluate(() => window.__dny.engine().s.pp.toNumber());
ok(Number.isInteger(ppNow), `PP 是整数（${ppNow}）`);
await page.screenshot({ path: path.join(shotDir, '32-tree-network.png') });

// 切走再切回来，树必须重新出现（之前的空白 bug）
await page.click('.l-tab-bar .o-tab-btn:has-text("数据")');
await page.waitForTimeout(300);
await page.click('.l-tab-bar .o-tab-btn:has-text("249")');
await page.waitForTimeout(300);
await page.click('.c-subtab-button-container .o-tab-btn--secondary:has-text("科技树")');
await page.waitForTimeout(700);
const treeRebuilt = await page.evaluate(() => {
  const tv = window.__dny.tree();
  const host = document.querySelector('.c-tree-host');
  const canvas = host && host.querySelector('canvas');
  return !!(tv && tv.network && canvas && canvas.width > 0 && host.children.length > 0);
});
ok(treeRebuilt, '切走再切回后科技树正常重绘（无空白）');

// ── 6. 守护 → 剧情 → 净化按钮 ──
console.log('\n[6] 守护：自动暂停 + 剧情 + 净化按钮');
await page.evaluate(() => {
  const e = window.__dny.engine();
  const D = e.s.S.constructor;
  e.s.S = D.from('0');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__dny.engine().s.pending === 'guard'), '进入「待净化」状态');
ok(await page.isVisible('.l-story'), '首次守护先播剧情');
ok(await page.isVisible('.l-story--full'), '净化播报是全屏');
await flushStory();   // 净化播报 + 耶维奇登场
ok(await page.isVisible('.c-pending-box'), '剧情播完后出现「净化」结算框');
await page.screenshot({ path: path.join(shotDir, '33-guard-pending.png') });
const mpBefore = await page.evaluate(() => window.__dny.engine().s.mp.toNumber());
await page.click('[data-action="resolve"]');
await page.waitForTimeout(400);
await flushStory();   // 首次净化：全屏播报 + 耶维奇登场
const afterGuard = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { tier: e.s.tier, mp: e.s.mp.toNumber(), pp: e.s.pp.toNumber(), pending: e.s.pending, paused: e.s.paused };
});
ok(afterGuard.tier === 1, `点净化后进入档 ${afterGuard.tier}`);
ok(afterGuard.mp > mpBefore, `守护给了 MP（${mpBefore} → ${afterGuard.mp}）`);
ok(Number.isInteger(afterGuard.mp) && Number.isInteger(afterGuard.pp), 'MP / PP 仍为整数');
ok(!afterGuard.pending && !afterGuard.paused, '结算后自动继续');

// ── 7. 覆灭：升级清空、科技与科技树保留 ──
console.log('\n[7] 覆灭结算');
await page.evaluate(() => window.__dny.give({ mtc: '1e9' }));
await page.waitForTimeout(150);
await page.evaluate(() => { const e = window.__dny.engine(); e.buyUpgrade('249', 0, 5); });
const techBefore = await page.evaluate(() => window.__dny.engine().s.chars['249'].techs[0]);
const genBefore = await page.evaluate(() => window.__dny.engine().s.generic['g1']);
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('1e999999');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(300);
for (let i = 0; i < 8; i++) {
  if (!(await page.isVisible('.l-story').catch(() => false))) break;
  await page.click('.l-story');
  await page.waitForTimeout(160);
}
await flushStory();   // 自动覆灭后可能补播未读的重开剧情
// 自动化中枢第 1 级 = 自动覆灭：不再弹结算框，直接结算
const autoCollapsed = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { tier: e.s.tier, pending: e.s.pending, lv: e.s.generic.g7 || 0 };
});
ok(autoCollapsed.lv >= 1 && autoCollapsed.pending === null && autoCollapsed.tier === 0,
  `自动化中枢 Lv${autoCollapsed.lv}：深渊满自动覆灭（不弹框）`);
await page.waitForTimeout(300);
const afterCollapse = await page.evaluate(() => {
  const e = window.__dny.engine();
  return { tier: e.s.tier, upgrades: e.s.chars['249'].upgrades.slice(), tech0: e.s.chars['249'].techs[0], g1: e.s.generic['g1'] };
});
ok(afterCollapse.tier === 0, '覆灭回到档 0');
ok(afterCollapse.upgrades[0] <= 1 && afterCollapse.upgrades.slice(1).every((x) => x === 0), `覆灭清空所有升级（${afterCollapse.upgrades.join(',')}；自动采购会立刻补第 1 项）`);
ok(afterCollapse.tech0 >= techBefore, `科技保留（Lv${techBefore} → Lv${afterCollapse.tech0}，g7 自动购买会继续涨）`);
ok(afterCollapse.g1 === genBefore, `通用树保留（g1 Lv${afterCollapse.g1}）`);

// ── 8. 数据页 / 设置页 / 多角色 ──
console.log('\n[8] 数据页、设置页、多角色页');
await page.click('.l-tab-bar .o-tab-btn:has-text("数据")');
await page.waitForTimeout(300);
ok((await page.$$('.c-stats-table')).length === 3, '贡献表 3 张');
await page.click('.l-tab-bar .o-tab-btn:has-text("设置")');
await page.waitForTimeout(200);
await page.click('text=导出存档');
await page.waitForTimeout(250);
ok(await page.isVisible('.c-modal'), '导出弹窗');
const b64 = await page.inputValue('#modal-textarea');
await page.click('[data-action="close"]');
await page.click('text=导入存档');
await page.fill('#modal-textarea', b64);
await page.click('[data-action="import"]');
await page.waitForTimeout(300);
ok(!(await page.isVisible('.c-modal')), '导入后弹窗关闭');
await page.evaluate(() => { window.__dny.unlock('yewei'); window.__dny.unlock('baiqi'); window.__dny.unlock('heng'); });
await page.waitForTimeout(300);
for (const name of ['耶维奇', '白琦', '恒']) {
  await page.click(`.l-tab-bar .o-tab-btn:has-text("${name}")`);
  await page.waitForTimeout(180);
  await page.click('.c-subtab-button-container .o-tab-btn--secondary:has-text("升级")');
  await page.waitForTimeout(150);
  const n = await page.$$eval('.l-upgrade-grid .c-upgrade-btn', (els) => els.length);
  ok(n === 8, `${name} 升级卡 8 张（实际 ${n}）`);
}
await page.screenshot({ path: path.join(shotDir, '35-characters.png') });

// ── 9. 窄屏 ──
await page.setViewportSize({ width: 420, height: 820 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 2, `窄屏无横向溢出（${overflow}px）`);
await page.screenshot({ path: path.join(shotDir, '36-mobile.png') });

// ── 10. 剧情播放器（注入临时剧情，验证两种模式 / 说话人 / 暂停）──
console.log('\n[10] 剧情播放器：全屏 / 底部 / 说话人');
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => window.__dny.playStory({
  id: '__test_full', mode: 'fullscreen', title: '测试章节', lines: ['第一段。', '第二段。'],
}));
await page.waitForTimeout(300);
ok(await page.isVisible('.l-story--full'), '全屏剧情层可渲染');
ok(await page.evaluate(() => window.__dny.engine().s.paused), '播放剧情时游戏暂停');
await page.click('.l-story');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shotDir, '97-story-full.png') });
await page.click('.l-story');
await page.waitForTimeout(300);
ok(!(await page.isVisible('.l-story')), '点完最后一段后剧情层消失');

await page.evaluate(() => window.__dny.playStory({
  id: '__test_bottom', mode: 'bottom', speaker: '249', lines: ['底部剧情。'],
}));
await page.waitForTimeout(300);
ok(await page.isVisible('.l-story--bottom'), '底部剧情层可渲染');
const speakerText = (await page.textContent('.c-story-speaker').catch(() => '')).trim();
ok(speakerText === '249', `底部剧情显示说话人（${speakerText}）`);
await page.screenshot({ path: path.join(shotDir, '37-story-speaker.png') });
await page.click('.l-story');
await page.waitForTimeout(250);
ok(!(await page.isVisible('.l-story')), '底部剧情点完消失');

await browser.close();

console.log(`\n控制台问题：${problems.length}；HTTP≥400：${http404.length}`);
if (http404.length) http404.slice(0, 6).forEach((x) => console.log('  - ' + x));
console.log('\n================ 结果 ================');
const all = problems.concat(http404);
if (all.length) {
  console.log(`❌ ${all.length} 个问题：`);
  all.forEach((p) => console.log('  - ' + p));
  process.exitCode = 1;
} else {
  console.log('✅ 全部检查通过（剧情/暂停/解锁链/整数资源/净化覆灭/科技树/各页签均正常，控制台 0 报错）');
}
