// sim/probe.mjs — 单次轨迹探针：打印一条时间线的关键数值
// 用法：node sim/probe.mjs [strategy] [maxSeconds]
import { Engine, createInitialState, tierCapLog, tierStartLog } from '../src/engine.js';
import { Dec } from '../src/num.js';
import { CHARACTERS, CHARACTER_ORDER, TUNING } from '../src/db.js';
import { makeBot } from './bot.js';

const strategy = process.argv[2] || 'value';
const maxSeconds = Number(process.argv[3] || 600);

const st = createInitialState();
const eng = new Engine(st);
const bot = makeBot(strategy);

let lastPrint = 0;
let runs = 0;
const t0 = Date.now();
let guard = 0;
while (eng.s.t < maxSeconds && guard++ < 200000) {
  const ev = eng.tick(TUNING.tickSeconds);
  bot(eng, TUNING.tickSeconds);
  if (ev) {
    runs++;
    const s = eng.s;
    console.log(`[${ev}] run#${runs} t=${s.t.toFixed(1)}s tier=${s.tier} mtc=e${Dec.log10(s.mtc).toFixed(1)} mp=e${Dec.log10(s.mp).toFixed(2)} pp=e${Dec.log10(s.pp).toFixed(2)} ap=${s.ap.toString()} pp_gained`);
    lastPrint = 0;
  }
  if (eng.s.won) { console.log('*** 通关 ***'); break; }
  if (eng.s.stats.playTime - lastPrint > 5) {
    lastPrint = eng.s.stats.playTime;
    const b = eng.bonuses();
    const s = eng.s;
    console.log(
      `t=${s.t.toFixed(1).padStart(6)} tier=${s.tier} S=e${Dec.log10(s.S).toFixed(1)} ` +
      `mtc=e${Dec.log10(s.mtc).toFixed(1)} prod=e${Dec.log10(b.prodTotal).toFixed(1)} ` +
      `eta=e${Dec.log10(b.eta).toFixed(1)} pur=e${Dec.log10(b.purifyTea).toFixed(1)} ` +
      `dmg=e${Dec.log10(b.dmgTotal).toFixed(1)} lv=${CHARACTER_ORDER.map((id) => s.unlocked.includes(id) ? s.chars[id].upgrades.reduce((a, v) => a + v, 0) : '-').join('/')}`,
    );
  }
}
console.log('elapsed', (Date.now() - t0) / 1000, 's; runs =', runs);
