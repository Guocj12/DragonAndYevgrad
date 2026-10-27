// web/js/app.js — 龙与耶维城 前端（V5 引擎外壳；AD 壳：Vue 2 + AD 的 styles.css/old-ui.css 类名）
//
// 铁律：
//   ① 本文件**不计算任何数值**。一切数字来自 src/engine.js 的视图模型
//      （view() / items() / techs() / successes() / bonuses() / state.stats / state.ledger）；
//   ② 数值只在引擎里算。升级可以手动买（点单项）或「购买最大数量」（= 把本 tick 的
//      自动购买立刻执行一次）；两者都直接调用 src/v5.js 里同一段购买记账，不改公式与价格；
//   ③ 主循环只用 requestAnimationFrame 累加**真实时间**，每 0.05 秒调一次 engine.tick()，
//      不按帧率跑数值、不做任何速度倍率（§8）；
//   ④ 存档只走 engine.save() / Engine.load()（§9.3），版本不符直接拒绝。
//
// 旧引擎（v1）的 shop / battle / 批量购买 / 待结算按钮 / 科技树画布全部移除；
// 科技树本轮「保留但不解锁」（TREE_ENABLED === false），不加载 web/js/tree.js。

import { formatScientific, formatTime, formatDisplay, formatInteger, formatPrice } from '../../src/num.js';
import { Engine, createInitialState, STATE_VERSION } from '../../src/engine.js';
import {
  CHARACTERS, CHARACTER_ORDER, TIER_NAMES, FAILURE_NAMES, SUCCESS_NAMES, LAYER_TO_CHAR, TREE_ENABLED,
  ITEM_GROUPS,
} from '../../src/db.js';

const SAVE_KEY = 'dny-save-v5';
const SYNC_MS = 60000;        // 每分钟自动上传一次（存档 + 排行榜指标）
const OFFLINE_CAP = 8 * 3600; // 离线最多补算 8 小时（§9.2：补算必须逐 tick 重放）

// ───────────────────────────── 数字显示 ─────────────────────────────
// 规则（用户口径）：
//   ① 全局不允许出现 "e-1" 这种负指数：小于 1 的值一律写成小数（0.05 这种）；
//   ② mtc 四舍五入到整数；价格也显示整数，但正数至少显示 1；
//   ③ 其余数字 ≥1 时正常用科学计数法。
const fmt = (v) => formatDisplay(v);
const fmtRatio = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const money = (v) => formatInteger(v);
const mtcText = (v) => formatInteger(v);
const mtcCost = (v) => formatPrice(v);

// ───────────────────────────── 服务器身份与存档 ─────────────────────────────
const NET = { name: '', rev: 0, hasSave: false, online: false, syncedAt: 0, note: '连接中…' };
let boardRows = [];
let boardNote = '';

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// 排行榜字段：**原样**搬运 engine.metrics()。
// 服务端 /api/board 只白名单接受 { tier, purified, cycles, guards, playTime, won, cleared }，
// 其余 V5 附加字段（layer / powerLog / F / U / runIndex / collapses）服务端会丢弃，仅供本地界面。
function metricsNow() { return engine.metrics(); }

let syncing = false;
async function syncNow(manual = false) {
  if (syncing) return;
  if (!NET.online) {
    const me = await apiFetch('/api/me');
    if (!me.ok) { NET.note = manual ? '服务器不可用' : NET.note; return; }
    NET.online = true;
    NET.name = me.data.name;
    NET.rev = me.data.rev;
  }
  syncing = true;
  try {
    const save = engine.save();
    let put = await apiFetch('/api/save', { method: 'PUT', body: JSON.stringify({ rev: NET.rev, save }) });
    if (put.status === 409) {
      NET.rev = put.data && typeof put.data.rev === 'number' ? put.data.rev : NET.rev + 1;
      put = await apiFetch('/api/save', { method: 'PUT', body: JSON.stringify({ rev: NET.rev, save }) });
    }
    if (put.ok) NET.rev = put.data.rev;
    await apiFetch('/api/board', { method: 'POST', body: JSON.stringify({ metrics: metricsNow() }) });
    NET.syncedAt = Date.now();
    NET.note = '已同步';
  } catch (e) {
    NET.note = '同步失败（下次重试）';
  } finally {
    syncing = false;
    if (manual) app.render();
  }
}

async function loadBoard() {
  const r = await apiFetch('/api/board?limit=50');
  if (r.ok && r.data && Array.isArray(r.data.rows)) {
    boardRows = r.data.rows;
    boardNote = boardRows.length ? '' : '还没有人上传成绩，玩一会儿再来看。';
  } else {
    boardNote = '排行榜拉取失败（服务器不可用？）';
  }
  app.render();
}

async function renameSelf(name) {
  const r = await apiFetch('/api/name', { method: 'POST', body: JSON.stringify({ name }) });
  if (r.ok) { NET.name = r.data.name; NET.note = '用户名已更新'; say(`用户名改为「${r.data.name}」`); }
  else NET.note = (r.data && r.data.error) || '改名失败';
  app.render();
}

// ───────────────────────────── 引擎与存档 ─────────────────────────────
let engine = new Engine(createInitialState());
let message = '';
let modal = null;
let activeTab = '249';
let activeSub = 'upgrades';
const groupOpen = {};   // 升级分组折叠状态（只在 UI 层，不进存档）

function say(msg) { message = msg; }

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: STATE_VERSION, t: Date.now(), s: engine.save() }));
  } catch (e) { /* 忽略配额错误 */ }
}

// ── 存档载入：本地 → 服务端；任一份抛 VERSION_MISMATCH 就**跳过它**继续试下一份 ──
// 旧 v1 档（localStorage 'dny-save-v1' 或 data/players/*.json 里的历史 save 字符串）
// 一律不被 Engine.load 接受，绝不静默当成新档载入（§9.3）。
let saveIssue = '';         // 一行灰字提示（顶栏 + 设置页）
let engineFromSave = false; // 当前引擎是否来自存档（决定还要不要拉服务端档）

const LEGACY_KEYS = ['dny-save-v1'];   // 旧壳的键名，只用于识别「旧档已跳过」

function noteSaveIssue(from, err) {
  if (err && err.code === 'VERSION_MISMATCH') {
    saveIssue = '旧版本存档已跳过（V5 不迁移旧档）';
    console.warn(`${from}存档版本不符（找到 ${String(err.found)}，需要 ${STATE_VERSION}），已跳过`);
  } else {
    saveIssue = `${from}存档已跳过（无法解析）`;
    console.warn(`${from}存档载入失败，已跳过`, err);
  }
}

