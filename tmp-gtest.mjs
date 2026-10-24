process.env.DNY_ML = '5';
const { simulate } = await import('./sim/simulate.mjs');
const T = ['奶茶店', '耶维城', '飞龙国', '奶茶大陆'];
const r = simulate({ strategy: 'value', maxHours: 80, dt: 0.5 });
const tiers = r.tierTimes.map((x) => x / 3600);
const runs = r.tierGuards.map((g, i) => g + r.tierCollapses[i]);
console.log(`总 ${(r.playTime / 3600).toFixed(2)}h 通关=${r.won} 轮数=${r.cycles}`);
T.forEach((n, i) => console.log(`  ${n}: ${tiers[i].toFixed(2)}h / ${runs[i]} 轮`));
