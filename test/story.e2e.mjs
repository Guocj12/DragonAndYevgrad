// test/story.e2e.mjs — 剧情链路巡检（真浏览器）
// 覆盖：开场 → 249 教学 → 首次覆灭 → 重开（含第一次覆灭的追加）→ 首次净化 + 耶维奇登场
//       → 播放时暂停 / 播完自动继续 → 设置里的「跳过已读文本」
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

const isStory = () => page.isVisible('.l-story').catch(() => false);
const storyText = async () => (await page.textContent('.c-story-text').catch(() => '')).trim();
const speakerText = async () => {
  const el = await page.$('.c-story-speaker');
  return el ? (await el.textContent()).trim() : '';
};
async function step() {
  if (!(await isStory())) return false;
  await page.click('.l-story');
  await page.waitForTimeout(140);
  return true;
}
async function flush(max = 40) {
  for (let i = 0; i < max; i++) { if (!(await step())) break; }
}
const tickT = () => page.evaluate(() => window.__dny.engine().s.t);
const paused = () => page.evaluate(() => window.__dny.engine().s.paused);
const pending = () => page.evaluate(() => window.__dny.engine().s.pending);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.l-tab-bar');

// ── 1. 开场（全屏，5 段）──
console.log('\n[1] 开场剧情');
ok(await page.isVisible('.l-story--full'), '开场是全屏剧情层');
ok((await storyText()) === '你在耶维城经营着一家奶茶店', `第 1 段：${await storyText()}`);
await page.screenshot({ path: path.join(shotDir, '70-story-intro.png') });

ok(await paused(), '播放时游戏暂停');
const t0 = await tickT();
await page.waitForTimeout(700);
const t1 = await tickT();
ok(t0 === t1, `暂停期间 tick 不推进（t=${t0.toFixed(2)}）`);

await step();
const line2 = await storyText();
ok(line2.includes('深渊会污染人的神智') && line2.split('\n').length >= 2, `第 2 段是段内两行：${line2.replace(/\n/g, ' / ')}`);
for (let i = 0; i < 3; i++) await step();
ok((await storyText()) === '尽可能多的生产奶茶，守住耶维城', `第 5 段：${await storyText()}`);

// ── 2. 249 登场（底部，前两段旁白）──
console.log('\n[2] 249 的登场与教学');
await step();
ok((await page.isVisible('.l-story--bottom')) === true, '切到下方 1/3 的对话层');
ok((await speakerText()) === '', '第一段是旁白，不显示说话人');
ok((await storyText()) === '249是奶茶店的人工智能', `旁白：${await storyText()}`);
await step();
ok((await storyText()) === '她可以全自动生产奶茶', `旁白：${await storyText()}`);
await step();
ok((await speakerText()) === '249', `显示说话人：${await speakerText()}`);
const line3 = await storyText();
ok(line3.includes('店长您回来了') && line3.split('\n').length === 2, `段内两行：${line3.replace(/\n/g, ' / ')}`);
await page.screenshot({ path: path.join(shotDir, '71-story-249.png') });
await step(); await step();
ok((await storyText()) === '要尽快提高奶茶产量来净化深渊了', `教学段：${await storyText()}`);
await step();
ok((await storyText()) === '卖奶茶可以获得奶茶币', `新教学 1：${await storyText()}`);
await step(); await step();
ok((await storyText()) === '可以靠这个来赚取更多奶茶币，生产更多奶茶~', `新教学 3：${await storyText()}`);
await step();
ok(!(await isStory()), '点完最后一段后剧情层消失');
ok(!(await paused()), '播完后自动继续');
const t2 = await tickT();
await page.waitForTimeout(600);
ok((await tickT()) > t2, '继续后时间恢复推进');

// ── 3. 首次覆灭（每次一行全屏）──
console.log('\n[3] 覆灭');
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('1e999999');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(300);
ok((await pending()) === 'collapse', '进入「待覆灭」状态');
ok(await isStory(), '覆灭触发了剧情');
ok((await storyText()) === '深渊吞噬了耶维城', `覆灭文本：${await storyText()}`);
await page.screenshot({ path: path.join(shotDir, '72-story-collapse.png') });
await step();
ok(!(await isStory()), '覆灭剧情点完消失');
ok(await page.isVisible('.c-pending-box'), '出现「覆灭结算」框');

// ── 4. 重开：开场 + 249 + 第一次覆灭的追加 ──
console.log('\n[4] 覆灭后重开');
await page.click('[data-action="resolve"]');
await page.waitForTimeout(400);
ok(await page.isVisible('.l-story--full'), '重开时重新播开场');
ok((await storyText()) === '你在耶维城经营着一家奶茶店', `重开第 1 段：${await storyText()}`);
const beforeFlush = await page.evaluate(() => window.__dny.engine().s.storyQueue.slice());
ok(beforeFlush.length >= 2, `重开队列：${beforeFlush.join(' → ')}`);
// 点掉开场 5 段 + 249 教学 5 段，进入追加
for (let i = 0; i < 9; i++) await step();   // 5 段开场 + 4 段重播版 249
ok((await speakerText()) === '249', '追加对话由 249 说');
ok((await storyText()) === '这里还有...记忆点数', `追加第 1 句：${await storyText()}`);
await page.screenshot({ path: path.join(shotDir, '73-story-first-restart.png') });
for (let i = 0; i < 4; i++) await step();
ok((await storyText()) === '不管了，还是先继续生产奶茶要紧', `追加最后一句：${await storyText()}`);
await step();
ok(!(await isStory()), '追加对话播完');
ok(!(await paused()), '重开剧情播完后自动继续');

