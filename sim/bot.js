// sim/bot.js — 三种策略机器人（供模拟器使用）
// 策略：'value'=买性价比最高；'cheapest'=买最便宜；'preset'=预设顺序
import { Dec, D } from '../src/num.js';
import { CHARACTERS, CHARACTER_ORDER, TUNING } from '../src/db.js';

const lg = (v) => Dec.log10(v);

// 单个升级的“效果对数”近似（用于性价比排序）
function effectLog(def, lv, ctx) {
  if (def.kind === 'carry') return 0.05 * lv;
  if (def.kind === 'line') return Math.log10(1 + 0.004 * (lv + 1)) + 2;
  if (def.mul) return lg(def.mul(lv + 1, ctx));
  if (def.kind === 'powerRate') return lg(def.rate(lv + 1));
  if (def.kind === 'critRate') return 0.5 * Math.log10(1 + Math.min(1, def.critRate(lv + 1)) * 2);
  if (def.kind === 'critDmg') return 0.5 * Math.log10(1 + def.critDmg(lv + 1));
  if (def.kind === 'dragon') return 0.02 * lv;
  if (def.kind === 'dragonPower') return 0.1 * lv;
  if (def.kind === 'alpha') return 1.5 * (def.add ? def.add(lv + 1) : 0);
  return 0;
}

// 单步购买：按性价比排序后「整段批量」买入（用对数估算可买级数，避免逐级循环）
function buyLoop(engine, mode) {
  const s = engine.s;
  const ctx = engine.bonuses().ctx;
  const list = [];
  for (const id of CHARACTER_ORDER) {
    if (!s.unlocked.includes(id)) continue;
    const c = s.chars[id];
    const defs = CHARACTERS[id].upgrades;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const lv = c.upgrades[i];
      const maxLv = def.maxLevel ?? Infinity;
      if (lv >= maxLv) continue;
      const cost = engine.costOfUpgrade(id, i, lv);
      const cl = Math.max(0.001, lg(cost));
      const e0 = effectLog(def, lv, ctx);
      const e1 = effectLog(def, lv + 1, ctx);
      list.push({ id, i, def, lv, cost, eff: e1 - e0, score: (e1 - e0) / cl, cl });
    }
  }
  if (mode === 'cheapest') list.sort((a, b) => Dec.cmp(a.cost, b.cost));
  else if (mode === 'preset') list.sort((a, b) => (a.id + a.i).localeCompare(b.id + b.i));
  else list.sort((a, b) => b.score - a.score);

  const reserve = Number((typeof process !== 'undefined' && process.env && process.env.DNY_RESERVE) || 1); // 成本与产量同阶，默认把钱花光
  const budget = Dec.log10(Dec.max(s.mtc, 1)) - Math.log10(reserve);
  for (const item of list) {
    const c = s.chars[item.id];
    let lv = c.upgrades[item.i];
    // 级数估算：成本每级 ×costMult（主链 2、其余 4），可买级数 = (budget - log10(cost))/log10(costMult)
    const c0 = Number(engine.costOfUpgrade(item.id, item.i, lv).toString());
    const c1 = Number(engine.costOfUpgrade(item.id, item.i, lv + 1).toString());
    const ratio = (c1 > c0 && c0 > 0) ? c1 / c0 : (item.def.costMult || 2);
    const perLevel = Math.log10(ratio);
    let k = Math.floor((budget - lg(engine.costOfUpgrade(item.id, item.i, lv))) / perLevel);
    if (!(k > 0)) continue;
    const maxLv = item.def.maxLevel ?? Infinity;
    k = Math.min(k, maxLv - lv);   // 玩家用「购买最大数量」，一次买满
    if (!(k > 0)) continue;
    // 实际扣费按精确成本逐级（最多 2000 级，成本可用几何级数一次算完）
    const first = engine.costOfUpgrade(item.id, item.i, lv);
    // 等比数列求和：first * (2^k - 1)
    const total = first.mul(Dec.pow(ratio, k).sub(1));
    if (Dec.gt(total, s.mtc)) { k = Math.max(1, Math.floor(k / 2)); }
    const total2 = first.mul(Dec.pow(ratio, k).sub(1));
    if (Dec.gt(total2, s.mtc)) continue;
    s.mtc = s.mtc.sub(total2);
    c.upgrades[item.i] = lv + k;
    if (item.def.database) s.db[item.def.id] = lv + k;
  }
  engine.b = null;
}

const TECH_PRIORITY = {
  '249': [0, 2, 3, 1, 4, 5, 6, 7],
  yewei: [0, 1, 3, 2, 4, 5, 6, 7],
  baiqi: [0, 2, 3, 1, 4, 5, 6, 7],
  heng: [0, 2, 3, 1, 4, 5, 6, 7],
};

const GENERIC_ORDER = ['g7', 'g8', 'g10', 'g11', 'g9', 'g1', 'g2', 'g3', 'g12', 'g6', 'g5', 'g4', 'g13'];

export function makeBot(kind = 'value', opts = {}) {
  let timer = 0;
  return function act(engine, dt) {
    const s = engine.s;
    timer += dt;
    const period = opts.period || 5;   // 默认每 5 秒决策一次
    if (timer < period) return;
    timer = 0;

    buyLoop(engine, kind);

    // 科技（MP）
    for (const id of CHARACTER_ORDER) {
      if (!s.unlocked.includes(id)) continue;
      for (const i of TECH_PRIORITY[id] || [0, 1, 2, 3]) {
        let guard = 0;
        while (engine.buyTech(id, i) && guard++ < 300);
      }
    }
    // 通用树（PP）
    for (const nid of GENERIC_ORDER) {
      let guard = 0;
      while (engine.buyGeneric(nid) && guard++ < 200);
    }
    // 万事屋（mtc → MP / PP）：只在 mtc 远高于兑换价时换，避免挤占升级
    if (opts.shop !== false && s.unlocked.includes('yewei')) {
      for (const kind of ['mp', 'pp']) {
        let guard = 0;
        while (guard++ < 20) {
          const price = engine.shopPrice(kind);
          if (Dec.lt(s.mtc, Dec.mul(price, opts.shopReserve || 1000))) break;
          if (!engine.buyShop(kind)) break;
        }
      }
    }
    // 角色科技树（AP）
    for (const id of CHARACTER_ORDER) {
      if (!s.unlocked.includes(id)) continue;
      const tree = CHARACTERS[id].tree.slice().sort((a, b) => a.layer - b.layer);
      for (const node of tree) if (!s.chars[id].tree[node.id]) engine.buyTreeNode(id, node.id);
    }
  };
}