// 存档字符串 → Engine，并按 §9.2 逐 tick 重放离线时间
function adoptSave(text, savedAt, from) {
  const inst = Engine.load(text);   // 版本不符在这里 throw（code = VERSION_MISMATCH）
  const elapsed = Math.min(OFFLINE_CAP, Math.max(0, (Date.now() - (Number(savedAt) || Date.now())) / 1000));
  if (elapsed > 5 && !inst.s.paused && !inst.s.finished) {
    try {
      inst.advance(elapsed);
      say(`从${from}存档继续，离线 ${formatTime(elapsed)} 已按 tick 重放`);
    } catch (e) {
      console.warn('离线结算中断', e);
      say('离线补算中断，已保留当前进度');
    }
  } else {
    say(`从${from}存档继续`);
  }
  NET.note = `已从${from}载入`;
  return inst;
}

function tryLocalSave() {
  for (const key of [SAVE_KEY, ...LEGACY_KEYS]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { noteSaveIssue('本地', e); continue; }
    if (!obj || typeof obj.s !== 'string') { noteSaveIssue('本地', new Error('缺少 s 字段')); continue; }
    try {
      const inst = adoptSave(obj.s, obj.t, '本地');
      if (key !== SAVE_KEY) saveGame();       // 把通过校验的档迁到 v5 键
      return inst;
    } catch (err) {
      noteSaveIssue('本地', err);             // 跳过这一份，继续试下一个
    }
  }
  return null;
}

async function tryServerSave() {
  const saved = await apiFetch('/api/save');
  if (!saved.ok || !saved.data || typeof saved.data.save !== 'string') return null;
  try {
    const inst = adoptSave(saved.data.save, saved.data.updatedAt, '服务器');
    NET.rev = saved.data.rev;
    return inst;
  } catch (err) {
    noteSaveIssue('服务器', err);             // 跳过这一份，交给新档
    return null;
  }
}

async function bootServer() {
  const me = await apiFetch('/api/me');
  if (!me.ok || !me.data) { NET.note = '离线（服务器不可用），进度只存本地'; app.render(); return; }
  NET.name = me.data.name;
  NET.rev = me.data.rev;
  NET.hasSave = me.data.hasSave;
  NET.online = true;
  if (!engineFromSave && me.data.hasSave) {
    const adopted = await tryServerSave();
    if (adopted) {
      engine = adopted;
      engineFromSave = true;
      activeTab = LAYER_TO_CHAR[engine.s.layer];
      saveGame();
    }
  }
  app.render();
}

// ───────────────────────────── 视图模型 ─────────────────────────────
const charLayer = (id) => CHARACTERS[id].layer;

function tabsVM(layer) {
  const tabs = CHARACTER_ORDER
    .filter((id) => charLayer(id) <= layer)
    .map((id) => ({ id, name: CHARACTERS[id].name, kind: 'char' }));
  tabs.push({ id: 'guard', name: '守护', kind: 'guard' });
  tabs.push({ id: 'board', name: '排行榜', kind: 'board' });
  tabs.push({ id: 'stats', name: '统计', kind: 'stats' });
  tabs.push({ id: 'options', name: '设置', kind: 'options' });
  return tabs;
}

function ensureTab(layer) {
  const cur = LAYER_TO_CHAR[layer];
  if (CHARACTER_ORDER.includes(activeTab)) {
    if (activeTab === cur) return activeTab;
    if (charLayer(activeTab) > layer) activeTab = cur;   // 回退到重置后消失的角色页
    return activeTab;
  }
  if (!['guard', 'board', 'stats', 'options'].includes(activeTab)) activeTab = cur;
  return activeTab;
}

// 顶部 HUD：三个数字 + 两根条（§9.2）
// 数字一律 formatScientific(view().xxxDisplay)；0.001 ≤ x < 1 这类小数再补一个
// 「≈0.02」的十进制约数（纯显示提示，不参与任何计算），否则科学计数法读起来太别扭。
const altDecimal = (x) => (Number.isFinite(x) && x >= 1e-3 && x < 1 ? x.toFixed(2) : '');

function hudVM() {
  const v = engine.view();
  const ratio = Number.isFinite(v.pressureRatio) ? v.pressureRatio : 0;
  // 一根条两段：绿色 = 净化力、红色 = 深渊，都以左端为起点，红色覆盖在绿色之上。
  // 百分比用对数口径：log10(值) / log10(本档目标)。
  const logTarget = Math.log10(Math.max(v.targetInternal, 1.0000001));
  const pctOfTarget = (x) => {
    if (!(logTarget > 0)) return 0;
    const lg = Math.log10(Math.max(x, 1));
    return Math.max(0, Math.min(1, lg / logTarget));
  };
  const pPower = pctOfTarget(v.power);
  const pPressure = pctOfTarget(v.pressure);
  return {
    power: fmt(v.powerDisplay),        // 净化力 / 深渊保留两位小数（≥1 时按整数/科学计数法）
    pressure: fmt(v.pressureDisplay),
    mtc: mtcText(v.currencyDisplay),   // mtc 一律整数
    layer: v.layer,
    layerName: v.layerName,
    charId: v.charId,
    runTime: formatTime(v.runTime),
    layerTime: formatTime(v.layerTime),
    runIndex: v.runIndex,
    collapses: v.stats.collapses,
    guards: v.stats.guards,
    hits: v.hits,
    burstHits: v.burstHits,
    target: fmt(v.target),
    powerPct: (pPower * 100).toFixed(2),
    pressurePct: (pPressure * 100).toFixed(2),
    powerPctText: `${(pPower * 100).toFixed(2)}%`,
    pressurePctText: `${(pPressure * 100).toFixed(2)}%`,
    pressureRatioText: fmtRatio(ratio),
    danger: ratio >= 0.8,
    paused: !!v.paused,
    finished: !!v.finished,
    wallets: { mp: money(v.wallets.mp), pp: money(v.wallets.pp) },
    pendingKind: v.pending ? v.pending.kind : null,
  };
}

// 覆灭 / 守护 结算弹窗（默认不自动，玩家点了才继续）
function pendingVM() {
  const v = engine.view();
  if (!v.pending) return null;
  const p = v.pending;
  const pv = p.preview || {};
  const isGuard = p.kind === 'guard';
  return {
    kind: p.kind,
    guard: isGuard,
    title: isGuard ? '深渊已清零 · 守护' : '深渊已追平 · 覆灭',
    layer: p.layer,
    layerName: TIER_NAMES[p.layer - 1],
    time: formatTime(p.time),
    gained: money(pv.gained || 0),
    levelsGained: money(pv.levelsGained || 0),
    walletAfter: money(pv.walletAfter || 0),
    walletName: isGuard ? '守护点数 PP' : '记忆点数 MP',
    next: isGuard
      ? (p.layer === 4 ? '第四层成功：结算后通关' : `结算后进入第 ${p.layer + 1} 层「${TIER_NAMES[p.layer]}」`)
      : '结算后回到第 1 层「奶茶店」',
    button: isGuard ? '净化结算' : '覆灭结算',
  };
}

