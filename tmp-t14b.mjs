const { TUNING } = await import('./src/db.js');
TUNING.memoryBase = 1.15;
TUNING.collapseProgress = 0.15;
const { Engine, createInitialState, tierCapLog } = await import('./src/engine.js');
const { Dec } = await import('./src/num.js');
const { makeBot } = await import('./sim/bot.js');
const e = new Engine(createInitialState());
const bot = makeBot('value', { period: 0.5 });
const T = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆', '五', '六', '七', '八'];
let lastCycles = 0, lastTime = 0, maxP = 0, curTier = 0;
const perTier = Array.from({ length: 8 }, () => ({ runs: 0, time: 0, pts: [] }));
const MAX_H = 20;
for (let i = 0; i < Math.floor((3600 * MAX_H) / 0.5); i++) {
  e.tick(0.5);
  while (e.s.storyQueue.length) e.finishStory();
  if (e.s.pending) e.resolvePending();
  bot(e, 0.5);
  const p = 1 - Dec.log10(e.s.S) / tierCapLog(e.s.tier);
  if (isFinite(p)) maxP = Math.max(maxP, p);
  if (e.s.stats.cycles !== lastCycles) {
    const now = e.s.stats.playTime;
    perTier[curTier].runs += 1; perTier[curTier].time += now - lastTime; perTier[curTier].pts.push(maxP);
    lastTime = now; lastCycles = e.s.stats.cycles; maxP = 0;
    curTier = e.s.stats.maxTier;
  }
  if (e.s.won) { console.log('通关 @', (e.s.stats.playTime / 3600).toFixed(2) + 'h'); break; }
}
if (!e.s.won) console.log(`未通关（${MAX_H}h 上限），已到档 ${e.s.tier}`);
console.log('档 | 地名 | 轮数 | 时长 | 净化序列');
for (let i = 0; i < 8; i++) {
  const r = perTier[i];
  if (!r.runs) continue;
  const first = r.pts.slice(0, 8).map((x) => (x * 100).toFixed(0) + '%').join(' → ');
  console.log(`${i} | ${T[i]} | ${r.runs} | ${(r.time / 3600).toFixed(2)}h | ${first}`);
}
