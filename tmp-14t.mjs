const { Engine, createInitialState } = await import('./src/engine.js');
const { makeBot } = await import('./sim/bot.js');
const e = new Engine(createInitialState());
const bot = makeBot('value', { period: 5 });
for (let i = 0; i < Math.floor((3600 * 30) / 2); i++) {
  e.tick(2);
  while (e.s.storyQueue.length) e.finishStory();
  if (e.s.pending) e.resolvePending();
  bot(e, 2);
  if (e.s.won) break;
}
const T = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆'];
const byTier = [[], [], [], []];
for (const r of e.s.stats.runLog) {
  if (r.tier < 0 || r.tier > 3) continue;
  byTier[r.tier].push({ kind: r.kind, t: r.t, p: r.purify });
}
console.log(`[幂1.4+每10级×1.5] 通关=${e.s.won} 总 ${(e.s.stats.playTime / 3600).toFixed(2)}h 轮数=${e.s.stats.cycles}`);
for (let t = 0; t < 4; t++) {
  if (!byTier[t].length) continue;
  const sum = byTier[t].reduce((a, r) => a + r.t, 0);
  console.log(`档${t} ${T[t]}: ${byTier[t].length} 轮 / ${(sum / 60).toFixed(0)} 分`);
  byTier[t].slice(0, 10).forEach((r, i) => console.log(`  第${i + 1}轮 ${r.t}s ${r.kind === 'guard' ? '守护' : ((r.p || 0) * 100).toFixed(2) + '%'}`));
}
