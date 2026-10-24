// src/engine.js — 游戏引擎（纯逻辑，无渲染；Web 与模拟器共用）
// 结构照抄 AD：Currency(资源) / Effect(效果) / ExponentialCostScaling(成本) /
// GameDatabase(数据表 db.js) / tick 循环 / 存档。
// 深渊 tick、角色系统、剧情系统是本作自有逻辑。

import { Dec, D, formatScientific } from './num.js';
import { CHARACTERS, CHARACTER_ORDER, GENERIC_TREE, SHOP, TUNING, costOf, treeLayerCost } from './db.js';
import { STORY } from './story.js';
import { ACHIEVEMENTS } from './achievements.js';

export const STATE_VERSION = 1;
export const ENGINE_VERSION = 1;
const AP_GUARD = [1, 2, 4, 8];
const AP_COLLAPSE = [1, 1, 1, 1];

// ─────────────────────────────────────────────
// 深渊
// ─────────────────────────────────────────────
export function tierCapLog(tier) {
  return TUNING.tierExponents[tier] + Math.log10(TUNING.tierMantissa);
}
export function tierCap(tier) {
  return Dec.pow10(tierCapLog(tier));
}
export function tierStartLog(tier, startAbyssMult = 1) {
  // 起点衔接上一档的上限：冲进新地方时，深渊就在你刚达到的高度附近，而不是跳 1000 个数量级
  const base = tier <= 0 ? TUNING.firstTierStartLog : tierCapLog(tier - 1);
  return base + Math.log10(startAbyssMult);
}
// 深渊本 tick 的对数增速（数量级/秒）：dy/dt = D·e^(t/τ)/τ
export function abyssRate(tier, t) {
  // 对数型：logS(t) = 起点 + 跨度 × ln(1+t/t0)/ln(1+T/t0)
  // 开局涨得猛（玩家打不过），之后越来越慢（玩家能压住），积分到 T 时正好涨满跨度。
  const span = tierCapLog(tier) - tierStartLog(tier);
  const T = TUNING.tauByTier[tier] ?? TUNING.tau;
  const t0 = TUNING.abyssT0;
  return span / (Math.log(1 + T / t0) * (t + t0));
}

// ─────────────────────────────────────────────
// 状态
// ─────────────────────────────────────────────
export function createInitialState() {
  const s = {
    v: STATE_VERSION,
    tier: 0,
    mtc: Dec.zero(),
    mp: Dec.zero(),
    pp: Dec.zero(),
    ap: Dec.zero(),
    t: 0,
    S: Dec.zero(),
    run: { peakProd: Dec.zero(), bestPurify: 0, manualActions: 0, purifiedLog: -Infinity },
    chars: {},
    generic: {},
    stats: {
      cycles: 0, guards: 0, clears: 0, playTime: 0,
      collapses: 0,             // 覆灭次数（守护不计入，剧情用）
      firstGuard: [false, false, false, false],
      firstCollapse: [false, false, false, false],
      tierGuards: [0, 0, 0, 0],
      tierCollapses: [0, 0, 0, 0],
      purifiedLog: -Infinity,   // 累计净化的深渊总量（log10）
      maxTier: 0,               // 到达过的最高档
      runLog: [],
      manualProduce: 0,        // 手动生产次数（长按整段只算一次）
      tierCycles: [0, 0, 0, 0],   // 每个地方各自的覆灭次数（记忆累积按地方独立）
      idleCollapses: 0,        // 一整轮没有任何手动操作的覆灭次数
    },
    unlocked: ['249'],
    caches: { baiqiStock: Dec.zero(), drained: Dec.zero(), lastPeakProd: Dec.zero() },
    won: false,
    paused: false,          // 暂停：不跑 tick，但可以买东西
    pending: null,          // null | 'guard' | 'collapse'：等待玩家点「净化 / 覆灭」
    storyQueue: [],         // 待播放剧情 id
    storySeen: [],          // 已播放过的剧情 id
    storyActive: false,     // 正在播放剧情（暂停的一种）
    settings: { skipReadStories: false },   // 设置：跳过已读剧情
    shop: { mp: 0, pp: 0 },                 // 万事屋：已兑换次数（价格随次数指数上涨）
    achievements: [],                       // 已达成成就 id（永久保留）
  };
  for (const id of CHARACTER_ORDER) {
    s.chars[id] = {
      upgrades: CHARACTERS[id].upgrades.map(() => 0),
      techs: CHARACTERS[id].techs.map(() => 0),
      tree: {},
      autoTimer: 0,
      techTimer: 0,
    };
  }
  for (const n of GENERIC_TREE) s.generic[n.id] = 0;
  s.S = Dec.pow10(tierStartLog(0));
  return s;
}

export function serialize(state) {
  return JSON.stringify(state, (k, v) => (v instanceof Dec ? (v.m === 0 ? 0 : `${v.m}e${v.e}`) : v));
}

export function deserialize(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  const base = createInitialState();
  const merged = Object.assign(base, raw);
  for (const k of ['mtc', 'mp', 'pp', 'ap', 'S']) merged[k] = Dec.from(raw[k] ?? 0);
  if (raw.run) merged.run = Object.assign(base.run, raw.run, { peakProd: Dec.from(raw.run.peakProd ?? 0) });
  if (raw.caches) {
    for (const k of Object.keys(base.caches)) merged.caches[k] = Dec.from(raw.caches[k] ?? 0);
  }
  if (raw.chars) {
    for (const id of CHARACTER_ORDER) {
      if (!raw.chars[id]) continue;
      merged.chars[id] = Object.assign(merged.chars[id], raw.chars[id]);
      merged.chars[id].upgrades = (raw.chars[id].upgrades || []).map(Number);
      merged.chars[id].techs = (raw.chars[id].techs || []).map(Number);
    }
  }
  merged.stats = Object.assign(base.stats, raw.stats || {});
  merged.settings = Object.assign({}, base.settings, raw.settings || {});
  merged.shop = Object.assign({}, base.shop, raw.shop || {});
  return merged;
}

const d = (x) => (x instanceof Dec ? x : Dec.from(x));

// MP / PP / AP 一律整数：获取向下取整、消耗向上取整
const fmtSmall = (v) => {
  const x = d(v);
  const lg = Dec.log10(x);
  if (!isFinite(lg)) return '—';
  if (lg < 6 && lg > -6) return x.toNumber().toFixed(2);
  return formatScientific(x);
};

export const intFloor = (x) => {
  const v = d(x);
  const lg = Dec.log10(v);
  if (!isFinite(lg) || lg < 0) return Dec.zero();
  if (lg > 15) return v;                      // 大到不该出现在资源上，原样返回
  return Dec.from(Math.floor(v.toNumber()));
};
export const intRound = (x) => {
  const v = d(x);
  const lg = Dec.log10(v);
  if (!isFinite(lg) || lg < 0) return Dec.zero();
  if (lg > 15) return v;
  return Dec.from(Math.round(v.toNumber()));
};

export const intCeil = (x) => {
  const v = d(x);
  const lg = Dec.log10(v);
  if (!isFinite(lg) || lg <= 0) return Dec.one();
  if (lg > 15) return v;
  return Dec.from(Math.ceil(v.toNumber()));
};

// 效果累乘器：同时为「数值贡献面板」提供每一项的 log10 贡献
class Mult {
  constructor(kind) {
    this.kind = kind;
    this.log = 0;
    this.parts = [];
    this.base = Dec.one();
  }
  mul(v, id, name) {
    const dec = d(v);
    const lg = Dec.log10(dec);
    if (!isFinite(lg) || Math.abs(lg) < 1e-12) return this;
    this.log += lg;
    this.parts.push({ id, name, log: lg });
    return this;
  }
  addBase(v) {
    this.base = this.base.add(v);
    return this;
  }
  value() {
    if (!isFinite(this.log)) return Dec.pow10(this.log > 0 ? 1e9 : -1e9);
    return Dec.mul(this.base, Dec.pow10(this.log));
  }
}