// 角色页「升级」：左右两栏（kind 0 = 主机制 / kind 1 = 第二机制）
// **只显示这个角色自己的 8 项**（owner = charLayer(charId)），不混别的角色；
// 每栏只显示【已解锁】的项 + 【下一个即将解锁】的那一项，其余未解锁一律隐藏。
function itemsVM(charId) {
  const curLayer = engine.s.layer;
  const owner = charLayer(charId);
  if (owner > curLayer) {
    return { live: false, cols: [], note: '这个角色还没遇到。' };
  }
  const list = engine.items().filter((it) => it.owner === owner);
  const nextIdx = list.findIndex((it) => !it.unlocked);
  const groups = ITEM_GROUPS[owner];
  const cards = list.map((it) => ({
    index: it.index,
    id: it.id,
    shortId: it.shortId,
    name: it.name,
    group: it.group,
    kind: it.kind,
    owner: it.owner,
    level: money(it.level),
    unlocked: !!it.unlocked,
    old: it.owner < curLayer,
    price: mtcCost(it.price),
    affordable: !!it.affordable,
    effect: it.level > 0 ? engine.itemEffect(it) : engine.itemMechanism(it),
    mechanism: engine.itemMechanism(it),
    unlockText: `净化力达 ${fmt(engine.display(it.nextThreshold))} 解锁`,
  }));
  const unlocked = cards.filter((c) => c.unlocked);
  const nextCard = nextIdx >= 0 ? cards[nextIdx] : null;
  const cols = [0, 1].map((kind) => ({
    kind,
    title: `${kind === 0 ? '主机制' : '第二机制'} · ${groups[kind]}`,
    cards: unlocked.filter((c) => c.kind === kind),
    next: nextCard && nextCard.kind === kind ? nextCard : null,
  }));
  return {
    live: true,
    owner,
    cols,
    note: '',
    unlockedCount: unlocked.length,
    total: cards.length,
    canBuyAny: unlocked.some((c) => c.affordable),
  };
}

// 角色页「科技」：自动购买（恒开）+ 失败永久 F_s（MP 购买，覆灭结算自动买）
function techsVM(charId) {
  const layer = charLayer(charId);
  const failName = (FAILURE_NAMES[layer - 1] || {}).name || '';
  return engine.techs(charId).map((t) => {
    const auto = t.kind === 'autoBuy';
    if (auto) {
      return {
        id: t.id,
        name: t.name,
        kind: t.kind,
        desc: t.desc,
        levelText: `Lv ${money(t.level)} / ${t.maxLevel}`,
        note: t.effect,
        costText: t.maxed ? '已满级（20Hz 购买最大数量）' : `升级需要 ${money(t.nextCost)} 记忆点数（MP）`,
        auto: true,
        maxed: !!t.maxed,
        affordable: !!t.affordable,
        nextCost: money(t.nextCost),
      };
    }
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      desc: t.desc,
      levelText: `Lv ${money(t.level)}`,
      note: `覆灭结算时用记忆点数自动购买（${failName}）`,
      costText: `下一级 ${money(t.nextCost)} 记忆点数（MP）`,
      auto: false,
      maxed: false,
      affordable: false,
      nextCost: money(t.nextCost),
    };
  });
}

// 「守护」页：成功永久 U1–U4（PP 自动兑换）
function guardVM() {
  const w = engine.permanent;
  return {
    wallets: { mp: money(w.failureWallet), pp: money(w.successWallet) },
    rows: engine.successes().map((s) => ({
      id: s.id,
      name: s.name,
      layer: s.layer,
      layerName: TIER_NAMES[s.layer - 1],
      level: money(s.level),
      nextCost: money(s.nextCost),
      placeholderExp: fmtRatio(s.placeholderExp),
    })),
    treeEnabled: TREE_ENABLED,
  };
}

// 统计页：本 tick 的全部效果明细 + 最近 20 条账目 + 累计统计
function statsVM() {
  const b = engine.bonuses();
  const st = engine.state.stats;
  const rows = [
    ['产量 production（内部/秒）', fmt(b.production)],
    ['转换 conversion', fmtRatio(b.conversion)],
    ['攻击频率 frequency（次/秒）', fmtRatio(b.frequency)],
    ['单次削减 hit', fmt(b.hit)],
    ['第五次强化 burst', fmtRatio(b.burst)],
    ['整程时间倍率 timeMultiplier', fmtRatio(b.timeMultiplier)],
    ['回收 salvage', fmt(b.salvage)],
    ['成功占位 placeholder（B_s）', fmt(b.placeholder)],
    ['全局 global', fmtRatio(b.global)],
    ['原始一阶 rawFirst', fmt(b.rawFirst)],
    ['原始二阶 rawSecond', fmt(b.rawSecond)],
    ['一阶 first', fmt(b.first)],
    ['二阶 second', fmt(b.second)],
    ['互借 share', fmtRatio(b.share)],
    ['首层加成 firstBonus', fmtRatio(b.firstBonus)],
  ];
  const ledger = engine.state.ledger.slice(-20).reverse().map((e, i) => ({
    key: `${e.kind}-${e.layer}-${e.runTicks}-${i}`,
    kindText: e.kind === 'success' ? '守护（成功）' : '覆灭（失败）',
    kind: e.kind,
    layer: e.layer,
    layerName: TIER_NAMES[(e.layer || 1) - 1],
    gained: money(e.gained) === '—' ? '—' : fmt(e.gained),
    spent: fmt(e.spent || 0),
    timeText: formatTime(e.time || 0),
  }));
  return {
    effects: rows,
    ledger,
    kv: [
      ['累计游玩', formatTime(st.playTime || 0)],
      ['总 tick 数', String(st.ticks || 0)],
      ['总轮次', String(st.runs || 0)],
      ['守护次数', String(st.guards || 0)],
      ['覆灭次数', String(st.collapses || 0)],
      ['各层覆灭', (st.failures || []).join(' / ')],
      ['各层守护', (st.guardsByLayer || []).join(' / ')],
      ['最高净化力数量级', Number.isFinite(st.bestPowerLog) ? st.bestPowerLog.toFixed(2) : '—'],
    ],
  };
}

function boardVM() {
  return {
    rows: boardRows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      layerText: TIER_NAMES[r.tier] || `第 ${Number(r.tier) + 1} 层`,
      // purified 是净化力的对数（log10）；显示成 1eN 形式
      purifiedText: Number.isFinite(r.purified) && r.purified > 0 ? `1e${r.purified.toFixed(2)}` : '1',
      cycles: r.cycles,
      timeText: formatTime(r.playTime),
      won: r.won,
    })),
    note: boardNote,
    myName: NET.name,
  };
}

