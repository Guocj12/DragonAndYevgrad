import { simulate } from './sim/simulate.mjs';
const T = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆'];
for (const st of ['value', 'cheapest', 'preset']) {
  const r = simulate({ strategy: st, maxHours: 60, dt: 0.5 });
  const t = r.tierTimes.map((x) => x / 3600);
  const runs = r.tierGuards.map((g, i) => g + r.tierCollapses[i]);
  console.log(`[${st}] 总 ${(r.playTime / 3600).toFixed(2)}h 通关=${r.won} 轮数=${r.cycles}`);
  T.forEach((n, i) => console.log(`  ${n}: ${t[i].toFixed(2)}h / ${runs[i]} 轮 / 每轮 ${runs[i] ? ((t[i] * 3600) / runs[i]).toFixed(0) : 0}s`));
}
