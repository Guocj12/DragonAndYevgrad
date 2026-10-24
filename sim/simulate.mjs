// sim/simulate.mjs — 全流程模拟：跑一整条时间线，统计每档耗时/轮数
// 用法：node sim/simulate.mjs [strategy] [maxHours] [seed]
import { Engine, createInitialState } from '../src/engine.js';
import { Dec } from '../src/num.js';
import { CHARACTER_ORDER } from '../src/db.js';
import { makeBot } from './bot.js';

export function simulate({ strategy = 'value', maxHours = 24, dt = 0.5, verbose = false, seed = 0 } = {}) {
  const st = createInitialState();
  const eng = new Engine(st);
  const bot = makeBot(strategy);
  const maxTicks = Math.floor((maxHours * 3600) / dt);
  let tierStart = 0;
  const tierTimes = [0, 0, 0, 0];
  const tierRuns = [0, 0, 0, 0];
  let lastTier = 0;
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    const before = eng.s.tier;
    eng.tick(dt);
    if (eng.s.storyQueue.length) { while (eng.s.storyQueue.length) eng.finishStory(); }
    if (eng.s.pending) eng.resolvePending();
    bot(eng, dt);
    if (eng.s.won) { tierTimes[lastTier] += eng.s.stats.playTime - tierStart; break; }   // 通关时补记最后一段
    if (eng.s.tier !== before) {
      const elapsed = eng.s.stats.playTime - tierStart;
      tierTimes[before] += elapsed;       // 无论守护还是覆灭，时长都记在「离开的那一档」上
      if (eng.s.tier > before) tierRuns[before]++;
      tierStart = eng.s.stats.playTime;
      lastTier = eng.s.tier;
      if (verbose) console.log(`tier ${before}→${eng.s.tier} @ ${(eng.s.stats.playTime / 3600).toFixed(2)}h, cycles=${eng.s.stats.cycles}, y=${Dec.log10(eng.s.mtc).toFixed(1)}`);
    }
  }
  const s = eng.s;
  return {
    strategy,
    won: s.won,
    playTime: s.stats.playTime,
    cycles: s.stats.cycles,
    guards: s.stats.guards,
    tierTimes,
    tierRuns,
    tierCollapses: s.stats.tierCollapses.slice(),
    tierGuards: s.stats.tierGuards.slice(),
    ap: s.ap.toString(),
    mp: Dec.log10(s.mp),
    pp: Dec.log10(s.pp),
    mtcLog: Dec.log10(s.mtc),
    prodLog: Dec.log10(eng.bonuses().prodTotal),
    unlocked: s.unlocked.slice(),
    runLog: s.stats.runLog.slice(-40),
  };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.mjs')) {
  const strategy = process.argv[2] || 'value';
  const maxHours = Number(process.argv[3] || 24);
  const dt = Number(process.argv[4] || 0.5);
  const r = simulate({ strategy, maxHours, dt, verbose: true });
  const h = (x) => (x / 3600).toFixed(2) + 'h';
  console.log(JSON.stringify({
    strategy: r.strategy, won: r.won, total: h(r.playTime), cycles: r.cycles,
    tierTimes: r.tierTimes.map((x) => h(x)), tierGuards: r.tierGuards, tierCollapses: r.tierCollapses,
    ap: r.ap, mpLog: r.mp.toFixed(1), ppLog: r.pp.toFixed(1),
  }, null, 1));
}