function buildVM() {
  const layer = engine.s.layer;
  const tab = ensureTab(layer);
  const tabs = tabsVM(layer);
  const kind = CHARACTER_ORDER.includes(tab) ? 'char' : tab;
  const body = {};

  if (kind === 'char') {
    const subtabs = [{ id: 'upgrades', name: '升级' }, { id: 'techs', name: '科技' }];
    if (!subtabs.some((t) => t.id === activeSub)) activeSub = 'upgrades';
    const b = engine.bonuses();
    body.charInfo = {
      name: CHARACTERS[tab].name,
      title: CHARACTERS[tab].title,
      blurb: CHARACTERS[tab].blurb,
      production: fmt(b.production),
      first: fmt(b.first),
      second: fmt(b.second),
      share: fmtRatio(b.share),
      isCurrent: charLayer(tab) === layer,
      layer: charLayer(tab),
      layerName: TIER_NAMES[charLayer(tab) - 1],
    };
    body.subtabs = subtabs;
    body.items = activeSub === 'upgrades' ? itemsVM(tab) : null;
    body.techs = activeSub === 'techs' ? techsVM(tab) : null;
  } else if (kind === 'guard') {
    body.guard = guardVM();
  } else if (kind === 'board') {
    body.board = boardVM();
    body.board.myName = NET.name;
  } else if (kind === 'stats') {
    Object.assign(body, statsVM());
  } else if (kind === 'options') {
    body.net = {
      name: NET.name || '（连接中）',
      online: NET.online,
      note: NET.note,
      lastSync: NET.syncedAt ? `${formatTime((Date.now() - NET.syncedAt) / 1000)}前` : '还没同步过',
    };
  }

  return {
    kind, tab, sub: activeSub, tabs, body,
    hud: hudVM(),
    message,
    modal,
    pending: pendingVM(),
    auto: Object.assign({ collapse: false, guard: false }, engine.s.auto || {}),
    saveIssue,
    skipReadStories: !!(engine.s.settings && engine.s.settings.skipReadStories),
    saveKey: SAVE_KEY,
    stateVersion: STATE_VERSION,
    storyActive: !!engine.s.storyActive,
  };
}

// ───────────────────────────── 动作 ─────────────────────────────
function toB64(text) { return btoa(unescape(encodeURIComponent(text))); }
function fromB64(b64) { return decodeURIComponent(escape(atob(String(b64).trim()))); }

function act(action, payload) {
  switch (action) {
    case 'tab':
      activeTab = payload;
      if (payload === 'board') loadBoard();
      break;
    case 'sub':
      activeSub = payload;
      break;
    case 'groupToggle': {
      groupOpen[payload] = groupOpen[payload] === false;
      break;
    }
    case 'buyItem': {
      const it = engine.items()[payload];
      const name = it ? it.name : `#${payload}`;
      if (engine.buyItem(payload)) say(`「${name}」升级成功`);
      else say(`「${name}」买不起：mtc 不够下一级的价格`);
      break;
    }
    case 'buyAutoTech': {
      const info = engine.autoBuyInfo(payload);
      if (engine.buyAutoTech(payload)) say(`自动购买科技升到 Lv ${info.level + 1}：${engine.autoBuyInfo(payload).effect}`);
      else say(info.level >= info.maxLevel ? '自动购买科技已满级（22 级）' : `记忆点数不够：需要 ${info.nextCost}`);
      break;
    }
    case 'resolvePending': {
      const p = engine.s.pending;
      const ev = engine.resolvePending();
      if (ev) {
        const lv = ev.after[ev.kind][ev.layer - 1];
        say(ev.kind === 'success'
          ? `守护结算：获得 ${ev.gained} 守护点数，U${ev.layer} 升到 Lv ${lv}（花掉 ${ev.spent}）`
          : `覆灭结算：获得 ${ev.gained} 记忆点数，F${ev.layer} 升到 Lv ${lv}（花掉 ${ev.spent}）`);
      } else if (p) say('结算失败：没有待结算片段');
      break;
    }
    case 'toggleAutoSettle': {
      const kind = payload === 'guard' ? 'guard' : 'collapse';
      engine.s.auto[kind] = !engine.s.auto[kind];
      say(`${kind === 'guard' ? '自动守护' : '自动覆灭'}已${engine.s.auto[kind] ? '开启（结算不弹窗）' : '关闭（结算弹窗等你点）'}`);
      break;
    }
    case 'buyMax': {
      const n = engine.buyMaxOnce();
      say(n > 0 ? `本 tick 的自动购买已执行：一口气买了 ${n} 级` : '当前 mtc 买不起任何一项');
      break;
    }
    case 'pause': {
      const before = engine.s.paused;
      engine.togglePause();
      if (engine.s.paused === before) say('剧情播放中，暂停由剧情播放器接管');
      else say(engine.s.paused ? '已暂停（数值完全停止）' : '继续');
      break;
    }
    case 'toggleSkipRead': {
      if (!engine.s.settings) engine.s.settings = { skipReadStories: false };
      const v = !engine.s.settings.skipReadStories;
      engine.s.settings.skipReadStories = v;
      say(v ? '已开启：看过的剧情不再自动弹出' : '已关闭：看过的剧情照常播放');
      break;
    }
    case 'syncNow': syncNow(true); break;
    case 'boardRefresh': loadBoard(); break;
    case 'setName': {
      const el = document.getElementById('name-input');
      if (el && el.value.trim()) renameSelf(el.value.trim());
      else say('用户名需要 2–16 个字符');
      break;
    }
    case 'save': saveGame(); say('已保存到本地（服务端按分钟同步）'); break;
    case 'export': {
      const b64 = toB64(engine.save());
      modal = { title: '导出存档', text: `已生成 Base64 存档（含 ${STATE_VERSION} 版本号），已尝试复制到剪贴板。`, textarea: b64, actions: ['close'] };
      try { navigator.clipboard && navigator.clipboard.writeText(b64); } catch (e) { /* 忽略 */ }
      break;
    }
    case 'importOpen':
      modal = { title: '导入存档', text: '粘贴 Base64 存档后点「导入」。旧 v1 档会被拒绝。', textarea: '', actions: ['import', 'close'] };
      break;
    case 'import': {
      const text = (document.getElementById('modal-textarea') || {}).value || '';
      try {
        engine = Engine.load(fromB64(text));
        engineFromSave = true;
        saveIssue = '';
        activeTab = LAYER_TO_CHAR[engine.s.layer];
        activeSub = 'upgrades';
        app.story = null;
        saveGame();
        say('导入成功');
      } catch (e) {
        say(e && e.code === 'VERSION_MISMATCH'
          ? `导入失败：存档版本不符（找到 ${String(e.found || '未知')}，需要 ${STATE_VERSION}）`
          : `导入失败：${(e && e.message) || '无法解析'}`);
      }
      modal = null;
      break;
    }
    case 'resetOpen':
      modal = { title: '抹除全部进度', text: '这会清空本地存档并从头开始，无法恢复。确定？', textarea: null, actions: ['reset', 'close'] };
      break;
    case 'reset':
      for (const key of [SAVE_KEY, ...LEGACY_KEYS]) localStorage.removeItem(key);
      saveIssue = '';
      engineFromSave = false;
      app.story = null;
      app._ignoreStoryClick = true;
      engine = new Engine(createInitialState());
      engine.startStoryIfFirstRun();
      activeTab = '249';
      activeSub = 'upgrades';
      modal = null;
      saveGame();
      say('已重新开始');
      break;
    case 'close': modal = null; break;
    default: break;
  }
  app.render();
}

