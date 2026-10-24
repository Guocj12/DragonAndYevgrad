const { TUNING } = await import('./src/db.js');
TUNING.memoryBase = 1.15;
TUNING.collapseProgress = 0.15;
const { simulate } = await import('./sim/simulate.mjs');
const T = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆', '五', '六', '七', '八'];
const r = simulate({ strategy: 'value', maxHours: 20, dt: 2 });
console.log(`通关=${r.won} 总 ${(r.playTime / 3600).toFixed(2)}h 轮数=${r.cycles}`);
for (let i = 0; i < 8; i++) {
  if (!r.tierTimes[i]) continue;
  console.log(`档${i} ${T[i]}: ${r.tierRuns[i]} 轮 | ${(r.tierTimes[i] / 3600).toFixed(2)}h`);
}