// ─────────────────────────────────────────────
// 引擎
// ─────────────────────────────────────────────
export class Engine {
  constructor(state) {
    this.s = state || createInitialState();
    this.b = null;
    this.baiqiPowerTree = 0;
    this.abyssRateMult = 1;
    this.offlineMult = 1;   // 离线时深渊增速倍率
    this.storyConditions = true;   // 条件型剧情轮询开关（自动化测试可关掉，事件型不受影响）
  }

  get state() { return this.s; }
  isUnlocked(id) { return this.s.unlocked.includes(id); }

  buildCtx() {
    const s = this.s;
    const sumL = {}, nTree = {};
    let sumLAll = 0, nTreeAll = 0;
    for (const id of CHARACTER_ORDER) {
      const c = s.chars[id];
      const unlocked = this.isUnlocked(id);
      const sl = unlocked ? c.upgrades.reduce((a, b) => a + b, 0) : 0;
      const nt = unlocked ? Object.keys(c.tree).length : 0;
      sumL[id] = sl; nTree[id] = nt;
      sumLAll += sl; nTreeAll += nt;
    }
    const yS = Dec.log10(s.S);
    const y0 = tierStartLog(s.tier, Math.pow(0.9, s.generic['g6'] || 0));
    const progress = Math.max(0, Math.min(1, 1 - yS / Math.max(1, y0)));
    const b = this.b;
    return {
      t: s.t, tier: s.tier, mtc: s.mtc, S: s.S,
      cap: tierCap(s.tier), yS, yCap: tierCapLog(s.tier), y0, progress,
      cycles: s.stats.cycles, guards: s.stats.guards,
      tierCycles: (s.stats.tierCycles && s.stats.tierCycles[s.tier]) || 0,
      sumL, nTree, sumLAll, nTreeAll,
      maxProd: s.run.peakProd,
      prod249: (b && b.prod249) || Dec.one(),
      lineProd: (b && b.lineProd) || Dec.zero(),
      hengPowerRaw: (b && b.hengPower) || Dec.one(),
      atkSpeed: (b && b.atkSpeed) || 1,
      genericLv: (id) => s.generic[id] || 0,
      genericCostMult: Math.pow(0.88, s.generic['g3'] || 0),
    };
  }

  computeBonuses() {
    const s = this.s;
    this.abyssRateMult = 1;
    this.baiqiPowerTree = 0;
    const ctx = this.buildCtx();
    const g = (id) => s.generic[id] || 0;

    const achMul = d(1 + TUNING.achPer * ((s.achievements && s.achievements.length) || 0));   // 每个成就 +achPer

    // ── 通用树（PP）──
    const genericProd = new Mult('prod');
    genericProd.mul(Dec.pow(TUNING.memoryBase, s.stats.collapses), 'memory', `记忆累积（覆灭 ${s.stats.collapses} 次）`);
    const genericEta = new Mult('eta');
    const genericDmg = new Mult('damage');
    let mpGain = Dec.one(), ppGain = Dec.one(), techCostMult = 1, costMult = Math.pow(0.88, g('g3'));
    let offlineSlow = 0.25, autoTech = false, lastStand = false, centerLv = 0;
    for (const n of GENERIC_TREE) {
      const lv = g(n.id);
      if (!lv) continue;
      switch (n.id) {
        case 'g1': genericProd.mul(Dec.pow(d(1 + 0.1 * ctx.sumLAll), 0.5), n.id, n.name); break;
        case 'g2': genericEta.mul(Dec.pow(d(1 + 0.1 * ctx.sumLAll), 0.5), n.id, n.name); break;
        case 'g5': lastStand = true; break;
        case 'g7': centerLv = lv; break;
        case 'g8': genericProd.mul(Dec.pow(2, lv), n.id, n.name); break;
        case 'g9': genericEta.mul(Dec.pow(10, lv), n.id, n.name); break;
        case 'g10': mpGain = mpGain.mul(Dec.pow(5, lv)); break;
        case 'g11': ppGain = ppGain.mul(Dec.pow(5, lv)); break;
        case 'g12': genericDmg.mul(Dec.pow(d(1 + 0.5 * lv), 0.5 * lv), n.id, n.name); break;
        case 'g13': techCostMult *= Math.pow(0.97, lv); break;
        default: break;
      }
    }

    // ── 249 ──
    const prod249 = new Mult('prod');
    const eta = new Mult('eta');
    const speed = new Mult('speed');
    const startProd = new Mult('start');
    let keepMtc = 0, singularity = false, mpTechBonus = 1, mpTech249 = 1, ppTech249 = 1;
    if (this.isUnlocked('249')) {
      const c = s.chars['249'];
      const def = CHARACTERS['249'];
      for (let i = 0; i < def.upgrades.length; i++) {
        const u = def.upgrades[i];
        const lv = c.upgrades[i];
        if (lv <= 0) continue;
        if (u.kind === 'prod') {
          prod249.mul(u.mul(lv, ctx), u.id, u.name);
          if (u.id === '249u8') eta.mul(d(1 + 0.1 * lv), '249u8e', '产线总控·净化');
        } else if (u.kind === 'eta') eta.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'speed') speed.mul(u.mul(lv, ctx), u.id, u.name);
      }
      for (let i = 0; i < def.techs.length; i++) {
        const tc = def.techs[i];
        const lv = c.techs[i];
        if (lv <= 0) continue;
        if (tc.kind === 'prodByTime') prod249.mul(d(1 + 0.05 * lv * (ctx.t / 60)), tc.id, tc.name);
        else if (tc.kind === 'mpByTime') mpTech249 *= 1 + 0.2 * lv * (ctx.t / 60);
        else if (tc.kind === 'ppByEarliness') ppTech249 *= 1 + 0.2 * lv * Math.max(0, (TUNING.fillSeconds - ctx.t)) / 60;
      }
      const nt = ctx.nTree['249'];
      for (const node of def.tree) {
        if (!c.tree[node.id]) continue;
        switch (node.id) {
          case '249a1': keepMtc = 0.2; break;
          case '249a2': speed.mul(d(1 + 0.15 * nt), node.id, node.name); break;
          case '249a3': mpTechBonus *= (1 + ctx.cycles / 4); break;
          case '249a4': eta.mul(d(1 + 0.8 * ctx.progress), node.id, node.name); break;
          case '249a5': startProd.mul(d(1 + 0.5 * nt), node.id, node.name); break;
          case '249a7': prod249.mul(Dec.pow(d(1 + 0.01 * ctx.sumLAll), 0.5), node.id, node.name); break;
          case '249a8': prod249.mul(d(Math.min(2, 1 + ctx.t / 300)), node.id, node.name); break;
          case '249a9': prod249.mul(d(2), node.id, node.name); singularity = true; break;
          default: break;
        }
      }
    }
    prod249.mul(speed.value(), 'speed', '时钟校准/时间加速');
    const prod249Base = prod249.value();