// ───────────────────────────── 根组件 ─────────────────────────────
const app = new Vue({
  el: '#app',
  data() {
    return { vm: buildVM(), story: null };
  },
  computed: {
    playTime() { return formatTime(engine.s.stats.playTime || 0); },
    version() { return STATE_VERSION; },
    storyLine() {
      if (!this.story) return '';
      const l = this.story.entry.lines[this.story.idx];
      return typeof l === 'string' ? l : (l && l.text) || '';
    },
    storySpeaker() {
      if (!this.story) return '';
      const l = this.story.entry.lines[this.story.idx];
      if (typeof l === 'string') return this.story.entry.speaker || '';
      return (l && l.speaker) || '';
    },
    storyTitle() { return this.story ? (this.story.entry.title || '') : ''; },
    storyProgress() { return this.story ? `${this.story.idx + 1} / ${this.story.entry.lines.length}` : ''; },
    storyMode() { return this.story && this.story.entry.mode === 'fullscreen' ? 'full' : 'bottom'; },
    subTabs() { return (this.vm.body && this.vm.body.subtabs) || []; },
  },
  methods: {
    render() {
      this.vm = buildVM();
      // 换过引擎实例（导入 / 重置）→ 旧剧情进度作废
      if (this.story && this.story.state && this.story.state !== engine.s) this.story = null;
      if (!this.story && engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0, state: engine.s };
        else engine.finishStory();     // STORY 里找不到该 id：丢弃，避免卡死
      }
      if (this.story && !engine.s.storyActive) this.story = null;
    },
    act,
    go(id) { act('tab', id); },
    toggleGroup(name) { act('groupToggle', name); },
    nextStory() {
      if (!this.story) return;
      if (app._ignoreStoryClick) { app._ignoreStoryClick = false; return; }
      if (this.story.idx + 1 < this.story.entry.lines.length) { this.story.idx++; return; }
      engine.finishStory();
      this.story = null;
      this.render();
    },
  },
  mounted() { this.render(); },
  template: `
    <div id="container" class="container c-old-ui l-old-ui" :class="{ 'is-paused': vm.hud.paused }">
      <!-- ── 顶部 HUD：净化力 / 深渊 / mtc ── -->
      <div class="l-game-header c-game-header">
        <div class="c-header-res">
          <span class="c-header-res__label">净化力</span>
          <span class="c-header-res__value">{{ vm.hud.power }}</span>
        </div>
        <div class="c-header-res c-header-res--mp">
          <span class="c-header-res__label">深渊</span>
          <span class="c-header-res__value">{{ vm.hud.pressure }}</span>
        </div>
        <div class="c-header-res c-header-res--pp">
          <span class="c-header-res__label">mtc</span>
          <span class="c-header-res__value">{{ vm.hud.mtc }}</span>
        </div>
        <div class="c-header-tier">你现在在 {{ vm.hud.layerName }} · 第 {{ vm.hud.layer }} 档 / 共 4 档</div>
        <button class="o-primary-btn c-pause-btn" :class="{ 'c-pause-btn--on': vm.hud.paused }"
          :disabled="vm.hud.finished" @click="act('pause')">
          {{ vm.hud.paused ? '▶ 继续' : '⏸ 暂停' }}
        </button>
      </div>

      <!-- ── 一根条：绿=净化力、红=深渊（都以左端为起点，红在上层）── -->
      <div class="l-abyss-bar">
        <div class="c-bar-row" :class="{ 'is-doomed': vm.hud.danger }">
          <span class="c-bar-row__label">进度</span>
          <div class="c-abyss-bar c-dual-bar">
            <div class="c-dual-bar__power" :style="{ width: vm.hud.powerPct + '%' }"></div>
            <div class="c-dual-bar__pressure" :style="{ width: vm.hud.pressurePct + '%' }"></div>
            <div class="c-dual-bar__text">
              <span class="c-dual-bar__t-power">净化力 {{ vm.hud.powerPctText }}</span>
              <span class="c-dual-bar__t-pressure">深渊 {{ vm.hud.pressurePctText }}</span>
            </div>
          </div>
        </div>
        <div class="c-abyss-info">
          <span>本程 {{ vm.hud.runTime }}</span>
          <span>本层 {{ vm.hud.layerTime }}</span>
          <span>第 {{ vm.hud.runIndex }} 轮</span>
          <span>覆灭 {{ vm.hud.collapses }}</span>
          <span>守护 {{ vm.hud.guards }}</span>
          <span v-if="vm.hud.hits">削减 {{ vm.hud.hits }} 次 · 强化 {{ vm.hud.burstHits }}</span>
          <span>深渊÷净化力 {{ vm.hud.pressureRatioText }}</span>
          <span>MP {{ vm.hud.wallets.mp }} · PP {{ vm.hud.wallets.pp }}</span>
          <span v-if="vm.hud.paused" class="c-paused-tag">已暂停</span>
        </div>
        <div v-if="vm.saveIssue" class="c-save-issue">{{ vm.saveIssue }}</div>
      </div>

      <!-- ── 页签 ── -->
      <div class="l-tab-bar">
        <button v-for="t in vm.tabs" :key="t.id"
          class="o-tab-btn"
          :class="{ 'o-tab-btn--active': t.id === vm.tab }"
          @click="go(t.id)">{{ t.name }}</button>
      </div>

      <!-- ── 角色子页签：升级 / 科技 ── -->
      <div class="c-subtab-button-container" v-if="vm.kind === 'char'" style="margin-top:0.6rem">
        <button v-for="st in subTabs" :key="st.id"
          class="o-tab-btn o-tab-btn--secondary" :class="{ 'o-tab-btn--active': vm.sub === st.id }"
          @click="act('sub', st.id)">{{ st.name }}</button>
        <span class="c-hint">可以手动买；自动购买频率由「科技」页的自动购买科技等级决定</span>
      </div>

      <div class="l-old-ui__page l-tab-page">
        <!-- ═══ 角色页 ═══ -->
        <template v-if="vm.kind === 'char'">
          <div class="l-section-title">
            {{ vm.body.charInfo.name }} · {{ vm.body.charInfo.title }}
            <span class="c-hint">{{ vm.body.charInfo.layerName }}（第 {{ vm.body.charInfo.layer }} 档）</span>
          </div>
          <div class="c-char-stat">
            <span class="c-char-stat__label">产量（内部/秒）</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.production }}</span>
            <span class="c-char-stat__label">一阶</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.first }}</span>
            <span class="c-char-stat__label">二阶</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.second }}</span>
            <span class="c-char-stat__label">互借 share</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.share }}</span>
          </div>
          <div class="c-hint" style="text-align:left;max-width:110rem">{{ vm.body.charInfo.blurb }}</div>

          <!-- 升级：左右两栏（主机制 / 第二机制），只显示已解锁 + 下一个即将解锁 -->
          <template v-if="vm.sub === 'upgrades'">
            <div class="l-section-title l-section-title--buy">
              <span>升级</span>
              <span class="c-hint">手动买单项；「购买最大数量」= 把本 tick 的全自动购买立刻执行一次（不受自动购买科技等级限制）</span>
              <button class="o-primary-btn c-buy-max" @click="act('buyMax')">购买最大数量</button>
            </div>
            <div v-if="!vm.body.items.live" class="c-dim-note c-page-note">{{ vm.body.items.note }}</div>
            <div v-else class="l-upgrade-cols">
              <div v-for="col in vm.body.items.cols" :key="col.kind" class="l-upgrade-col">
                <div class="c-upgrade-col__head">
                  <span class="c-upgrade-col__title">{{ col.title }}</span>
                  <span class="c-hint">{{ col.cards.length }} 项</span>
                </div>
                <div v-for="c in col.cards" :key="c.id" class="c-upgrade-card">
                  <div class="c-upgrade-card__head">
                    <span class="c-upgrade-card__name">{{ c.name }}<span class="c-tag">{{ c.shortId }}</span></span>
                    <span class="c-upgrade-card__level">Lv {{ c.level }}</span>
                  </div>
                  <div class="c-upgrade-card__tags">
                    <span class="c-tag">{{ c.group }}</span>
                    <span v-if="c.old" class="c-tag c-tag--old">旧层重开</span>
                  </div>
                  <div class="c-upgrade-card__effect">{{ c.effect }}</div>
                  <button class="c-buy-btn" :class="c.affordable ? 'is-affordable' : 'is-poor'"
                    @click="act('buyItem', c.index)">
                    <span class="c-buy-btn__label">升级</span>
                    <span class="c-buy-btn__price">{{ c.price }} mtc</span>
                  </button>
                </div>
                <div v-if="col.next" class="c-upgrade-card c-upgrade-card--locked">
                  <div class="c-upgrade-card__head">
                    <span class="c-upgrade-card__name">{{ col.next.name }}<span class="c-tag">{{ col.next.shortId }}</span></span>
                    <span class="c-tag c-tag--lock">即将解锁</span>
                  </div>
                  <div class="c-upgrade-card__tags">
                    <span class="c-tag">{{ col.next.group }}</span>
                  </div>
                  <div class="c-upgrade-card__effect">{{ col.next.mechanism }}</div>
                  <div class="c-upgrade-card__lock">{{ col.next.unlockText }}</div>
                </div>
                <div v-if="!col.cards.length && !col.next" class="c-dim-note c-upgrade-col__empty">
                  这一栏还没有解锁的项
                </div>
              </div>
            </div>
          </template>

          <!-- 科技 -->
          <template v-else-if="vm.sub === 'techs'">
            <div class="l-section-title">科技 <span class="c-hint">自动购买科技用记忆点数（MP）升级；失败永久 F 由覆灭结算自动购买</span></div>
            <div class="l-upgrade-grid">
              <div v-for="t in vm.body.techs" :key="t.id"
                class="c-upgrade-btn c-upgrade-btn--tech" :class="{ 'c-upgrade-btn--owned': t.maxed }">
                <div class="c-upgrade-btn__head">
                  <span>{{ t.name }}</span>
                  <span class="c-upgrade-btn__level">{{ t.levelText }}</span>
                </div>
                <div class="c-upgrade-btn__desc">{{ t.desc }}</div>
                <div class="c-upgrade-btn__preview">{{ t.note }}</div>
                <div class="c-upgrade-btn__cost">{{ t.costText }}</div>
                <button v-if="t.auto && !t.maxed" class="c-buy-btn"
                  :class="t.affordable ? 'is-affordable' : 'is-poor'"
                  @click="act('buyAutoTech', vm.tab)">
                  <span class="c-buy-btn__label">升级</span>
                  <span class="c-buy-btn__price">{{ t.nextCost }} MP</span>
                </button>
                <div v-if="t.auto && t.maxed" class="c-dim-note">满级：每 0.05 秒执行一次「购买最大数量」</div>
              </div>
            </div>
          </template>
        </template>

        <!-- ═══ 守护页（原科技树页签位置）═══ -->
        <template v-else-if="vm.kind === 'guard'">
          <div class="l-section-title">守护（成功永久）<span class="c-hint">四层各一项，等级越高成功占位 B_s 越大</span></div>
          <div class="c-wallet-row">
            <span class="c-wallet">记忆点数 MP（失败钱包）<b>{{ vm.body.guard.wallets.mp }}</b></span>
            <span class="c-wallet c-wallet--pp">守护点数 PP（成功钱包）<b>{{ vm.body.guard.wallets.pp }}</b></span>
          </div>
          <table class="c-stats-table c-guard-table">
            <thead>
              <tr><th>层</th><th>名称</th><th>等级</th><th>下一级价格（PP）</th><th>占位指数</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in vm.body.guard.rows" :key="r.id">
                <td>{{ r.layer }} · {{ r.layerName }}</td>
                <td>{{ r.name }}</td>
                <td>{{ r.level }}</td>
                <td class="c-item-table__price">{{ r.nextCost }}</td>
                <td>{{ r.placeholderExp }}</td>
              </tr>
            </tbody>
          </table>
          <div class="c-dim-note c-page-note">守护点数只用于这四项（数值设计 §7.3 自动兑换）</div>
          <div class="c-page-note c-tree-placeholder">科技树：保留，未解锁（TREE_ENABLED === false）</div>
        </template>

        <!-- ═══ 排行榜 ═══ -->
        <template v-else-if="vm.kind === 'board'">
          <div class="l-section-title">
            排行榜
            <span class="c-dim-note">按「档 → 净化力 → 轮数」排序，每分钟自动上传（服务端白名单字段）</span>
            <button class="o-primary-btn c-board-refresh" @click="act('boardRefresh')">刷新</button>
          </div>
          <div v-if="vm.body.board.note" class="c-dim-note c-board-note">{{ vm.body.board.note }}</div>
          <table class="c-stats-table c-board-table" v-if="vm.body.board.rows.length">
            <thead>
              <tr><th>#</th><th>玩家</th><th>档</th><th>净化力</th><th>轮数</th><th>累计游玩</th><th>通关</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in vm.body.board.rows" :key="'b' + r.rank" :class="{ 'c-board-me': r.name === vm.body.board.myName }">
                <td>{{ r.rank }}</td>
                <td>{{ r.name }}<span v-if="r.name === vm.body.board.myName" class="c-board-tag">你</span></td>
                <td>{{ r.layerText }}</td>
                <td>{{ r.purifiedText }}</td>
                <td>{{ r.cycles }}</td>
                <td>{{ r.timeText }}</td>
                <td>{{ r.won ? '✓' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- ═══ 统计 ═══ -->
        <template v-else-if="vm.kind === 'stats'">
          <div class="l-section-title">本 tick 效果明细</div>
          <table class="c-stats-table c-effect-table">
            <thead><tr><th>字段</th><th>值</th></tr></thead>
            <tbody>
              <tr v-for="(e, i) in vm.body.effects" :key="'fx' + i"><td>{{ e[0] }}</td><td>{{ e[1] }}</td></tr>
            </tbody>
          </table>

          <div class="l-section-title">累计统计</div>
          <div class="c-kv">
            <div v-for="(kv, i) in vm.body.kv" :key="'kv' + i">
              <span class="c-kv__k">{{ kv[0] }}</span> <span class="c-kv__v">{{ kv[1] }}</span>
            </div>
          </div>

          <div class="l-section-title">最近 20 条结算账目</div>
          <div v-if="!vm.body.ledger.length" class="c-dim-note c-page-note">还没有结算记录：突破或覆灭后才会写入账目。</div>
          <table v-else class="c-stats-table c-ledger-table">
            <thead><tr><th>类型</th><th>层</th><th>获得</th><th>花费</th><th>片段时长</th></tr></thead>
            <tbody>
              <tr v-for="e in vm.body.ledger" :key="e.key" :class="'c-ledger--' + e.kind">
                <td>{{ e.kindText }}</td>
                <td>{{ e.layer }} · {{ e.layerName }}</td>
                <td>{{ e.gained }}</td>
                <td>{{ e.spent }}</td>
                <td>{{ e.timeText }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- ═══ 设置 ═══ -->
        <template v-else>
          <div class="l-section-title">游戏</div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('pause')">{{ vm.hud.paused ? '▶ 继续' : '⏸ 暂停' }}</button>
            <button class="o-primary-btn" @click="act('toggleSkipRead')">跳过已读剧情：{{ vm.skipReadStories ? '开' : '关' }}</button>
            <button class="o-primary-btn" @click="act('toggleAutoSettle', 'collapse')">自动覆灭结算：{{ vm.auto.collapse ? '开' : '关' }}</button>
            <button class="o-primary-btn" @click="act('toggleAutoSettle', 'guard')">自动守护结算：{{ vm.auto.guard ? '开' : '关' }}</button>
            <span class="c-dim-note">开启后，看过的剧情不再自动弹出（没看过的照常播放）。自动结算默认关：覆灭/守护都会弹窗，点了才继续。</span>
          </div>

          <div class="l-section-title">玩家</div>
          <div class="l-options-row c-name-row">
            <span class="c-kv__k">用户名</span>
            <input id="name-input" class="o-input c-name-input" maxlength="16" :value="vm.body.net.name" placeholder="2–16 个字符" />
            <button class="o-primary-btn" @click="act('setName')">改名</button>
            <span class="c-dim-note">这个名字会显示在排行榜上，存档按浏览器独立</span>
          </div>
          <div class="c-kv">
            <div><span class="c-kv__k">服务器</span> <span class="c-kv__v">{{ vm.body.net.online ? '已连接（存档每分钟上传）' : '离线（进度只存本地）' }}</span></div>
            <div><span class="c-kv__k">上次同步</span> <span class="c-kv__v">{{ vm.body.net.lastSync }}</span></div>
            <div><span class="c-kv__k">同步状态</span> <span class="c-kv__v">{{ vm.body.net.note }}</span></div>
          </div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('syncNow')">立即同步</button>
          </div>

          <div class="l-section-title">存档</div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('save')">立即保存</button>
            <button class="o-primary-btn" @click="act('export')">导出存档</button>
            <button class="o-primary-btn" @click="act('importOpen')">导入存档</button>
            <button class="o-primary-btn" @click="act('resetOpen')">重新开始</button>
          </div>
          <div class="c-dim-note c-page-note">
            本地键名 <code>{{ vm.saveKey }}</code>，存档版本 <code>{{ vm.stateVersion }}</code>。
            载入顺序：本地 → 服务端；任一份抛 VERSION_MISMATCH 就跳过它继续试下一份。
            旧 v1 档不会被接受（V5 不迁移旧档），需要重新开始。
          </div>
          <div v-if="vm.saveIssue" class="c-save-issue c-page-note">{{ vm.saveIssue }}</div>

          <div class="l-section-title">状态</div>
          <div class="c-kv">
            <div><span class="c-kv__k">所在地</span> <span class="c-kv__v">{{ vm.hud.layerName }}（第 {{ vm.hud.layer }} 档）</span></div>
            <div><span class="c-kv__k">本程时间</span> <span class="c-kv__v">{{ vm.hud.runTime }}</span></div>
            <div><span class="c-kv__k">累计游玩</span> <span class="c-kv__v">{{ playTime }}</span></div>
            <div><span class="c-kv__k">自动保存</span> <span class="c-kv__v">每 10 秒</span></div>
            <div><span class="c-kv__k">版本</span> <span class="c-kv__v">{{ version }}</span></div>
          </div>

          <div class="l-section-title">调试 <span class="c-hint">对外只暴露只读钩子 window.__dny（view / tick / save / metrics），不提供跳时间与改数值的入口</span></div>
          <div class="c-dim-note c-page-note">
            控制台可用 <code>__dny.tick(400)</code> 连跑 400 个 0.05 秒 tick（等价 20Hz），
            <code>__dny.view()</code> 读完整视图模型，<code>__dny.metrics()</code> 读排行榜字段。
          </div>

          <div class="l-section-title">玩法速记</div>
          <div class="c-dim-note c-page-note">
            每 0.05 秒一个 tick：按自动购买科技等级购买（0 级=全手动）→ 产出净化力与 mtc → 深渊随时间上升。
            净化力到突破目标即进下一层；深渊 ÷ 净化力 到 1 即覆灭（回第一层，永久等级保留）。
            剧情播放与暂停时 tick 完全停止。
          </div>
        </template>
      </div>

      <!-- ── 底部状态 ── -->
      <div class="l-status-bar">
        <span>{{ vm.message }}</span>
        <span class="c-dim-note">
          净化力 {{ vm.hud.power }} · 深渊 {{ vm.hud.pressure }} · mtc {{ vm.hud.mtc }} · 压迫 {{ vm.hud.pressureRatioText }}
        </span>
      </div>

      <!-- ── 剧情播放器（全屏 / 底部 1/3）── -->
      <div v-if="story" class="l-story" :class="storyMode === 'full' ? 'l-story--full' : 'l-story--bottom'"
        @click="nextStory">
        <div v-if="storyTitle" class="c-story-title">{{ storyTitle }}</div>
        <div v-if="storySpeaker" class="c-story-speaker">{{ storySpeaker }}</div>
        <div class="c-story-text">{{ storyLine }}</div>
        <div class="c-story-hint">点击继续 · {{ storyProgress }}</div>
      </div>

      <!-- ── 覆灭 / 守护 结算弹窗（默认不自动，点了才继续）── -->
      <div class="l-modal-wrap" v-if="vm.pending && !story" @click.self="act('resolvePending')">
        <div class="c-modal c-modal--pending">
          <div class="c-modal__title">{{ vm.pending.title }}</div>
          <div class="c-pending-row">第 {{ vm.pending.layer }} 层「{{ vm.pending.layerName }}」· 片段 {{ vm.pending.time }}</div>
          <div class="c-pending-row">获得 <b>{{ vm.pending.gained }}</b> {{ vm.pending.walletName }}，自动买到 <b>{{ vm.pending.levelsGained }}</b> 级（余额 {{ vm.pending.walletAfter }}）</div>
          <div class="c-pending-row c-dim-note">{{ vm.pending.next }}</div>
          <div class="l-options-row">
            <button class="o-primary-btn" data-action="resolve" @click="act('resolvePending')">{{ vm.pending.button }}</button>
          </div>
        </div>
      </div>

      <!-- ── 通关面板 ── -->
      <div v-if="vm.hud.finished && !story" class="l-finish">
        <div class="c-finish-box">
          <div class="c-finish-title">通关</div>
          <div class="c-finish-line">第四层「{{ vm.hud.layerName }}」的突破目标已达成，tick 停止。</div>
          <div class="c-finish-line c-dim-note">仍可查看统计与导出存档。</div>
          <div class="l-options-row c-finish-actions">
            <button class="o-primary-btn" @click="act('tab', 'stats')">查看统计</button>
            <button class="o-primary-btn" @click="act('tab', 'options')">存档 / 设置</button>
            <button class="o-primary-btn" @click="act('resetOpen')">重新开始</button>
          </div>
        </div>
      </div>

      <!-- ── 弹窗 ── -->
      <div class="l-modal-wrap" v-if="vm.modal" @click.self="act('close')">
        <div class="c-modal">
          <div class="c-modal__title">{{ vm.modal.title }}</div>
          <div>{{ vm.modal.text }}</div>
          <textarea v-if="vm.modal.textarea !== null" id="modal-textarea" v-model="vm.modal.textarea"></textarea>
          <div class="l-options-row">
            <button v-if="vm.modal.actions.includes('import')" class="o-primary-btn" data-action="import" @click="act('import')">导入</button>
            <button v-if="vm.modal.actions.includes('reset')" class="o-primary-btn" data-action="reset" @click="act('reset')">确认抹除</button>
            <button class="o-primary-btn" data-action="close" @click="act('close')">关闭</button>
          </div>
        </div>
      </div>
    </div>`,
});

