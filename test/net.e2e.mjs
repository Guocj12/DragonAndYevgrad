// test/net.e2e.mjs — 服务器存档 / 用户名 / 排行榜 端到端
// 用法：node test/net.e2e.mjs    （需要 node server.mjs 8080 在跑）
import { chromium } from 'playwright';

const BASE = process.env.DNY_URL || 'http://127.0.0.1:8080';
const problems = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) problems.push(msg);
};

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'chromium',
  headless: true,
});

// 全新上下文 = 全新 cookie = 全新玩家
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

console.log('\n[1] 服务器下发身份与自动用户名');
const me1 = await (await ctx.request.get(`${BASE}/api/me`)).json();
ok(!!me1.name && me1.name.length >= 2, `自动生成用户名：${me1.name}`);
ok(me1.hasSave === false, '新玩家还没有服务器存档');

console.log('\n[2] 同步存档 + 上报成绩');
// 跳过开场剧情
for (let i = 0; i < 8; i++) { if (await page.isVisible('.l-story').catch(() => false)) { await page.click('.l-story'); await page.waitForTimeout(100); } }
await page.evaluate(() => { window.__dny.clearStory(); window.__dny.tick(4000); });
await page.waitForTimeout(200);
await page.evaluate(() => window.__dny.sync(true));
await page.waitForTimeout(900);

const saved = await (await ctx.request.get(`${BASE}/api/save`)).json();
ok(!!saved.save && saved.save.length > 100, `存档已上传（${(saved.save || '').length} 字节，rev=${saved.rev}）`);

const board1 = await (await ctx.request.get(`${BASE}/api/board?limit=50`)).json();
const mine = board1.rows.find((r) => r.name === me1.name);
ok(!!mine, `排行榜出现自己：${me1.name}`);
ok(mine && typeof mine.purified === 'number', `排行榜记录净化深渊总量：${mine && mine.purified.toFixed(1)}`);

console.log('\n[3] 玩家之间互不干扰');
const ctx2 = await browser.newContext();
const other = await (await ctx2.request.get(`${BASE}/api/me`)).json();
ok(other.name !== me1.name, `第二个玩家拿到不同用户名：${other.name}`);
const otherSave = await ctx2.request.get(`${BASE}/api/save`);
ok(otherSave.status() === 404, '第二个玩家看不到别人的存档（404）');

console.log('\n[4] 设置页改名');
await page.click('.l-tab-bar .o-tab-btn:has-text("设置")');
await page.waitForTimeout(300);
const nameInput = page.locator('#name-input');
ok(await nameInput.count() === 1, '设置页有用户名输入框');
const newName = `奶茶测试-${Date.now() % 100000}`;
await nameInput.fill(newName);
await page.click('.l-options-row >> text=改名');
await page.waitForTimeout(700);
const me2 = await (await ctx.request.get(`${BASE}/api/me`)).json();
ok(me2.name === newName, `改名成功：${me2.name}`);

const dup = await ctx.request.post(`${BASE}/api/name`, { data: { name: other.name } });
ok(dup.status() === 409, `重名被拒绝（${dup.status()}）`);

console.log('\n[5] 排行榜页面');
await page.click('.l-tab-bar .o-tab-btn:has-text("排行榜")');
await page.waitForTimeout(700);
const rows = await page.locator('.c-board-table tbody tr').count();
ok(rows >= 1, `排行榜表格渲染 ${rows} 行`);
const myRow = await page.locator('.c-board-me').count();
ok(myRow === 1, '自己的那一行高亮');
const text = await page.textContent('.c-board-table');
ok(text.includes(newName), '排行榜显示改后的用户名');

console.log('\n[6] 刷新页面：从服务器恢复存档');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const restored = await page.evaluate(() => String(window.__dny.engine.state.seg ? window.__dny.engine.state.seg.wallet : 0));
ok(restored !== '0e0', `刷新后从服务器读回进度（mtc=${restored}）`);

await page.screenshot({ path: 'test/screens/95-leaderboard.png' });
await browser.close();

console.log('\n================ 结果 ================');
if (problems.length) {
  console.log(`❌ ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exitCode = 1;
} else {
  console.log('✅ 存档独立 / 排行榜 / 改名 全部通过');
}