// ── 5. 首次净化（全屏播报 + 耶维奇登场）──
console.log('\n[5] 首次净化');
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('0');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(300);
ok((await pending()) === 'guard', '进入「待净化」状态');
ok(await page.isVisible('.l-story--full'), '净化播报是全屏');
ok((await storyText()) === '经过你和249的努力，城内的深渊被完全清除了', `第 1 段：${await storyText()}`);
await step();
ok((await storyText()).includes('你结识了城内经营万事屋的店主 耶维奇'), '第 2 段提到耶维奇');
for (let i = 0; i < 2; i++) await step();
ok((await storyText()) === '若不及时解决，深渊仍旧会反扑', `第 4 段：${await storyText()}`);
await step();
ok(await page.isVisible('.l-story--bottom'), '切到耶维奇对话');
ok((await speakerText()) === '耶维奇', `说话人：${await speakerText()}`);
ok((await storyText()) === '哟，还开着呢', `耶维奇第 1 句：${await storyText()}`);
await page.screenshot({ path: path.join(shotDir, '74-story-yewei.png') });
for (let i = 0; i < 2; i++) await step();
const yw3 = await storyText();
ok(yw3.includes('处理城外的深渊也算在万事屋的业务范围内嘛') && yw3.split('\n').length === 2, `段内两行：${yw3.replace(/\n/g, ' / ')}`);
await step();
ok((await storyText()).includes('等安宁了再和你算~'), `最后一句：${await storyText()}`);
await step();
ok(!(await isStory()), '耶维奇对话播完');
ok(await page.isVisible('.c-pending-box'), '出现「净化」结算框');
await page.click('[data-action="resolve"]');
await page.waitForTimeout(400);
ok((await page.evaluate(() => window.__dny.engine().s.tier)) === 1, '净化后进入档 1');

// ── 6. 跳过已读文本 ──
console.log('\n[6] 设置：跳过已读文本');
await page.click('.l-tab-bar .o-tab-btn:has-text("设置")');
await page.waitForTimeout(250);
const btnText = (await page.textContent('text=跳过已读文本')).trim();
ok(btnText.includes('关'), `默认关闭（${btnText}）`);
await page.click('text=跳过已读文本');
await page.waitForTimeout(250);
ok((await page.textContent('text=跳过已读文本')).includes('开'), '点一下变为开启');
ok(await page.evaluate(() => window.__dny.engine().s.settings.skipReadStories === true), '设置写进存档状态');

// 制造一次覆灭：已读的 collapse 剧情应该被跳过，直接出结算框
await page.click('.l-tab-bar .o-tab-btn:has-text("249")');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('1e999999');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(400);
ok(!(await isStory()), '已读的覆灭剧情被跳过（不弹剧情层）');
ok(await page.isVisible('.c-pending-box'), '直接出现「覆灭结算」框');

// 关掉开关，再覆灭一次：剧情应该重新出现
await page.evaluate(() => window.__dny.act('resolve'));
await page.waitForTimeout(300);
await flush();   // 重开剧情（已读、开关已关 → 会播）
await page.click('.l-tab-bar .o-tab-btn:has-text("设置")');
await page.waitForTimeout(200);
await page.click('text=跳过已读文本');
await page.waitForTimeout(200);
ok((await page.textContent('text=跳过已读文本')).includes('关'), '再点一下关闭');
await page.click('.l-tab-bar .o-tab-btn:has-text("249")');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const e = window.__dny.engine();
  e.s.S = e.s.S.constructor.from('1e999999');
  e.tick(0.5);
  window.__dny.render();
});
await page.waitForTimeout(350);
ok(await isStory(), '关闭开关后，已读剧情重新播放');
ok((await storyText()) === '深渊吞噬了耶维城', `剧情文本：${await storyText()}`);
await flush();
ok(!(await isStory()), '清空剧情队列');

// ── 7. 覆灭文本按次数递进（10 / 20 / 30 / 40 次后各换一次）──
console.log('\n[7] 覆灭文本递进');
const collapseCases = [
  [9, '深渊吞噬了耶维城'],
  [10, '深渊又吞噬了耶维城'],
  [20, '深渊又一次吞噬了耶维城'],
  [30, '深渊再次吞噬了耶维城'],
  [40, '深渊吞噬了耶维城...'],
];
for (const [n, expect] of collapseCases) {
  await page.evaluate((cnt) => {
    const e = window.__dny.engine();
    e.s.pending = null;
    e.s.storyQueue.length = 0;
    e.s.storyActive = false;
    e.s.paused = false;
    e.s.stats.collapses = cnt;
    e.s.S = e.s.S.constructor.from('1e999999');
    e.tick(0.5);
    window.__dny.render();
  }, n);
  await page.waitForTimeout(320);
  ok(await isStory(), `覆灭第 ${n + 1} 次触发剧情`);
  ok((await storyText()) === expect, `已覆灭 ${n} 次 → ${await storyText()}`);
  await flush();
}
ok(!(await isStory()), '点完消失');

await browser.close();
console.log(`\n控制台问题：${problems.length}`);
console.log('\n================ 结果 ================');
if (problems.length) {
  console.log(`❌ ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exitCode = 1;
} else {
  console.log('✅ 剧情链路全部通过：开场 / 249 / 覆灭 / 重开追加 / 首次净化 / 跳过已读 / 暂停与自动继续');
}