// ───────────────────────────── 主循环（固定 20Hz）─────────────────────────────
const DT = 0.05;          // §8：一个 tick = 0.05 秒，绝不按帧率跑数值
let acc = 0;
let last = performance.now();
let lastSave = Date.now();
let uiTimer = 0;
let hookHoldUntil = 0;    // 调试钩子调用后的短暂静默窗口（只冻结自动 tick，不动任何数值）

function frame(now) {
  const real = (now - last) / 1000;
  last = now;
  let dt = Number.isFinite(real) && real > 0 ? real : 0;
  if (dt > 0.5) dt = 0.5;          // 掉帧/切后台不追帧；离线补算只走载入时的 advance
  uiTimer += dt;

  const st = engine.state;
  const holding = now < hookHoldUntil;   // 只给外部断言用，不参与数值
  if (!st.paused && !st.finished && !holding) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 200) { engine.tick(); acc -= DT; n++; }
    if (acc > DT * 200) acc = 0;
  } else {
    acc = 0;                        // 暂停/剧情/通关/静默窗口：不攒时间，恢复后不平推
  }

  if (uiTimer > 0.12) { uiTimer = 0; app.render(); }
  if (Date.now() - lastSave > 10000) { saveGame(); lastSave = Date.now(); }
  requestAnimationFrame(frame);
}

