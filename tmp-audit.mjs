const { Engine, createInitialState, tierCapLog } = await import("./src/engine.js");
const { Dec } = await import("./src/num.js");
const { makeBot } = await import("./sim/bot.js");
const TUNING = (await import("./src/db.js")).TUNING;
const e = new Engine(createInitialState());
const bot = makeBot("value", { period: 0.5 });
const lg = (x) => (x > 0 ? Dec.log10(x) : -Infinity);
let startLog = lg(e.s.S), startTier = 0, lastT = 0;
const rows = [];
const orig = e.resolvePending.bind(e);
e.resolvePending = (auto) => {
  const kind = e.s.pending;
  const endLog = lg(e.s.S);
  const tier = e.s.tier;
  const b = e.bonuses();
  rows.push({ tier, kind: kind || "-", auto: !!auto, dur: +(e.s.stats.playTime - lastT).toFixed(0),
    sStart: +startLog.toFixed(1), sEnd: +endLog.toFixed(1), orders: +(startLog - endLog).toFixed(1),
    prod: +Dec.log10(b.prodTotal).toFixed(1),
    dmgLog: +Dec.log10(b.purifyTea.add(b.dmgTotal)).toFixed(1),
    cap: +tierCapLog(tier).toFixed(0) });
  const out = orig(auto);
  lastT = e.s.stats.playTime; startLog = lg(e.s.S); startTier = e.s.tier;
  return out;
};
const MAXH = Number(process.env.H || 8);
for (let i = 0; i < (3600 * MAXH) / 0.5; i++) {
  e.tick(0.5);
  while (e.s.storyQueue.length) e.finishStory();
  if (e.s.pending) e.resolvePending();
  bot(e, 0.5);
  if (e.s.won) break;
}
console.log("tier kind     auto dur_s  Sstart    Send    orders  prodLog  dmgLog  capLog");
for (const r of rows) console.log(`${String(r.tier).padEnd(4)} ${r.kind.padEnd(8)} ${(r.auto?"Y":"n").padEnd(4)} ${String(r.dur).padStart(5)} ${String(r.sStart).padStart(7)} ${String(r.sEnd).padStart(7)} ${String(r.orders).padStart(8)} ${String(r.prod).padStart(7)} ${String(r.dmgLog).padStart(7)} ${String(r.cap).padStart(7)}`);
console.log("won:", e.s.won, "h:", (e.s.stats.playTime/3600).toFixed(2), "cycles:", e.s.stats.cycles, "guards:", e.s.stats.guards, "collapses:", e.s.stats.collapses, "tierG:", e.s.stats.tierGuards, "tierC:", e.s.stats.tierCollapses);