    // ── 耶维奇 ──
    const line = new Mult('line');
    line.base = Dec.zero();   // 未解锁时独立产线为 0，不能默认成 1
    const prod249Extra = new Mult('prod249');
    const powerAll = new Mult('powerAll');
    const mtcGain = new Mult('mtc');
    let crossChar = 0;
    if (this.isUnlocked('yewei')) {
      const c = s.chars.yewei;
      const def = CHARACTERS.yewei;
      const l1 = c.upgrades[0];
      // 刚解锁时独立产线 = 249 的产量（0 级贡献与 249 持平）
      line.addBase(prod249Base);
      if (l1 > 0) line.mul(def.upgrades[0].mul(l1, ctx), def.upgrades[0].id, def.upgrades[0].name);
      for (let i = 1; i < def.upgrades.length; i++) {
        const u = def.upgrades[i];
        const lv = c.upgrades[i];
        if (lv <= 0) continue;
        if (u.kind === 'line') line.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'prodAll') prod249.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'prod249') prod249Extra.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'powerAll') powerAll.mul(u.mul(lv, ctx), u.id, u.name);
      }
      const t4 = c.techs[3];
      if (t4 > 0) crossChar = (0.2 * t4) / (t4 + 10);
      const nt = ctx.nTree.yewei;
      for (const node of def.tree) {
        if (!c.tree[node.id]) continue;
        switch (node.id) {
          case 'ywa1': line.mul(d(1 + 0.2 * ctx.cycles), node.id, node.name); break;
          case 'ywa2': this.abyssRateMult = Math.pow(0.9, nt); break;
          case 'ywa3': costMult *= Math.pow(0.9, nt); break;
          case 'ywa4': this.baiqiPowerTree = 1 + 0.3 * ctx.sumL.yewei * nt; break;
          case 'ywa5': prod249.mul(d(1 + 0.2 * nt), node.id, node.name); break;
          case 'ywa6': line.mul(d(1 + 0.1 * ctx.sumL.yewei), node.id, node.name); break;
          case 'ywa7': mtcGain.mul(d(1 + 0.5 * ctx.cycles), node.id, node.name); break;
          case 'ywa8': line.mul(d(1 + 0.5 * nt), node.id, node.name); break;
          case 'ywa9': {
            line.mul(d(1 + 0.15 * Math.max(0, Dec.log10(Dec.max(prod249.value(), 1)))), node.id, node.name);
            prod249Extra.mul(d(1 + 0.15 * Math.max(0, Dec.log10(Dec.max(line.value(), 1)))), node.id, '万事屋本店·反哺');
            break;
          }
          default: break;
        }
      }
      if (crossChar > 0) {
        line.mul(d(1 + crossChar * Math.max(0, Dec.log10(Dec.max(prod249.value(), 1)))), 'ywt4a', '资源转化·249→万事屋');
        prod249Extra.mul(d(1 + crossChar * Math.max(0, Dec.log10(Dec.max(line.value(), 1)))), 'ywt4b', '资源转化·万事屋→249');
      }
    }
    const prod249Final = prod249.value().mul(prod249Extra.value());
    let prodTotal = prod249Final.add(line.value());
    if (singularity) prodTotal = prodTotal.add(Dec.pow(Dec.max(s.mtc, 1), 0.5));
    // 通用乘区（奶茶翻倍、共鸣等）作用在全体产量上
    prodTotal = prodTotal.mul(genericProd.value()).mul(achMul);

    // ── 白琦 ──
    const powerBq = new Mult('power');
    const dmgBq = new Mult('damage');
    const rateBq = new Mult('rate');
    let critRate = 0, critDmg = 0, dragonLayers = 0, dragonMul = 1, lifesteal = 0, executeMul = 1;
    if (this.isUnlocked('baiqi')) {
      const c = s.chars.baiqi;
      const def = CHARACTERS.baiqi;
      const l1 = c.upgrades[0];
      if (l1 > 0) rateBq.mul(def.upgrades[0].rate(l1), 'bqu1', '剑意');
      for (let i = 1; i < def.upgrades.length; i++) {
        const u = def.upgrades[i];
        const lv = c.upgrades[i];
        if (lv <= 0) continue;
        if (u.kind === 'power') powerBq.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'damage') dmgBq.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'critRate') critRate += u.critRate(lv);
        else if (u.kind === 'critDmg') critDmg += u.critDmg(lv);
        else if (u.kind === 'dragon') dragonLayers = Math.min(4, Math.floor(10 / Math.max(0.4, u.cooldown(lv))));
        else if (u.kind === 'dragonPower') dragonMul = u.dragonMul(lv);
        else if (u.kind === 'powerRate') rateBq.mul(u.mul(lv, ctx), u.id, u.name);
      }
      const t3 = c.techs[2], t4 = c.techs[3];
      if (t3 > 0) lifesteal = 0.03 * t3;
      if (t4 > 0 && ctx.progress >= 0.6) executeMul = Math.pow(1 + t4, 2);
      const nt = ctx.nTree.baiqi;
      for (const node of def.tree) {
        if (!c.tree[node.id]) continue;
        switch (node.id) {
          case 'bqa1': powerBq.mul(d(1 + 0.2 * ctx.sumLAll), node.id, node.name); break;
          case 'bqa2': dmgBq.mul(Dec.pow(d(1 + 1.5 * ctx.progress), 2), node.id, node.name); break;
          case 'bqa3': critRate += 0.08 * nt; break;
          case 'bqa4': dmgBq.mul(Dec.pow(d(1 + ctx.t / 120), 0.5), node.id, node.name); break;
          case 'bqa5': dmgBq.mul(d(1 + 0.1 * ctx.sumLAll), node.id, node.name); break;
          case 'bqa6': critDmg += 0.6 * nt; break;
          case 'bqa7': {
            const cd = 60 * Math.pow(0.95, c.upgrades[5]) * Math.pow(0.8, nt);
            dragonLayers = Math.max(dragonLayers, Math.min(4, Math.floor(10 / Math.max(0.4, cd))));
            break;
          }
          case 'bqa8': dragonMul *= 1 + 0.5 * ctx.sumL.baiqi; break;
          case 'bqa9': break;
          default: break;
        }
      }
      if (this.baiqiPowerTree) powerBq.mul(d(this.baiqiPowerTree), 'bqa4y', '挚友');
      powerBq.mul(powerAll.value(), 'powerAll', '万事通');
      dmgBq.mul(genericDmg.value(), 'genericDmg', '通用树·战斗');
    }
    const dragonFactor = dragonLayers > 0 ? Dec.pow(10, dragonLayers * dragonMul) : Dec.one();
    critRate = Math.min(1, critRate);
    s.caches.rateBaiqi = rateBq.value();
    // 刚解锁时给一份基础剑意，使 0 级白琦的秒伤与 249 的净化量同量级；之后靠 tick 累积
    const stockBq = d(s.caches.baiqiStock || 0).add(prod249Base.mul(10));
    const powerBqVal = stockBq.mul(powerBq.value()).mul(achMul);
    const dmgBqVal = powerBqVal.mul(0.1).mul(d(1 + critRate * (1 + critDmg))).mul(dragonFactor).mul(dmgBq.value());

    // ── 恒 ──
    let dmgHeng = Dec.zero();
    let hengPower = Dec.zero();
    let atkSpeed = 1;
    if (this.isUnlocked('heng')) {
      const c = s.chars.heng;
      const def = CHARACTERS.heng;
      const powerMul = new Mult('power');
      const atkMul = new Mult('atk');
      const dmgMul = new Mult('damage');
      let alphaAdd = 0, alphaMul = 1, burstAlpha = 1;
      for (let i = 0; i < def.upgrades.length; i++) {
        const u = def.upgrades[i];
        const lv = c.upgrades[i];
        if (lv <= 0) continue;
        if (u.kind === 'alpha') {
          if (u.add) alphaAdd += u.add(lv);
          if (u.mul) alphaMul *= d(u.mul(lv, ctx)).toNumber();
        } else if (u.kind === 'power') powerMul.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'atkSpeed') atkMul.mul(u.mul(lv, ctx), u.id, u.name);
        else if (u.kind === 'damage') dmgMul.mul(u.mul(lv, ctx), u.id, u.name);
      }
      const t2 = c.techs[1], t3 = c.techs[2], t4 = c.techs[3];
      if (t2 > 0) {
        const cd = 30 * Math.pow(0.95, t2) * Math.pow(0.9, t3);
        const uptime = cd <= 10 ? 1 : 10 / cd;
        burstAlpha = 1 + t2 * uptime * (1 + t4 * 0.5);
      }
      const nt = ctx.nTree.heng;
      for (const node of def.tree) {
        if (!c.tree[node.id]) continue;
        switch (node.id) {
          case 'hga1': powerMul.mul(d(1 + 0.2 * ctx.sumLAll), node.id, node.name); break;
          case 'hga2': alphaAdd += 0.03 * nt; break;
          case 'hga3': atkMul.mul(d(1 + 0.2 * nt), node.id, node.name); break;
          case 'hga4': dmgMul.mul(Dec.pow(d(1 + 1.5 * ctx.progress), 2), node.id, node.name); break;
          case 'hga5': alphaMul *= d(1 + 0.1 * ctx.sumL.heng).toNumber(); break;
          case 'hga7': powerMul.mul(Dec.pow(d(1 + ctx.t / 120), 0.5), node.id, node.name); break;
          case 'hga8': powerMul.mul(d(1 + 0.5 * ctx.cycles), node.id, node.name); break;
          case 'hga9': atkMul.mul(d(Math.min(3, 1 + ctx.t / 120)), node.id, node.name); break;
          default: break;
        }
      }
      powerMul.mul(powerAll.value(), 'powerAll', '万事通');
      dmgMul.mul(genericDmg.value(), 'genericDmg', '通用树·战斗');
      atkSpeed = atkMul.value().toNumber();
      const alpha = Math.min(TUNING.alphaCap, (0.25 + alphaAdd) * alphaMul * Math.min(2, burstAlpha));
      const ratio = Dec.div(Dec.max(s.S, d(1e-300)), Dec.pow10(ctx.y0));
      const lgRatio = Math.max(0, Dec.log10(ratio));
      // 深渊越强恒越强，但用对数幂次，避免直接指数化把平衡冲掉
      hengPower = prod249Base.mul(d(10 * Math.pow(1 + lgRatio, 1 + 2 * alpha))).mul(powerMul.value()).mul(achMul);
      let eff = hengPower.mul(0.1).mul(dmgMul.value());
      if (atkSpeed > 20) eff = eff.mul(d(atkSpeed / 20));
      if (c.tree['hga6']) {
        const drain = 0.0005 * ctx.nTree.heng;
        const amt = s.S.mul(drain * TUNING.tickSeconds);
        s.caches.drained = d(s.caches.drained || 0).add(amt);
        hengPower = hengPower.add(s.caches.drained);
        eff = eff.add(s.caches.drained.mul(0.1).mul(dmgMul.value()));
      }
      dmgHeng = eff.mul(executeMul);
      s.caches.hengPower = hengPower;
      s.caches.atkSpeed = atkSpeed;
    }

    const etaVal = eta.value().mul(genericEta.value());
    s.caches.prod249 = prod249Final;
    s.caches.lineProd = line.value();
    const dmgTotal = dmgBqVal.add(dmgHeng);

    const b = {
      ctx,
      prodTotal,
      prod249: prod249Final,
      lineProd: line.value(),
      eta: etaVal,
      purifyTea: prodTotal.mul(etaVal),
      powerBaiqi: powerBqVal,
      dmgBaiqi: dmgBqVal,
      dmgHeng,
      hengPower,
      atkSpeed,
      dmgTotal,
      mtcGain: mtcGain.value(),
      mpGain: d(mpGain).mul(d(mpTechBonus)).mul(d(mpTech249)),
      techCostMult,
      ppGain: d(ppGain).mul(d(ppTech249)),
      costMult,
      keepMtc,
      achMul,
      startProdMult: startProd.value(),
      offlineSlow,
      autoTech: centerLv >= 1,
      autoGuard: centerLv >= 2,
      centerLv,
      lastStand,
      lifesteal,
      crossChar,
      dragonLayers,
      magicTree: 0,
      contrib: {
        prod: [...prod249.parts, ...prod249Extra.parts, ...line.parts, ...genericProd.parts],
        eta: [...eta.parts, ...genericEta.parts],
        damage: [...dmgBq.parts, ...genericDmg.parts],
        power: [...powerBq.parts],
      },
      parts: {
        prod249: prod249.parts, line: line.parts, eta: eta.parts,
        genericProd: genericProd.parts, genericEta: genericEta.parts,
      },
    };
    this.b = b;
    return b;
  }

  bonuses() {
    if (!this.b) return this.computeBonuses();
    return this.b;
  }

  // ── tick ──
  tick(dt = TUNING.tickSeconds) {
    const s = this.s;
    if (s.won) return null;
    if (s.paused || s.pending) return null;   // 暂停/待结算：不推进任何 tick
    const b = this.computeBonuses();
    s.t += dt;
    s.stats.playTime += dt;

    // 1. 产量累加
    const gain = b.prodTotal.mul(dt).mul(b.mtcGain);
    s.mtc = s.mtc.add(gain);
    if (Dec.gt(b.prodTotal, s.run.peakProd)) s.run.peakProd = b.prodTotal.clone();

    // 白琦剑意存量
    s.caches.baiqiStock = d(s.caches.baiqiStock || 0).add((s.caches.rateBaiqi || Dec.zero()).mul(dt));

    // 2. 战斗结算（净化 + 战斗伤害）
    const totalDmg = b.purifyTea.add(b.dmgTotal);
    if (Dec.gt(totalDmg, 0) && Dec.gt(s.S, 0)) {
      const dmg = totalDmg.mul(dt);
      s.S = Dec.sub(s.S, dmg);
      if (Dec.lte(s.S, 0)) s.S = Dec.zero();   // 夹到 0：负数的 log10 会变 NaN
      // 本轮累计净化掉的深渊（对数饱和累加，用于决定覆灭时给多少记忆点数）
      {
        const add = Dec.log10(dmg);
        if (isFinite(add)) {
          const cur = s.run.purifiedLog;
          s.run.purifiedLog = isFinite(cur)
            ? Math.max(cur, add) + Math.log10(1 + Math.pow(10, Math.min(cur, add) - Math.max(cur, add)))
            : add;
        }
      }
      if (b.lifesteal > 0 && Dec.gt(b.dmgTotal, 0)) {
        // 吸血：把伤害的一小部分转为 mtc，但不超过本 tick 产量的一个比例（避免线性反哺爆表）
        const cap = b.prodTotal.mul(dt * 0.5);
        const add = Dec.min(b.dmgTotal.mul(b.lifesteal * dt), cap);
        s.mtc = s.mtc.add(add);
      }
    }
    if (Dec.lte(s.S, 0)) {
      this.enterPending('guard');
      if (b.autoGuard) { s.storyQueue.length = 0; this.resolvePending(true); return null; }
      return 'guard';
    }
    const p = Math.max(0, Math.min(1, 1 - Dec.log10(s.S) / Math.max(1, b.ctx.y0)));
    if (p > s.run.bestPurify) s.run.bestPurify = p;

    // 3. 深渊增长：基础速率 × 玩家产量对数增速的跟随项
    //    玩家产能涨得快，深渊才涨得快，且滞后、且只有一部分权重 —— 这样每轮都能清得更多，
    //    直到某一轮玩家的加速度反超，把深渊压到 0。
    const pLogNow = Dec.log10(Dec.max(b.prodTotal, 1));
    const pLogPrev = (s.caches.prevProdLog === undefined) ? pLogNow : s.caches.prevProdLog;
    s.caches.prevProdLog = pLogNow;
    const growth = Math.max(0, Math.min(20, (pLogNow - pLogPrev) / dt));
    const follow = 1 + TUNING.abyssFollow * growth;
    const rate = abyssRate(s.tier, s.t) * this.abyssRateMult * this.offlineMult * follow;
    if (rate > 0 && Dec.gt(s.S, 0)) s.S = Dec.pow10(Dec.log10(s.S) + rate * dt);

    // 3.5 屠龙者（白琦 5 层）：每分钟把深渊进度（对数）压低 8%
    if (this.isUnlocked('baiqi') && s.chars.baiqi.tree['bqa9'] && Dec.gt(s.S, 0)) {
      s.caches.abyssCutTimer = (s.caches.abyssCutTimer || 0) + dt;
      if (s.caches.abyssCutTimer >= 60) {
        s.caches.abyssCutTimer -= 60;
        const yS = Dec.log10(s.S);
        const y0 = b.ctx.y0;
        if (yS > y0) s.S = Dec.pow10(yS - 0.08 * (yS - y0));
      }
    }

    // 4. 边界判定
    if (Dec.gte(s.S, tierCap(s.tier))) {
      this.enterPending('collapse');
      if (b.autoTech) { s.storyQueue.length = 0; this.resolvePending(true); return null; }
      return 'collapse';
    }

    // 5. 自动购买
    this.runAutobuyers(dt);
    this.runAutoTrunks(dt);
    // 5.5 成就
    this.checkAchievements();

    // 6. 条件型剧情（每 0.5 秒轮询，一次只推一条）
    this.checkStoryConditions(dt);
    return null;
  }

  advance(seconds) {
    const dt = TUNING.tickSeconds;
    let left = seconds, n = 0;
    while (left > 1e-9 && !this.s.won) {
      // 离线：剧情不逐段播，待结算自动点掉，保证挂机能继续推进
      while (this.s.storyQueue.length) this.finishStory();
      if (this.s.pending) this.resolvePending(true);
      if (this.s.pending) break;
      const step = Math.min(dt, left);
      this.tick(step);
      left -= step;
      if (++n > 5e6) break;
    }
    return n;
  }

  // 手动生产：点一下 = 1 秒的产量（受产量倍率影响）
  clickProduce() {
    const gain = this.bonuses().prodTotal;
    this.s.mtc = this.s.mtc.add(gain);
    return gain;
  }

  // ── 万事屋：mtc 兑换 MP / PP ──
  // 价格 = base × growth^n（n = 已兑换次数）；商业谈判 / 渠道批发 降低 growth，下限 1.05
  shopGrowth(kind) {
    const s = this.s;
    const cfg = kind === 'mp' ? SHOP.mp : SHOP.pp;
    const lv = this.isUnlocked('yewei') ? s.chars.yewei.techs[kind === 'mp' ? 1 : 2] : 0;
    return Math.max(1.05, cfg.growth * Math.pow(0.97, lv));
  }

  shopPrice(kind) {
    const cfg = kind === 'mp' ? SHOP.mp : SHOP.pp;
    const n = (this.s.shop && this.s.shop[kind]) || 0;
    return Dec.mul(d(cfg.base), Dec.pow(this.shopGrowth(kind), n));
  }

  buyShop(kind) {
    const s = this.s;
    const price = this.shopPrice(kind);
    if (Dec.lt(s.mtc, price)) return false;
    s.mtc = s.mtc.sub(price);
    if (!s.shop) s.shop = { mp: 0, pp: 0 };
    s.shop[kind] = (s.shop[kind] || 0) + 1;
    if (kind === 'mp') s.mp = intRound(s.mp.add(1));
    else s.pp = intRound(s.pp.add(1));
    return true;
  }

  // ── 购买 ──
  // AD 同款：每买满 10 级，成本倍率本身翻一倍（cost = base × (mult × 2^⌊L/10⌋)^L）
  groupCostMult(level) {
    return Math.pow(TUNING.groupCostMult, Math.floor(level / TUNING.bulkGroup));
  }

  costOfUpgrade(charId, idx, level) {
    const base = CHARACTERS[charId].upgrades[idx].cost(level);
    const b = this.bonuses();
    return base.mul(this.groupCostMult(level)).mul(b.costMult).mul(d(b.ctx.genericCostMult));
  }

  // 本次点击最多能买几个（上限 10），以及总价
  // 每次点击最多买到「下一个 10 的倍数」：36 → 40，10 → 20，买不起就尽量买
  bulkInfo(charId, idx) {
    let lv = this.s.chars[charId].upgrades[idx];
    let total = Dec.zero();
    let n = 0;
    if (!this.upgradeUnlocked(charId, idx)) return { count: 0, total, level: lv, target: lv };
    const cap0 = CHARACTERS[charId].upgrades[idx].maxLevel ?? Infinity;
    const target = Math.min(cap0, (Math.floor(lv / TUNING.bulkGroup) + 1) * TUNING.bulkGroup);
    const maxAdd = Math.max(0, target - lv);
    while (n < maxAdd) {
      const cost = this.costOfUpgrade(charId, idx, lv);
      if (Dec.lt(this.s.mtc, Dec.add(total, cost))) break;
      total = total.add(cost);
      n++;
      lv++;
    }
    return { count: n, total, level: lv, target };
  }

  buyUpgradeBulk(charId, idx) {
    const info = this.bulkInfo(charId, idx);
    if (info.count === 0) return info;
    const c = this.s.chars[charId];
    this.s.mtc = this.s.mtc.sub(info.total);
    c.upgrades[idx] = info.level;
    this.b = null;
    return info;
  }

  // 单项科技「当前加成」文案
  techPreview(charId, idx, level) {
    const def = CHARACTERS[charId].techs[idx];
    const lv = level === undefined ? this.s.chars[charId].techs[idx] : level;
    const ctx = this.bonuses().ctx;
    if (def.kind === 'auto') return lv <= 0 ? '未解锁' : lv <= 8 ? `自动买 1–${lv}` : `间隔 ×0.9^${lv - 8}`;
    if (def.kind === 'mpBuy') return `换 ${(2 * Math.pow(1.5, lv)).toFixed(1)} MP`;
    if (def.kind === 'crossChar') return `互转 ${((0.2 * lv) / (lv + 10)).toFixed(3)}`;
    if (def.kind === 'charge') return `下一击 ×${(1 + 1.5 * lv).toFixed(2)}`;
    if (def.kind === 'lifesteal') return `吸血 ${(3 * lv).toFixed(0)}%`;
    if (def.kind === 'execute') return `斩杀 ×${Math.pow(1 + lv, 2).toFixed(1)}`;
    if (def.kind === 'burst') return `爆发 α ×${(1 + lv).toFixed(1)}`;
    if (def.kind === 'burstCD') return `冷却 ×${Math.pow(0.9, lv).toFixed(3)}`;
    if (def.kind === 'burstPower') return `爆发伤害 ×${(1 + lv).toFixed(1)}`;
    if (def.mul) return `×${fmtSmall(def.mul(lv, ctx))}`;
    return '—';
  }

  // 单项升级「当前总加成」文案
  upgradePreview(charId, idx, level) {
    const def = CHARACTERS[charId].upgrades[idx];
    const lv = level === undefined ? this.s.chars[charId].upgrades[idx] : level;
    const ctx = this.bonuses().ctx;
    const pctOf = (x) => `+${(x * 100).toFixed(1)}%`;
    if (def.kind === 'critRate') return `暴击率 ${pctOf(def.critRate(lv))}`;
    if (def.kind === 'critDmg') return `暴伤 ${pctOf(def.critDmg(lv))}`;
    if (def.kind === 'dragon') return `冷却 ${def.cooldown(lv).toFixed(2)}s`;
    if (def.kind === 'dragonPower') return `每层强度 ×${def.dragonMul(lv).toFixed(2)}`;
    if (def.kind === 'alpha') {
      if (def.add) return `α +${def.add(lv).toFixed(2)}`;
      if (def.mul) return `α ×${d(def.mul(lv, ctx)).toNumber().toFixed(2)}`;
      return '—';
    }
    if (def.kind === 'auto') {
      return lv <= 0 ? '未解锁' : lv <= 8 ? `自动买 1–${lv}` : `间隔 ×0.9^${lv - 8}`;
    }
    if (def.kind === 'mpBuy') return `换 ${(2 * Math.pow(1.5, lv)).toFixed(1)} MP`;
    if (def.kind === 'crossChar') return `互转 ${((0.2 * lv) / (lv + 10)).toFixed(3)}`;
    if (def.kind === 'line') return `独立产线 ${(0.4 * lv).toFixed(1)}%`;
    if (def.rate) return `×${fmtSmall(def.rate(lv))}/s`;
    if (def.mul) return `×${fmtSmall(def.mul(lv, ctx))}`;
    return '—';
  }

  upgradeUnlocked(charId, idx) {
    if (idx === 0) return true;
    const def = CHARACTERS[charId].upgrades[idx];
    const need = def.reqLevel || 0;
    if (!need) return true;
    return (this.s.chars[charId].upgrades[idx - 1] || 0) >= need;
  }

  // 「购买最大数量」：把该角色所有已解锁的升级，各自买到买不起为止
  buyMaxAll(charId) {
    let total = 0;
    const def = CHARACTERS[charId];
    for (let i = 0; i < def.upgrades.length; i++) {
      if (!this.upgradeUnlocked(charId, i)) break;   // 后面的还没解锁
      let guard = 0;
      while (guard++ < 5000 && this.buyUpgrade(charId, i, 1)) total++;
    }
    return total;
  }

  buyUpgrade(charId, idx, howMany = 1) {
    const s = this.s;
    const c = s.chars[charId];
    const def = CHARACTERS[charId].upgrades[idx];
    if (!this.upgradeUnlocked(charId, idx)) return 0;
    let bought = 0;
    const maxLevel = def.maxLevel ?? Infinity;
    for (let i = 0; i < howMany; i++) {
      const lv = c.upgrades[idx];
      if (lv >= maxLevel) break;
      const cost = this.costOfUpgrade(charId, idx, lv);
      if (Dec.lt(s.mtc, cost)) break;
      s.mtc = s.mtc.sub(cost);
      c.upgrades[idx] = lv + 1;
      if (def.database) s.db[def.id] = c.upgrades[idx];
      bought++;
    }
    if (bought) this.b = null;
    return bought;
  }

  buyMaxUpgrade(charId, idx, cap = 5000) {
    let total = 0;
    while (total < cap) {
      if (!this.buyUpgrade(charId, idx, 1)) break;
      total++;
    }
    return total;
  }

  costOfTech(charId, idx, level) {
    const b = this.bonuses();
    return intCeil(CHARACTERS[charId].techs[idx].cost(level).mul(d(b.techCostMult || 1)));
  }

  buyTech(charId, idx) {
    const s = this.s;
    const c = s.chars[charId];
    const lv = c.techs[idx];
    const capT = CHARACTERS[charId].techs[idx].maxLevel || 20;
    if (lv >= capT) return false;
    if (Dec.lt(s.mp, this.costOfTech(charId, idx, lv))) return false;
    s.mp = intRound(s.mp.sub(this.costOfTech(charId, idx, lv)));
    c.techs[idx] = lv + 1;
    this.b = null;
    return true;
  }

  costOfTreeNode(charId, layer) {
    return intCeil(treeLayerCost(layer));
  }

  // 角色树节点的前置：'layer' 需先解锁上一层 / 'leaf' 需先买同方向通用叶子 / 'ap' 觉醒点不够 / null 可买
  treeNodeBlocker(charId, nodeId) {
    const s = this.s;
    const c = s.chars[charId];
    const node = CHARACTERS[charId].tree.find((n) => n.id === nodeId);
    if (!node || c.tree[nodeId]) return null;
    let maxLayer = 0;
    for (const n of CHARACTERS[charId].tree) if (c.tree[n.id]) maxLayer = Math.max(maxLayer, n.layer);
    if (node.layer > maxLayer + 1) return 'layer';
    if (node.layer === 1) {
      const leaf = GENERIC_TREE.find((g) => g.slot === 'leaf' && g.angle === CHARACTERS[charId].angle);
      if (leaf && !(s.generic[leaf.id] > 0)) return 'leaf';
    }
    if (Dec.lt(s.ap, intCeil(treeLayerCost(node.layer)))) return 'ap';
    return null;
  }

  // 该角色第 1 层要挂的通用叶子名（给提示文案用）
  rootLeafName(charId) {
    const leaf = GENERIC_TREE.find((g) => g.slot === 'leaf' && g.angle === CHARACTERS[charId].angle);
    return leaf ? leaf.name : '';
  }

  buyTreeNode(charId, nodeId) {
    const s = this.s;
    const c = s.chars[charId];
    if (this.treeNodeBlocker(charId, nodeId)) return false;
    const node = CHARACTERS[charId].tree.find((n) => n.id === nodeId);
    s.ap = intRound(s.ap.sub(intCeil(treeLayerCost(node.layer))));
    c.tree[nodeId] = true;
    this.b = null;
    return true;
  }

  respecTree(charId) {
    const s = this.s;
    const c = s.chars[charId];
    let refund = Dec.zero();
    for (const n of CHARACTERS[charId].tree) {
      if (c.tree[n.id]) { refund = refund.add(treeLayerCost(n.layer)); delete c.tree[n.id]; }
    }
    s.ap = intRound(s.ap.add(refund));
    this.b = null;
    return refund;
  }

  costOfGeneric(nodeId, level) {
    const node = GENERIC_TREE.find((n) => n.id === nodeId);
    return intCeil(node.cost(level));
  }

  genericUnlocked(nodeId) {
    const node = GENERIC_TREE.find((n) => n.id === nodeId);
    if (!node || !node.parent) return true;
    return (this.s.generic[node.parent] || 0) > 0;
  }

  parentName(nodeId) {
    const node = GENERIC_TREE.find((n) => n.id === nodeId);
    const p = node && GENERIC_TREE.find((n) => n.id === node.parent);
    return p ? p.name : '';
  }

  buyGeneric(nodeId) {
    const s = this.s;
    const node = GENERIC_TREE.find((n) => n.id === nodeId);
    if (!this.genericUnlocked(nodeId)) return false;
    const lv = s.generic[nodeId] || 0;
    if (node.cap && lv >= node.cap) return false;
    if (!node.repeat && lv > 0) return false;
    const cost = intCeil(node.cost(lv));
    if (Dec.lt(s.pp, cost)) return false;
    s.pp = intRound(s.pp.sub(cost));
    s.generic[nodeId] = lv + 1;
    this.b = null;
    return true;
  }

  tradeMp() {
    const s = this.s;
    if (!this.isUnlocked('yewei')) return false;
    const lv = s.chars.yewei.techs[1];
    if (lv <= 0) return false;
    const cost = Dec.mul(10, Dec.pow(2, lv));
    if (Dec.lt(s.mtc, cost)) return false;
    s.mtc = s.mtc.sub(cost);
    s.mp = s.mp.add(Dec.mul(1.5, Dec.pow(1.6, lv)));
    return true;
  }

  // 自动化中枢 3–6 级：自动买四种「翻倍」主干
  runAutoTrunks(dt) {
    const s = this.s;
    const lv = s.generic.g7 || 0;
    if (lv < 3) return;
    const order = ['g8', 'g10', 'g11', 'g9'];
    // 7 级起压缩自动间隔：0.5s × 0.95^(lv-6)，下限 0.05s
    const interval = lv >= 7 ? Math.max(0.05, 0.5 * Math.pow(0.95, lv - 6)) : 0.5;
    s.caches.trunkTimer = (s.caches.trunkTimer || 0) + dt;
    if (s.caches.trunkTimer < interval) return;
    s.caches.trunkTimer = 0;
    for (let i = 0; i < Math.min(lv - 2, 4); i++) this.buyGeneric(order[i]);
  }

  runAutobuyers(dt) {
    const s = this.s;
    const b = this.bonuses();
    for (const id of CHARACTER_ORDER) {
      if (!this.isUnlocked(id)) continue;
      const c = s.chars[id];
      const autoLv = c.techs[0];
      if (autoLv > 0) {
        const interval = Math.max(
          TUNING.autoBuyMinInterval,
          TUNING.autoBuyBaseInterval * Math.pow(TUNING.autoBuyIntervalMult, Math.max(0, autoLv - 8)),
        );
        c.autoTimer += dt;
        if (c.autoTimer >= interval) {
          c.autoTimer = 0;
          if (autoLv >= TUNING.autoBuyMaxLevel) this.buyMaxAll(id);   // 满级：每次直接买到买不起
          else for (let i = 0; i < Math.min(autoLv, 8); i++) this.buyUpgrade(id, i, 1);
        }
      }
    }
  }

  // ── 待结算（暂停等玩家点按钮）──
  enterPending(kind) {
    const s = this.s;
    if (s.pending) return;
    s.pending = kind;
    s.paused = true;
    // 立刻把该播的剧情塞进队列（守护/覆灭都会触发对应节点）
    this.enqueueStory(kind);
    this.b = null;
  }

  // 玩家点「净化 / 覆灭」按钮：结算资源、推进档位、恢复进行
  // auto = true 表示自动化中枢代为结算：重开剧情只弹没看过的
  resolvePending(auto = false) {
    const s = this.s;
    const kind = s.pending;
    if (!kind) return null;
    const b = this.bonuses();
    const tier = s.tier;
    const out = { kind, tier, mp: Dec.zero(), pp: Dec.zero(), ap: Dec.zero(), nextTier: tier };

    // MP：覆灭与守护都给（整数）
    const purifyMag = Math.max(0, s.run.purifiedLog || 0);   // 本轮净化掉的数量级
    const base = Dec.add(TUNING.mpPerCollapse, Math.floor(purifyMag / TUNING.mpPerMagnitude));
    const mp = intRound(Dec.mul(base, b.mpGain));   // 四舍五入：1.8 倍也给 2 点，避免 1 级科技毫无手感
    s.mp = intRound(s.mp.add(mp));
    out.mp = mp;

    if (kind === 'guard') {
      s.stats.guards++;
      s.stats.tierGuards[tier]++;
      {
        const add = tierStartLog(tier, Math.pow(0.9, s.generic['g6'] || 0));
        const a = s.stats.purifiedLog;
        s.stats.purifiedLog = !isFinite(a) ? add : Math.max(a, add) + Math.log10(1 + Math.pow(10, Math.min(a, add) - Math.max(a, add)));
      }
      if (tier > s.stats.maxTier) s.stats.maxTier = tier;
      const pp = intRound(Dec.mul(TUNING.ppPerGuard * (tier + 1), 1).mul(b.ppGain));   // 同样四舍五入
      s.pp = intRound(s.pp.add(pp));
      out.pp = pp;
      if (!s.stats.firstGuard[tier]) {
        s.stats.firstGuard[tier] = true;
        const ap = intFloor(Dec.from(AP_GUARD[tier]));
        s.ap = intRound(s.ap.add(ap));
        out.ap = ap;
      }
      s.stats.cycles++;
      s.stats.runLog.push({ kind: 'guard', tier, t: Math.round(s.t), purify: 1 });
      if (tier >= TUNING.maxTier) {
        s.won = true;
        s.stats.clears++;
        this.enqueueStory('win');
      } else {
        s.tier = tier + 1;
        out.nextTier = s.tier;
        this.unlockForTier(s.tier);
        this.startRun(s.tier, false);
      }
    } else {
      s.stats.cycles++;
      s.stats.collapses++;
      if (!s.stats.tierCycles) s.stats.tierCycles = [0, 0, 0, 0];
      s.stats.tierCycles[tier] = (s.stats.tierCycles[tier] || 0) + 1;
      s.stats.tierCollapses[tier]++;
      if (!s.stats.firstCollapse[tier]) {
        s.stats.firstCollapse[tier] = true;
        const ap = intFloor(Dec.from(AP_COLLAPSE[tier]));
        s.ap = intRound(s.ap.add(ap));
        out.ap = ap;
      }
      if ((s.run.manualActions || 0) === 0) s.stats.idleCollapses = (s.stats.idleCollapses || 0) + 1;
      s.stats.runLog.push({ kind: 'collapse', tier, t: Math.round(s.t), purify: Math.round(s.run.bestPurify * 1000) / 1000 });
      if (s.stats.runLog.length > 5000) s.stats.runLog.shift();
      s.tier = 0;
      out.nextTier = 0;
      this.startRun(0, true);
      this.enqueueRestart(auto);   // 回到店里：开场与 249 的教学
    }

    s.pending = null;
    s.paused = s.storyQueue.length > 0 || s.storyActive;
    this.b = null;
    return out;
  }

  // 成就：每 tick 扫一遍未达成的（36 项，开销可忽略）
  checkAchievements() {
    const s = this.s;
    if (!s.achievements) s.achievements = [];
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id)) continue;
      if (a.check(s, this)) {
        s.achievements.push(a.id);
        this.b = null;
      }
    }
  }

  // 待结算面板的「预计获得」，必须和 resolvePending 用同一套取整
  previewPendingReward() {
    const s = this.s;
    if (!s.pending) return null;
    const b = this.bonuses();
    const purifyMag = Math.max(0, s.run.purifiedLog || 0);
    const base = Dec.add(TUNING.mpPerCollapse, Math.floor(purifyMag / TUNING.mpPerMagnitude));
    const mp = intRound(Dec.mul(base, b.mpGain));
    const pp = s.pending === 'guard'
      ? intRound(Dec.mul(TUNING.ppPerGuard * (s.tier + 1), 1).mul(b.ppGain))
      : Dec.zero();
    return { mp, pp };
  }

  // ── 剧情 ──
  // 当前深渊进度（对数口径，0 = 开局，1 = 上限）
  progress() {
    const s = this.s;
    const cap = tierCapLog(s.tier);
    if (!(cap > 0)) return 0;
    return Math.max(0, Math.min(1, Dec.log10(s.S) / cap));
  }

  // 条件型剧情的判定；支持 { all: [...] } / { any: [...] } 组合
  condMet(w) {
    const s = this.s;
    if (!w) return false;
    if (w.all) return w.all.every((x) => this.condMet(x));
    if (w.any) return w.any.some((x) => this.condMet(x));
    switch (w.at) {
      case 'tier': return s.tier >= w.n;
      case 'mtc': return Dec.log10(s.mtc) >= w.log;
      case 'cycles': return s.stats.cycles >= w.n;
      case 'guards': return (s.stats.tierGuards || []).reduce((a, b) => a + b, 0) >= w.n;
      case 'time': return s.t >= w.sec;
      case 'ap': return Dec.gte(s.ap, w.n);
      case 'prog': return this.progress() >= w.gte;
      case 'upgrade': return (s.chars[w.char] && s.chars[w.char].upgrades[w.idx] || 0) >= w.level;
      case 'tech': return (s.chars[w.char] && s.chars[w.char].techs[w.idx] || 0) >= w.level;
      case 'node': return (s.generic[w.id] || 0) >= (w.level || 1);
      case 'tree': return !!(s.chars[w.char] && s.chars[w.char].tree[w.id]);
      default: return false;
    }
  }

  // 每 0.5 秒扫一遍未播的条件剧情，命中一条就停（避免连播刷屏）
  checkStoryConditions(dt) {
    const s = this.s;
    if (!this.storyConditions) return;
    if (s.storyQueue.length || s.storyActive || s.pending) return;
    s.caches.storyTimer = (s.caches.storyTimer || 0) + dt;
    if (s.caches.storyTimer < 0.5) return;
    s.caches.storyTimer = 0;
    for (const entry of STORY) {
      if (entry.trigger.type !== 'cond') continue;
      if (s.storySeen.includes(entry.id)) continue;
      if (!this.condMet(entry.trigger.when)) continue;
      s.storyQueue.push(entry.id);
      s.storySeen.push(entry.id);
      s.paused = true;
      return;
    }
  }

  // 条目是否允许播：未标 repeat 的只播一次；repeat 条目每次触发都播，
  // 但玩家开启「跳过已读文本」后，已读的 repeat 条目不再弹出。
  canPlayStory(entry) {
    const s = this.s;
    const seen = s.storySeen.includes(entry.id);
    if (!seen) return true;
    if (!entry.repeat) return false;
    return !s.settings.skipReadStories;
  }

  pushStory(entry) {
    const s = this.s;
    s.storyQueue.push(entry.id);
    if (!s.storySeen.includes(entry.id)) s.storySeen.push(entry.id);
    s.paused = true;
  }

  enqueueStory(event) {
    const s = this.s;
    const tier = s.tier;
    const countOf = (ev) => (ev === 'guard' ? s.stats.tierGuards[tier] + 1 : s.stats.tierCollapses[tier] + 1);
    // 全局次数（覆灭次数 / 守护次数），供 minCount / maxCount 用
    const totalOf = (ev) => (ev === 'guard' ? (s.stats.guards || 0) : (s.stats.collapses || 0));
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== event) continue;
      if (t.tier !== undefined && t.tier !== tier) continue;
      if (t.count !== undefined && t.count !== countOf(event)) continue;
      if (t.minCount !== undefined && totalOf(event) < t.minCount) continue;
      if (t.maxCount !== undefined && totalOf(event) > t.maxCount) continue;
      if (!this.canPlayStory(entry)) continue;
      this.pushStory(entry);
    }
  }

  // 进店 / 覆灭后重开：播「restart」类剧情
  // auto = true（自动化中枢自动结算）时，已读的一律不弹，免得挂机被开场刷屏
  enqueueRestart(auto = false) {
    const s = this.s;
    // 用入队前的已读快照判断 onlyIfSeen，避免刚入队的条目把自己算成「已读」
    const seenBefore = new Set(s.storySeen);
    for (const entry of STORY) {
      const t = entry.trigger;
      if (t.type !== 'restart') continue;
      if (t.count !== undefined && t.count !== (s.stats.collapses || 0)) continue;
      if (t.onlyIfSeen && !seenBefore.has(t.onlyIfSeen)) continue;
      if (auto && s.storySeen.includes(entry.id)) continue;
      if (!this.canPlayStory(entry)) continue;
      this.pushStory(entry);
    }
  }

  nextStory() {
    const s = this.s;
    if (!s.storyQueue.length) return null;
    const id = s.storyQueue[0];
    s.storyActive = true;
    s.paused = true;
    return STORY.find((x) => x.id === id) || null;
  }

  finishStory() {
    const s = this.s;
    s.storyQueue.shift();
    s.storyActive = s.storyQueue.length > 0;
    s.paused = s.storyQueue.length > 0 || !!s.pending;
    return s.storyQueue.length > 0;
  }

  startStoryIfFirstRun() {
    this.enqueueRestart();
    const s = this.s;
    if (s.storyQueue.length) { s.storyActive = true; }
  }

  togglePause(force) {
    const s = this.s;
    if (s.pending) return;
    s.paused = force === undefined ? !s.paused : !!force;
  }

  unlockForTier(tier) {
    for (const id of CHARACTER_ORDER) {
      if (CHARACTERS[id].unlockTier === tier && !this.s.unlocked.includes(id)) this.s.unlocked.push(id);
    }
  }

  startRun(tier, isCollapse) {
    const s = this.s;
    if (isCollapse) {
      const keep = this.b ? this.b.keepMtc : 0;
      // 记忆归档：取「存量 20%」与「本轮 60 秒产能」的较小者——只给开局手感，不继承上一轮的财富
      // 只按「轮次」给启动资金，与本轮产能脱钩：否则 mtc 与产量同阶，等于每轮继承产量
      const runCap = Dec.mul(Dec.pow(TUNING.keepBase, s.stats.cycles), TUNING.keepSeconds);
      s.mtc = Dec.min(s.mtc.mul(keep), runCap);
      // 升级一律重置（只有科技与科技树保留）
      for (const id of CHARACTER_ORDER) {
        const c = s.chars[id];
        for (let i = 0; i < c.upgrades.length; i++) c.upgrades[i] = 0;
      }
      s.caches.baiqiStock = Dec.zero();
      s.caches.drained = Dec.zero();
      s.caches.abyssCutTimer = 0;
    }
    s.t = 0;
    const prevPeak = s.run ? s.run.peakProd : Dec.zero();
    s.run = { peakProd: Dec.zero(), bestPurify: 0, manualActions: 0, purifiedLog: -Infinity };
    // 深渊起点：取「本档固定起点」与「玩家进档时产量 × 10^gap」的较大者，
    // 这样进新档时深渊总比玩家强一点点，靠轮内加速去追，而不是一跳 100 个数量级。
    this.b = null;
    const baseLog = tierStartLog(tier, Math.pow(0.9, s.generic['g6'] || 0));
    const pLog = Dec.log10(Dec.max(prevPeak, 1)) + TUNING.startGap;
    s.S = Dec.pow10(Math.max(baseLog, pLog));
  }

  // ── 贡献面板 ──
  // 说明：主链（灌装线/剑意/骨钉）是「和 mtc 同阶」的中性通道，单独标注、不计入占比，
  // 否则任何时刻它都占 ~100%，面板就失去意义（AD 的数据页同理，看的是乘区构成）。
  contribution() {
    const b = this.bonuses();
    const NEUTRAL = new Set(['249u1', 'bqu1', 'hgu1', 'base249', 'baseEta', 'baseSpeed']);
    const summarize = (parts, neutralLabel) => {
      const map = new Map();
      for (const p of parts) {
        if (NEUTRAL.has(p.id)) continue;
        map.set(p.name, (map.get(p.name) || 0) + p.log);
      }
      const total = [...map.values()].reduce((a, v) => a + Math.abs(v), 0) || 1;
      const rows = [...map.entries()]
        .map(([name, log]) => ({ name, log, pct: Math.abs(log) / total }))
        .sort((a, c) => Math.abs(c.log) - Math.abs(a.log));
      if (neutralLabel) {
        const mainLog = parts.filter((p) => NEUTRAL.has(p.id)).reduce((a, p) => a + p.log, 0);
        rows.unshift({ name: neutralLabel, log: mainLog, pct: 0, neutral: true });
      }
      return rows;
    };
    return {
      prod: summarize(b.contrib.prod, '主链（与 mtc 同阶，中性）'),
      eta: summarize([...b.contrib.prod, ...b.contrib.eta], '主链（与 mtc 同阶，中性）'),
      damage: summarize(b.contrib.damage, '主链（与 mtc 同阶，中性）'),
      power: summarize(b.contrib.power),
      prodLog: Dec.log10(b.prodTotal),
      purifyLog: Dec.log10(b.purifyTea.add(b.dmgTotal)),
      abyssLog: Dec.log10(this.s.S),
    };
  }
}