// ───────────────────────────── 启动 ─────────────────────────────
{
  const local = tryLocalSave();          // 1) 本地（v5 键 → 旧 v1 键，版本不符就跳过）
  if (local) {
    engine = local;
    engineFromSave = true;
  } else {
    engine = new Engine(createInitialState());
    engine.startStoryIfFirstRun();
  }
}
app.render();
requestAnimationFrame(frame);
bootServer();                            // 2) 服务端（本地没有可用档时才补拉）
window.addEventListener('beforeunload', saveGame);
setInterval(() => { syncNow(); }, SYNC_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveGame(); syncNow(); }
});

// ───────────────────────────── 调试钩子（只读暴露）─────────────────────────────
// 只给 Playwright / 控制台断言用：tick(n) 就是老老实实连调 n 次 engine.tick()（等价 20Hz），
// 不提供任何「跳时间 / 加速 / 改数值」的入口。
// Vue 生产构建会忽略 Vue.config.async，所以这里手动 flush 渲染 watcher：
// 让 HUD 的 DOM 在同一个同步任务里就等于 engine.view()，外部断言不会读到上一帧的旧值。
function flushViewSync() {
  app.render();
  if (app._watcher) app._watcher.run();
}

window.__dny = {
  get engine() { return engine; },
  view: () => engine.view(),
  tick: (n = 1) => {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    for (let i = 0; i < count; i++) engine.tick();
    // 同步刷视图 + 1.2s 静默窗口（只冻结自动 tick，不跳时间、不改数值）
    hookHoldUntil = performance.now() + 1200;
    flushViewSync();
    return count;
  },
  save: () => engine.save(),
  metrics: () => engine.metrics(),
};
