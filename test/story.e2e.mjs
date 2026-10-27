// test/story.e2e.mjs — 剧情系统自检（引擎层，不需要浏览器）
//
// `src/story.js` 现在是空表（文本待填），所以这里注入临时条目来验证触发链路，
// 并顺手证明一件最关键的事：**剧情暂停不会改变任何数值** ——
// 注入剧情跑完整程的结果，必须与不注入时逐字段相同（299944 ticks / F[5,6,6,3] / WF 18327…）。
//
// 用法：node test/story.e2e.mjs

import assert from 'node:assert/strict';
import { Engine, createInitialState } from '../src/engine.js';
import { STORY } from '../src/story.js';

// 基准模式：自动购买科技全 22 级 + 自动结算开（否则默认是全手动 + 弹窗，不会自己走完）
function baselineEngine() {
  const e = new Engine(createInitialState());
  for (const id of ['249', 'yewei', 'baiqi', 'heng']) e.s.autoBuyLv[id] = 22;
  e.s.auto.collapse = true;
  e.s.auto.guard = true;
  return e;
}

const problems = [];
const ok = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (!c) problems.push(m); };

// ── 1. 空表时不触发任何剧情 ──
ok(STORY.length === 0, `src/story.js 当前是空表（${STORY.length} 条）`);
{
  const e = baselineEngine();
  for (let i = 0; i < 20000; i++) e.tick();
  ok(e.state.storyQueue.length === 0 && !e.state.storyActive, '空表时不会弹剧情、不会暂停');
}

// ── 2. 注入条目，验证四种触发 + 条件触发 ──
STORY.push(
  { id: 't-restart', trigger: { type: 'restart' }, mode: 'fullscreen', title: '测试', lines: ['a'] },
  { id: 't-collapse', trigger: { type: 'collapse', tier: 0, count: 1 }, mode: 'fullscreen', lines: ['b'] },
  { id: 't-guard', trigger: { type: 'guard', tier: 0, count: 1 }, mode: 'bottom', speaker: '耶维奇', lines: ['c'] },
  { id: 't-cond', trigger: { type: 'cond', when: { at: 'layer', n: 2 } }, mode: 'bottom', lines: ['d'] },
  { id: 't-win', trigger: { type: 'win' }, mode: 'fullscreen', lines: ['e'] },
);

const boom = () => { throw new Error('剧情条目触发了未定义的访问'); };

{
  const e = baselineEngine();
  // 首次覆灭
  while (e.state.stats.collapses === 0) {
    if (e.state.storyQueue.length) {
      const entry = e.nextStory();
      assert.ok(entry && entry.id, 'nextStory 必须返回条目');
      ok(entry.id === 't-restart' || entry.id === 't-collapse', `覆灭链路弹出 ${entry.id}`);
      e.finishStory();
    }
    if (!e.tick()) continue;
  }
  ok(e.state.storySeen.includes('t-collapse'), '覆灭触发命中了 t-collapse（tier 0 / 第 1 次）');
  ok(e.state.storySeen.includes('t-restart'), '重开触发命中了 t-restart');
  ok(e.state.paused === true, '有剧情时自动暂停');

  // 播完恢复
  while (e.state.storyQueue.length) e.finishStory();
  e.state.storyActive = false;
  const t0 = e.state.stats.ticks;
  e.tick();
  ok(e.state.stats.ticks === t0 + 1, '剧情播完后 tick 恢复');

  // 首次守护 + 升到第 2 层后的条件触发
  let guard = 0;
  while (e.state.stats.guards === 0 && guard++ < 4e6) {
    if (e.state.storyQueue.length) e.finishStory();
    e.tick();
  }
  ok(e.state.layer === 2, '第一次守护后进入第 2 层');
  ok(e.state.storySeen.includes('t-guard'), '守护触发命中了 t-guard（tier 0 / 第 1 次）');
  for (let i = 0; i < 400 && !e.state.storySeen.includes('t-cond'); i++) {
    while (e.state.storyQueue.length) e.finishStory();
    e.state.storyActive = false;
    e.tick();
  }
  ok(e.state.storySeen.includes('t-cond'), '条件触发（layer >= 2）命中 t-cond');
}

// ── 3. 剧情暂停不改变数值：带剧情跑完整程 ──
{
  const e = baselineEngine();
  let guard = 0;
  while (!e.state.finished && guard++ < 5e6) {
    while (e.state.storyQueue.length) e.finishStory();
    e.state.storyActive = false;
    e.tick();
  }
  ok(e.state.finished, '带剧情也能跑完');
  ok(e.state.stats.ticks === 299944, `总 tick = 299944（实际 ${e.state.stats.ticks}）`);
  ok(JSON.stringify(e.permanent.failure) === '[5,6,6,3]', `F = ${JSON.stringify(e.permanent.failure)}`);
  ok(JSON.stringify(e.permanent.success) === '[11,4,1,1]', `U = ${JSON.stringify(e.permanent.success)}`);
  ok(e.permanent.failureWallet === 18327 && e.permanent.successWallet === 5670,
    `钱包 ${e.permanent.failureWallet} / ${e.permanent.successWallet}`);
  ok(e.state.storySeen.includes('t-win'), '通关触发命中了 t-win');
}

// 收尾：把注入的条目摘掉，别污染别的测试
STORY.length = 0;

if (problems.length) {
  console.log(`\n有 ${problems.length} 个问题：`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('\n[story] 全部通过（剧情暂停不影响数值）');
