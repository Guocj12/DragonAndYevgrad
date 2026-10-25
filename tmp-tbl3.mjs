const { Engine, createInitialState } = await import('./src/engine.js');
const { makeBot } = await import('./sim/bot.js');
const e = new Engine(createInitialState());
const bot = makeBot('value', { period: 2 });
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
  byTier[r.tier].push({ t: r.t, p: r.purify, kind: r.kind });
}
console.log(`通关=${e.s.won} 总 ${(e.s.stats.playTime / 3600).toFixed(2)}h 轮数=${e.s.stats.cycles}\n`);
for (let t = 0; t < 4; t++) {
  const r = byTier[t];
  if (!r.length) { console.log(`档${t} ${T[t]}: 未到达`); continue; }
  const sum = r.reduce((a, x) => a + x.t, 0);
  const g = r.filter((x) => x.kind === 'guard').length;
  console.log(`档${t} ${T[t]}: ${r.length} 轮 / ${(sum / 60).toFixed(1)} 分钟 / 守护 ${g}`);
  console.log(`   ${r.map((x) => x.kind === 'guard' ? '清空' : (x.p * 100).toFixed(1) + '%').join(' → ')}`);
}
