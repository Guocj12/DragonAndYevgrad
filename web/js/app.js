// web/js/app.js — 龙与耶维城 前端（V8 引擎外壳；AD 壳：Vue 2 + AD 的 styles.css/old-ui.css 类名）
//
// 铁律：
//   ① 本文件**不计算任何数值**。一切数字来自 src/engine.js 的视图模型；
//   ② 数值只在引擎里算。手动买单项 / 「一键买满」（只买当前角色 8 项）都走 src/v8.js 里同一段购买记账；
//   ③ 主循环只用 requestAnimationFrame 累加真实时间，每 0.05 秒调一次 engine.tick()（§11.1）；
//   ④ 存档只走 engine.save() / Engine.load()，版本不符直接拒绝（§11.3 不静默迁移）。
//
// V8 变化：八层 + 终局（stage 9，永不胜）；64 项临时升级；真实量走 Scientific；
// 科技树启用：根 = 自动购买科技（保留），四叶 = 生产效率 / 削减效率 / 成功资源 / 失败资源。

import {
  formatDisplay, formatScientific, formatInteger, formatPrice, formatRatio, formatTime, scaledMtc,
} from '../../src/num.js';
import { Engine, createInitialState, STATE_VERSION } from '../../src/engine.js';
import { TreeView } from './tree.js';
import { treeInterval as treeIntervalOf } from '../../src/tree.js';
import {
  CHARACTERS, CHARACTER_ORDER, TIER_NAMES, ITEM_GROUPS, FAILURE_NAMES, SUCCESS_NAMES, LAYER_TO_CHAR,
  AUTO_MAX_LEVEL, LAYER_MECHANICS,
} from '../../src/db.js';

const SAVE_KEY = 'dny-save-v8';
const SYNC_MS = 60000;
const OFFLINE_CAP = 8 * 3600;

// ───────────────────────────── 数字显示 ─────────────────────────────
const fmt = (v) => formatDisplay(v);                 // 通用：<1 写小数，其余科学计数法
const fmtSci = (v) => formatScientific(v);           // 强制科学计数法（真实量）
const fmtRatio = (v) => formatRatio(v);
const money = (v) => formatInteger(v);               // 钱包 / 整数
const count = (n) => (Number.isSafeInteger(n) && Math.abs(n) < 1e15
  ? n.toLocaleString('en-US') : formatInteger(n));   // 等级（可能上亿）
// mtc 显示：随档乘数（num.js mtcFactorOf）——第 1 层 ×10，第 L 层 ×10^(L+1)；
// 尾数移位，不做 Number 乘法（八层的量级会溢出）。统一走 formatPrice：
// 四舍五入成整数、非 0 至少显示 1（0.00 几的开局收入/价格不再出现）。
const mtcLayer = () => Math.min(engine.s.stage, 8);
const mtcText = (v) => formatPrice(scaledMtc(v, mtcLayer()));
const mtcCost = (v) => formatPrice(scaledMtc(v, mtcLayer()));

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
  if (r.ok) { NET.name = r.data.name; NET.note = '用户名已更新'; app.nameDraft = ''; say(`用户名改为「${r.data.name}」`); }
  else NET.note = (r.data && r.data.error) || '改名失败';
  app.render();
}

// ───────────────────────────── 引擎与存档 ─────────────────────────────
let engine = new Engine(createInitialState());
let message = '';
let treeView = null;
let lastTreeSync = 0;
let modal = null;
let activeTab = '249';
let activeSub = 'upgrades';

function say(msg) { message = msg; }

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: STATE_VERSION, t: Date.now(), s: engine.save() }));
  } catch (e) { /* 忽略配额错误 */ }
}

let saveIssue = '';
let engineFromSave = false;
const LEGACY_KEYS = ['dny-save-v5', 'dny-save-v1'];   // 只用于识别「旧档已跳过」

function noteSaveIssue(from, err) {
  if (err && err.code === 'VERSION_MISMATCH') {
    saveIssue = `旧的 ${String(err.found || '?')} 存档已跳过（V8 不迁移旧档，需重新开始）`;
    console.warn(`${from}存档版本不符（找到 ${String(err.found)}，需要 ${STATE_VERSION}），已跳过`);
  } else {
    saveIssue = `${from}存档已跳过（无法解析）`;
    console.warn(`${from}存档载入失败，已跳过`, err);
  }
}

function adoptSave(text, savedAt, from) {
  const inst = Engine.load(text);
  const elapsed = Math.min(OFFLINE_CAP, Math.max(0, (Date.now() - (Number(savedAt) || Date.now())) / 1000));
  if (elapsed > 5 && !inst.s.paused) {
    try {
      inst.advance(elapsed);
      say(`从${from}存档继续，离线 ${formatTime(elapsed)} 已逐步补算`);
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
      if (key !== SAVE_KEY) saveGame();
      return inst;
    } catch (err) {
      noteSaveIssue('本地', err);
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
    noteSaveIssue('服务器', err);
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
      activeTab = LAYER_TO_CHAR[Math.min(engine.s.stage, 8)];
      saveGame();
    }
  }
  app.render();
}

// ───────────────────────────── 视图模型 ─────────────────────────────
const charStage = (id) => CHARACTERS[id].layer;

function tabsVM(stage) {
  const tabs = CHARACTER_ORDER
    .filter((id) => charStage(id) <= Math.min(stage, 8))
    .map((id) => ({ id, name: CHARACTERS[id].name, kind: 'char' }));
  tabs.push({ id: 'guard', name: '守护', kind: 'guard' });
  tabs.push({ id: 'board', name: '排行榜', kind: 'board' });
  tabs.push({ id: 'stats', name: '统计', kind: 'stats' });
  tabs.push({ id: 'options', name: '设置', kind: 'options' });
  return tabs;
}

function ensureTab(stage) {
  const cur = LAYER_TO_CHAR[Math.min(stage, 8)];
  if (CHARACTER_ORDER.includes(activeTab)) {
    if (activeTab === cur) return activeTab;
    if (charStage(activeTab) > Math.min(stage, 8)) activeTab = cur;
    return activeTab;
  }
  if (!['guard', 'board', 'stats', 'options'].includes(activeTab)) activeTab = cur;
  return activeTab;
}

function hudVM() {
  const v = engine.view();
  return {
    power: fmt(v.force),
    pressure: fmt(v.pressureForce),
    mtc: mtcText(v.wallet),
    stage: v.stage,
    stageName: v.stageName,
    endgame: v.endgame,
    charId: v.charId,
    mechanic: v.layerMechanic,
    runTime: formatTime(v.runTime),
    stageTime: formatTime(v.stageTime),
    runIndex: v.runIndex,
    collapses: v.stats.collapses,
    guards: v.stats.guards,
    hits: v.hits,
    burstHits: v.burstHits,
    releases: v.releases,
    savedTicks: v.savedTicks,
    target: fmt(v.targetForce),
    powerPct: (v.powerPct * 100).toFixed(2),
    pressurePct: (v.pressurePct * 100).toFixed(2),
    powerPctText: `${(v.powerPct * 100).toFixed(2)}%`,
    pressurePctText: `${(v.pressurePct * 100).toFixed(2)}%`,
    pressureRatioText: `深渊压迫 ${(v.pressureRatio * 100).toFixed(v.pressureRatio < 0.1 ? 1 : 0)}%`,
    danger: v.pressureRatio >= 0.8,
    paused: !!v.paused,
    wallets: { mp: money(v.wallets.mp), pp: money(v.wallets.pp) },
    pendingKind: v.pending ? v.pending.kind : null,
    mpRaw: v.wallets.mp,
    autoLv: v.autoBuyLv[v.charId] || 0,
  };
}

// 机制面板：五层没有新状态；六层起蓄能，七层起缓冲，八层起侵蚀
function mechVM() {
  const v = engine.view();
  const stage = Math.min(v.stage, 8);
  return {
    stage,
    showEnergy: stage >= 6,
    showBuffer: stage >= 7,
    showErosion: stage >= 8,
    energy: fmtDisplaySmall(v.energy),
    residual: fmtDisplaySmall(v.residual),
    lastRelease: v.lastRelease < 0 ? '—' : formatTime(v.lastRelease * 0.05),
    buffer: fmtDisplaySmall(v.buffer),
    emergency: fmtDisplaySmall(v.emergency),
    bufferSpent: fmtDisplaySmall(v.bufferSpent),
    savedTicks: v.savedTicks,
    erosion: fmtDisplaySmall(v.erosion),
    fatigue: fmtDisplaySmall(v.fatigue),
    releases: v.releases,
  };
}

const fmtDisplaySmall = (x) => (Number.isFinite(x) ? formatDisplay(x) : '—');

function pendingVM() {
  const v = engine.view();
  if (!v.pending) return null;
  const p = v.pending;
  const pv = p.preview || {};
  const isGuard = p.kind === 'guard';
  const lines = (pv.levels || []).map((l) => `${l.name} Lv ${count(l.from)} → ${count(l.to)}`);
  return {
    kind: p.kind,
    guard: isGuard,
    title: isGuard ? '深渊已清零 · 守护' : '深渊已追平 · 覆灭',
    stage: p.stage,
    stageName: TIER_NAMES[p.stage - 1],
    time: formatTime(p.time),
    gained: money(pv.gained || 0),
    walletAfter: money(pv.walletAfter || 0),
    levelsGained: count(pv.levelsGained || 0),
    lines,
    walletName: isGuard ? '守护点数' : '记忆点数',
    autoNote: engine.permAutoBuyEnabled()
      ? ''
      : '未解锁自动购买：这笔钱先存着，去「249 → 科技树」买「自动化中枢」Lv1 才会自动花，或在科技页手动升级',
    next: isGuard
      ? (p.stage === 8 ? '八层全部守护：结算后进入终局（终局永不胜，只判失败）'
        : `结算后进入第 ${p.stage + 1} 层「${TIER_NAMES[p.stage]}」`)
      : (p.stage === 9 ? '终局失败：结算后回到第 1 层「奶茶店」'
        : '结算后回到第 1 层「奶茶店」'),
    button: isGuard ? '净化结算' : '覆灭结算',
  };
}

function itemsVM(charId) {
  const curStage = engine.s.stage;
  const owner = charStage(charId);
  if (owner > Math.min(curStage, 8)) {
    return { live: false, cols: [], note: '这个角色还没遇到。' };
  }
  const all = engine.items();
  const list = all.filter((it) => it.owner === owner);
  const nextIdx = list.findIndex((it) => !it.unlocked);
  const toCard = (it) => {
    const effect = it.level > 0 ? engine.itemEffect(it) : engine.itemMechanism(it);
    let effectNextShort = null;
    if (it.unlocked && it.level > 0) {
      const next = engine.itemEffectAt(it, it.effective + 1 / it.density);
      if (next !== effect) {
        const term = /^[^×+]*/.exec(effect)[0];
        effectNextShort = term && next.startsWith(term) ? next.slice(term.length) : next;
      }
    }
    return {
      index: it.index,
      id: it.id,
      name: it.name,
      kind: it.kind,
      owner: it.owner,
      level: count(it.level),
      unlocked: !!it.unlocked,
      price: mtcCost(it.price),
      affordable: !!it.affordable,
      effect,
      effectNextShort,
      mechanism: engine.itemMechanism(it),
      unlockText: engine.itemUnlockText(it),
    };
  };
  const cards = list.map(toCard);
  const unlocked = cards.filter((c) => c.unlocked);
  const nextCard = nextIdx >= 0 ? cards[nextIdx] : null;
  const cols = [0, 1].map((kind) => ({
    kind,
    title: CHARACTERS[charId].groups[kind],
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

function techsVM(charId) {
  const stage = charStage(charId);
  const permAuto = engine.permAutoBuyEnabled();
  return engine.techs(stage).map((t) => {
    const auto = t.kind === 'autoBuy';
    if (auto) {
      return {
        id: t.id, name: t.name, kind: t.kind, desc: t.desc,
        levelText: `Lv ${count(t.level)} / ${t.maxLevel}`,
        note: t.level > 0
          ? t.effect
          : '0 级不自动购买（升到 1 级起才会按上面的间隔自动买升级项）',
        costText: t.maxed ? '已满级：每 0.05 秒购买所有可买项'
          : `升级需要 ${money(t.nextCost)} 记忆点数`,
        auto: true, maxed: !!t.maxed, affordable: !!t.affordable, nextCost: money(t.nextCost),
      };
    }
    return {
      id: t.id, name: t.name, kind: t.kind, desc: t.desc, stage: t.stage,
      levelText: `Lv ${count(t.level)}`,
      note: permAuto
        ? '科技树 Lv1 已解锁：覆灭/守护结算时自动购买（也可以现在手动买）'
        : '结算不再自动购买：手动买，或在科技树买「自动化中枢」Lv1 解锁',
      costText: `下一级 ${money(t.nextCost)} 记忆点数`,
      auto: false, maxed: false, affordable: !!t.affordable, nextCost: money(t.nextCost),
    };
  });
}

function guardVM() {
  const w = engine.permanent;
  return {
    wallets: { mp: money(w.failureWallet), pp: money(w.successWallet) },
    rows: engine.successes().map((s) => ({
      id: s.id, name: s.name, desc: s.desc,
      level: count(s.level), nextCost: money(s.nextCost),
    })),
    failures: FAILURE_NAMES.map((f, i) => ({
      id: f.id, name: f.name, effect: f.effect, level: count(w.failure[i]),
    })),
  };
}

// totals 的 16 个分量按「层 · 机制」取名字：[a,b,c,d,...] 两两一对正好对应 1–8 层的两个机制
const totalsLabel = (i) => `${TIER_NAMES[Math.floor(i / 2)]} · ${ITEM_GROUPS[Math.floor(i / 2) + 1][i % 2]}`;

function statsVM() {
  const b = engine.bonuses();
  const v = engine.view();
  const st = engine.state.stats;
  const production = [
    ['实际产量（净化力/秒）', fmtDisplaySmall(b.production)],
    ['基础产量', fmtDisplaySmall(b.rawP)],
    ['奶茶产量（第一条生产线）', fmtDisplaySmall(b.first)],
    ['事务产量（第二条生产线）', fmtDisplaySmall(b.second)],
    ['产量互借比例', fmtRatio(b.share)],
    ['全局效率', fmtRatio(b.global)],
    ['永久科技产量加成', fmtDisplaySmall(b.productionMultiplier)],
    ['产量同步补强', fmtRatio(b.sp)],
  ];
  const attack = [
    ['理论削减（深渊/秒）', fmtDisplaySmall(b.nominalD)],
    ['单次攻击力', fmtDisplaySmall(b.hit)],
    ['攻击频率（次/秒）', fmtRatio(b.frequency)],
    ['强击倍率（每第 5 次攻击）', fmtRatio(b.burst)],
    ['超频转化（频率超出 20 的部分）', fmtRatio(b.overflow)],
    ['永久科技攻击加成', fmtDisplaySmall(b.suppressionMultiplier)],
    ['削减同步补强', fmtRatio(b.sd)],
    ['攻击总倍率', fmtDisplaySmall(b.actionMultiplier)],
    ['时间加成（随本程时间）', fmtRatio(b.time)],
    ['同步回馈', fmtRatio(b.feedback)],
  ];
  const resource = [
    ['奶茶币转化率', fmtRatio(b.conversion)],
    ['攻击回收率', fmtRatio(b.salvage)],
    ['奶茶币收入（奶茶币/秒）', mtcText(v.income)],
  ];
  const totals = v.totals.map((x, i) => [totalsLabel(i), fmtDisplaySmall(x)]);
  const ledger = engine.state.ledger.slice(-20).reverse().map((e, i) => ({
    key: `${e.kind}-${e.stage}-${e.runTicks}-${i}`,
    kindText: e.kind === 'success' ? '守护（成功）' : '覆灭（失败）',
    kind: e.kind,
    stage: e.stage,
    stageName: TIER_NAMES[e.stage - 1],
    gained: money(e.gained),
    spent: money(e.spent || 0),
    timeText: formatTime(e.time || 0),
  }));
  return {
    production, attack, resource,
    totals,
    ledger,
    kv: [
      ['累计游玩', formatTime(st.playTime || 0)],
      ['总步数（0.05 秒一步）', count(st.ticks || 0)],
      ['总轮数', count(st.runs || 0)],
      ['守护次数', count(st.guards || 0)],
      ['覆灭次数', count(st.collapses || 0)],
      ['进入终局次数', count(st.endgames || 0)],
      ['各层覆灭', (st.failures || []).join(' / ')],
      ['各层守护', (st.guardsByStage || []).join(' / ')],
      ['蓄能释放次数', count(st.releases || 0)],
      ['缓冲救场步数', count(st.bufferSaved || 0)],
      ['历史最高净化力', `1e${Number(st.bestPowerLog || 0).toFixed(2)}`],
      ['累计清除深渊', fmtSci(v.cleared)],
      ['本层清除深渊', fmtSci(v.clearedStage)],
    ],
  };
}

function boardVM() {
  return {
    rows: boardRows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      stageText: r.tier >= 8 ? '终局' : (TIER_NAMES[r.tier] || `第 ${Number(r.tier) + 1} 层`),
      purifiedText: Number.isFinite(r.purified) && r.purified > 0 ? `1e${r.purified.toFixed(2)}` : '1',
      cycles: r.cycles,
      guards: r.guards,
      timeText: formatTime(r.playTime),
      endgame: r.tier >= 8,
    })),
    note: boardNote,
    myName: NET.name,
  };
}

function buildVM() {
  const stage = engine.s.stage;
  const tab = ensureTab(stage);
  const tabs = tabsVM(stage);
  const kind = CHARACTER_ORDER.includes(tab) ? 'char' : tab;
  const body = {};

  if (kind === 'char') {
    // 每个角色两个标签：升级（该角色 8 项）/ 科技（自动购买 + 该角色专属永久升级）
    // 只有 249 多一个「科技树」（全局：根 = 自动购买，四叶 = 四个成功科技）
    const subtabs = [{ id: 'upgrades', name: '升级' }, { id: 'techs', name: '科技' }];
    if (CHARACTERS[tab].hasTree) subtabs.push({ id: 'tree', name: '科技树' });
    if (!subtabs.some((t) => t.id === activeSub)) activeSub = 'upgrades';
    const b = engine.bonuses();
    const v = engine.view();
    body.charInfo = {
      name: CHARACTERS[tab].name,
      title: CHARACTERS[tab].title,
      blurb: CHARACTERS[tab].blurb,
      production: fmtDisplaySmall(b.production),
      hit: fmtDisplaySmall(b.hit),
      frequency: fmtRatio(b.frequency),
      income: mtcText(v.income),
      showAttack: engine.s.stage >= 3,
      isCurrent: charStage(tab) === Math.min(stage, 8),
      stage: charStage(tab),
      stageName: TIER_NAMES[charStage(tab) - 1],
      mechanic: LAYER_MECHANICS[charStage(tab)],
    };
    body.subtabs = subtabs;
    body.items = activeSub === 'upgrades' ? itemsVM(tab) : null;
    body.techs = activeSub === 'techs' ? techsVM(tab) : null;
    body.treeHost = activeSub === 'tree';
    body.treeCenter = engine.s.tree.center || 0;
    body.treeIntervalText = (() => {
      const iv = treeIntervalOf(engine.s.tree.center || 0);
      return Number.isFinite(iv) ? `${iv} 秒` : '—';
    })();
    body.canUpgradeAuto = activeSub === 'techs';
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
    // 累计游玩走 buildVM 现算：computed 读不到响应式依赖，会冻结在首次打开设置页的值
    body.playTimeText = formatTime(engine.s.stats.playTime || 0);
    body.debugJumps = engine.debugJumpList().map((d) => ({
      ...d,
      title: `第 ${d.run} 轮 · 记忆点数 ${money(d.mp)} / 守护点数 ${money(d.pp)}`,
    }));
  }

  return {
    kind, tab, sub: activeSub, tabs, body,
    hud: hudVM(),
    mech: mechVM(),
    message,
    modal,
    pending: pendingVM(),
    auto: Object.assign({ collapse: false, guard: false }, engine.s.auto || {}),
    saveIssue,
    skipReadStories: !!(engine.s.settings && engine.s.settings.skipReadStories),
    saveKey: SAVE_KEY,
    stateVersion: STATE_VERSION,
    storyActive: !!engine.s.storyActive,
    autoMaxLevel: AUTO_MAX_LEVEL,
  };
}

// ───────────────────────────── 动作 ─────────────────────────────
function toB64(text) { return btoa(unescape(encodeURIComponent(text))); }
function fromB64(b64) { return decodeURIComponent(escape(atob(String(b64).trim()))); }

/** 调试跳层：整份存档换成「首次抵达该层」的检查点（src/debug.js），设置页与控制台共用 */
function performDebugJump(stage) {
  const entry = engine.debugJumpTo(Number(stage));
  if (!entry) { say(`调试跳层失败：没有第 ${Number(stage) - 1} 层的入口数据`); return null; }
  app.story = null;
  app._ignoreStoryClick = true;
  activeTab = LAYER_TO_CHAR[Math.min(engine.s.stage, 8)];
  activeSub = 'upgrades';
  saveGame();
  say(`已进入「${TIER_NAMES[entry.stage - 1]}」初始存档：第 ${entry.run} 轮 · `
    + `记忆点数 ${money(entry.permanent.failureWallet)} / 守护点数 ${money(entry.permanent.successWallet)}`);
  return entry;
}

function act(action, payload) {
  switch (action) {
    case 'tab':
      activeTab = payload;
      if (payload === 'board') loadBoard();
      break;
    case 'sub':
      activeSub = payload;
      break;
    case 'buyItem': {
      const it = engine.items()[payload];
      const name = it ? it.name : `#${payload}`;
      if (engine.buyItem(payload)) say(`「${name}」升级成功`);
      else say(`「${name}」买不起：奶茶币不够下一级的价格`);
      break;
    }
    case 'buyAutoTech': {
      const info = engine.autoBuyInfo(payload);
      if (engine.buyAutoTech(payload)) {
        say(`自动购买科技升到 Lv ${info.level + 1}：${engine.autoBuyInfo(payload).effect}`);
      } else {
        say(info.level >= info.maxLevel ? `自动购买科技已满级（${AUTO_MAX_LEVEL} 级）` : `记忆点数不够：需要 ${info.nextCost}`);
      }
      break;
    }
    case 'resolvePending': {
      const p = engine.s.pending;
      const ev = engine.resolvePending();
      if (ev) {
        const tail = ev.kind === 'success'
          ? `${SUCCESS_NAMES.map((s, i) => `${s.name} Lv${ev.after.success[i]}`).join(' · ')}`
          : `${FAILURE_NAMES[ev.owner - 1].name} Lv${ev.after.failure[ev.owner - 1]}`;
        say(ev.kind === 'success'
          ? `守护结算：获得 ${ev.gained} 守护点数（${tail}）`
          : `覆灭结算：获得 ${ev.gained} 记忆点数（${tail}）`);
      } else if (p) say('结算失败：没有待结算片段');
      break;
    }
    case 'toggleAutoSettle': {
      const kind = payload === 'guard' ? 'guard' : 'collapse';
      engine.s.auto[kind] = !engine.s.auto[kind];
      say(`${kind === 'guard' ? '自动守护' : '自动覆灭'}已${engine.s.auto[kind] ? '开启（结算不弹窗）' : '关闭（结算弹窗等你点）'}`);
      break;
    }
    case 'buyFailureTech': {
      const stage = Number(payload);
      if (engine.buyFailureTech(stage)) {
        say(`专属永久升级升到 Lv ${engine.permanent.failure[stage - 1]}`);
      } else say('记忆点数不够下一级的价格');
      break;
    }
    case 'treeBuy': {
      const r = engine.buyTreeNode(payload);
      say(r.msg);
      if (r.ok && treeView) treeView.sync(engine);
      break;
    }
    case 'treeFit': if (treeView) treeView.fitTree(); break;
    case 'buyMax': {
      const who = payload && CHARACTERS[payload] ? CHARACTERS[payload].name : '';
      const n = engine.buyMaxOnce(payload);
      say(n > 0
        ? `一键买满：${who || '本层'} 买了 ${count(n)} 级（只动这 8 项）`
        : `${who || '本层'} 的 8 项都买不起：mtc 不够`);
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
      const name = ((app.nameDraft || (el && el.value) || '') + '').trim();
      if (name.length >= 2) renameSelf(name);
      else say('用户名需要 2–16 个字符');
      break;
    }
    case 'save': saveGame(); say('已保存到本地（服务端按分钟同步）'); break;
    case 'export': {
      const b64 = toB64(engine.save());
      modal = { title: '导出存档', text: `已生成 Base64 存档（版本 ${STATE_VERSION}），已尝试复制到剪贴板。`, textarea: b64, actions: ['close'] };
      try { navigator.clipboard && navigator.clipboard.writeText(b64); } catch (e) { /* 忽略 */ }
      break;
    }
    case 'importOpen':
      modal = { title: '导入存档', text: `粘贴 Base64 存档后点「导入」。只接受 ${STATE_VERSION} 版本。`, textarea: '', actions: ['import', 'close'] };
      break;
    case 'import': {
      const text = (document.getElementById('modal-textarea') || {}).value || '';
      try {
        engine = Engine.load(fromB64(text));
        engineFromSave = true;
        saveIssue = '';
        activeTab = LAYER_TO_CHAR[Math.min(engine.s.stage, 8)];
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
    case 'debugJumpOpen': {
      const stage = Number(payload);
      const info = engine.debugJumpList().find((d) => d.stage === stage);
      modal = {
        title: `调试：进入「${TIER_NAMES[stage - 1]}」初始存档`,
        text: `层号 ${stage - 1}（${TIER_NAMES[stage - 1]}${stage === 9 ? ' · 终局' : ''}）首次抵达时的检查点：`
          + `第 ${info ? info.run : '?'} 轮 · 记忆点数 ${info ? money(info.mp) : '?'} / 守护点数 ${info ? money(info.pp) : '?'}`
          + `（docs/数值设计.md §12，由 tools/gen-debug-jumps.mjs 生成）。`
          + `自动购买科技保持 0 级（临时升级全部手动买）。当前进度会被覆盖——需要保留请先「导出存档」。确定进入？`,
        textarea: null, actions: ['debugJump', 'close'], payload: stage,
      };
      break;
    }
    case 'debugJump': {
      const stage = modal && modal.payload;
      modal = null;
      performDebugJump(stage);
      break;
    }
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
    return { vm: buildVM(), story: null, nameDraft: '' };
  },
  computed: {
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
      if (this.story && this.story.state && this.story.state !== engine.s) this.story = null;
      if (!this.story && engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0, state: engine.s };
        else engine.finishStory();
      }
      if (this.story && !engine.s.storyActive) this.story = null;
    },
    act,
    go(id) { act('tab', id); },
    syncTree() {
      const show = !!(this.vm.body && this.vm.body.treeHost);
      if (!show) {
        // 离开科技树页：立刻销毁画布，别让它被 Vue 复用进别的页面
        if (treeView) { treeView.detach(); treeView = null; lastTreeSync = 0; }
        return;
      }
      const host = this.$refs && this.$refs.treeHost;
      if (!host) return;
      const now = performance.now();
      if (now - lastTreeSync < 250) return;
      lastTreeSync = now;
      if (!treeView) treeView = new TreeView(host, { getEngine: () => engine, onBuy: (id) => act('treeBuy', id) });
      else treeView.attach(host);
      treeView.sync(engine);
    },
    nextStory() {
      if (!this.story) return;
      if (app._ignoreStoryClick) { app._ignoreStoryClick = false; return; }
      if (this.story.idx + 1 < this.story.entry.lines.length) { this.story.idx++; return; }
      engine.finishStory();
      this.story = null;
      this.render();
    },
  },
  mounted() { this.render(); this.syncTree(); },
  updated() { this.syncTree(); },
  template: `
    <div id="container" class="container c-old-ui l-old-ui" :class="{ 'is-paused': vm.hud.paused }">
      <!-- ── 顶部 HUD：净化力 / 深渊 / 奶茶币 ── -->
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
          <span class="c-header-res__label">奶茶币</span>
          <span class="c-header-res__value">{{ vm.hud.mtc }}</span>
        </div>
        <div class="c-header-tier">
          <template v-if="vm.hud.endgame">
            <span class="c-tag c-tag--endgame">终局</span> {{ vm.hud.stageName }}（永不胜 · 只判失败）
          </template>
          <template v-else>第 {{ vm.hud.stage }} / 8 层「{{ vm.hud.stageName }}」</template>
        </div>
        <button class="o-primary-btn c-pause-btn" :class="{ 'c-pause-btn--on': vm.hud.paused }"
          @click="act('pause')">
          {{ vm.hud.paused ? '▶ 继续' : '⏸ 暂停' }}
        </button>
      </div>

      <!-- ── 一根条：绿=净化力、红=深渊 ── -->
      <div class="l-abyss-bar">
        <div class="c-bar-row" :class="{ 'is-doomed': vm.hud.danger }">
          <div class="c-abyss-bar c-dual-bar">
            <div class="c-dual-bar__power" :style="{ width: vm.hud.powerPct + '%' }"></div>
            <div class="c-dual-bar__pressure" :style="{ width: vm.hud.pressurePct + '%' }"></div>
            <div class="c-dual-bar__text">
              <span class="c-dual-bar__t-power">净化 {{ vm.hud.powerPctText }}</span>
              <span class="c-dual-bar__t-pressure">深渊 {{ vm.hud.pressurePctText }}</span>
            </div>
          </div>
        </div>
        <div class="c-abyss-info">
          <span>目标 {{ vm.hud.target }}</span>
          <span :class="{ 'c-paused-tag': vm.hud.danger }">{{ vm.hud.pressureRatioText }}</span>
        </div>
        <div v-if="vm.saveIssue" class="c-save-issue">{{ vm.saveIssue }}</div>
      </div>

      <!-- ── 机制状态（六层起）── -->
      <div class="c-mech-row" v-if="vm.mech.showEnergy">
        <span>蓄能 {{ vm.mech.energy }}</span>
        <span>余能 {{ vm.mech.residual }}</span>
        <template v-if="vm.mech.showBuffer">
          <span>缓冲 {{ vm.mech.buffer }}</span>
          <span>应急 {{ vm.mech.emergency }}</span>
        </template>
        <template v-if="vm.mech.showErosion">
          <span>侵蚀 {{ vm.mech.erosion }}</span>
          <span>疲劳 {{ vm.mech.fatigue }}</span>
        </template>
      </div>

      <!-- ── 页签 ── -->
      <div class="l-tab-bar">
        <button v-for="t in vm.tabs" :key="t.id"
          class="o-tab-btn"
          :class="{ 'o-tab-btn--active': t.id === vm.tab }"
          @click="go(t.id)">{{ t.name }}</button>
      </div>

      <!-- ── 角色子页签：升级 / 科技树 ── -->
      <div class="c-subtab-button-container" v-if="vm.kind === 'char'" style="margin-top:0.6rem">
        <button v-for="st in subTabs" :key="st.id"
          class="o-tab-btn o-tab-btn--secondary" :class="{ 'o-tab-btn--active': vm.sub === st.id }"
          @click="act('sub', st.id)">{{ st.name }}</button>
      </div>

      <div class="l-old-ui__page l-tab-page">
        <!-- ═══ 角色页 ═══ -->
        <template v-if="vm.kind === 'char'">
          <div class="l-section-title">
            {{ vm.body.charInfo.name }} · {{ vm.body.charInfo.title }}
            <span class="c-hint">{{ vm.body.charInfo.mechanic }}</span>
          </div>
          <div class="c-char-stat">
            <span class="c-char-stat__label">产量</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.production }}/秒</span>
            <template v-if="vm.body.charInfo.showAttack">
              <span class="c-char-stat__label">攻击力</span>
              <span class="c-char-stat__value">{{ vm.body.charInfo.hit }}</span>
              <span class="c-char-stat__label">攻击频率</span>
              <span class="c-char-stat__value">{{ vm.body.charInfo.frequency }}/秒</span>
            </template>
            <span class="c-char-stat__label">奶茶币收入</span>
            <span class="c-char-stat__value">+{{ vm.body.charInfo.income }}/秒</span>
          </div>
          <div v-if="vm.body.charInfo.blurb" class="c-hint" style="text-align:left;max-width:110rem">{{ vm.body.charInfo.blurb }}</div>

          <!-- 升级：左右两栏，每项一行 -->
          <template v-if="vm.sub === 'upgrades'">
            <div class="l-section-title l-section-title--buy">
              <span>升级</span>
              <button class="o-primary-btn c-buy-max" @click="act('buyMax', vm.tab)">一键买满（{{ vm.body.charInfo.name }}）</button>
            </div>
            <div v-if="!vm.body.items.live" class="c-dim-note c-page-note">{{ vm.body.items.note }}</div>
            <div v-else class="l-upgrade-cols">
              <div v-for="col in vm.body.items.cols" :key="col.kind" class="l-upgrade-col">
                <div class="c-upgrade-col__head">
                  <span class="c-upgrade-col__title">{{ col.title }}</span>
                </div>
                <div v-for="c in col.cards" :key="c.id" class="c-upgrade-card">
                  <div class="c-upgrade-card__info">
                    <div class="c-upgrade-card__head">
                      <span class="c-upgrade-card__name">{{ c.name }}</span>
                      <span class="c-upgrade-card__level">Lv {{ c.level }}</span>
                    </div>
                    <div class="c-upgrade-card__effect">{{ c.effect }}<span v-if="c.effectNextShort" class="c-upgrade-card__next">→ {{ c.effectNextShort }}</span></div>
                  </div>
                  <button class="c-buy-btn" :class="c.affordable ? 'is-affordable' : 'is-poor'"
                    title="买一级" @click="act('buyItem', c.index)">
                    <span class="c-buy-btn__price">{{ c.price }} 奶茶币</span>
                  </button>
                </div>
                <div v-if="col.next" class="c-upgrade-card c-upgrade-card--locked">
                  <div class="c-upgrade-card__info">
                    <div class="c-upgrade-card__head">
                      <span class="c-upgrade-card__name">{{ col.next.name }}</span>
                    </div>
                    <div class="c-upgrade-card__effect">{{ col.next.mechanism }}</div>
                    <div class="c-upgrade-card__lock">{{ col.next.unlockText }}</div>
                  </div>
                </div>
                <div v-if="!col.cards.length && !col.next" class="c-dim-note c-upgrade-col__empty">
                  这一栏还没有解锁的项
                </div>
              </div>
            </div>
          </template>

          <!-- 科技：自动购买 + 该角色专属永久升级（记忆点数） -->
          <template v-else-if="vm.sub === 'techs'">
            <div class="l-section-title">科技</div>
            <div class="l-upgrade-grid l-tech-grid">
              <div v-for="t in vm.body.techs" :key="t.id" class="c-upgrade-btn c-upgrade-btn--tech">
                <div class="c-upgrade-btn__info">
                  <div class="c-upgrade-btn__head">
                    <span>{{ t.name }}</span>
                    <span class="c-upgrade-btn__level">{{ t.levelText }}</span>
                  </div>
                  <div class="c-upgrade-btn__desc">{{ t.desc }}</div>
                  <div class="c-upgrade-btn__preview">{{ t.note }}</div>
                  <div v-if="!t.auto" class="c-upgrade-btn__cost">{{ t.costText }}</div>
                </div>
                <button v-if="t.auto && !t.maxed" class="c-buy-btn"
                  :class="t.affordable ? 'is-affordable' : 'is-poor'"
                  title="升一级" @click="act('buyAutoTech', vm.tab)">
                  <span class="c-buy-btn__label">升级</span>
                  <span class="c-buy-btn__price">{{ t.nextCost }} 记忆点数</span>
                </button>
                <button v-if="!t.auto" class="c-buy-btn"
                  :class="t.affordable ? 'is-affordable' : 'is-poor'"
                  title="升一级" @click="act('buyFailureTech', t.stage)">
                  <span class="c-buy-btn__label">手动升级</span>
                  <span class="c-buy-btn__price">{{ t.nextCost }} 记忆点数</span>
                </button>
                <span v-if="t.auto && t.maxed" class="c-dim-note">已满级</span>
              </div>
            </div>
            <div class="c-wallet-row">
              <span class="c-wallet">记忆点数（覆灭结算获得）<b>{{ vm.hud.wallets.mp }}</b></span>
              <span class="c-wallet c-wallet--pp">守护点数（守护结算获得）<b>{{ vm.hud.wallets.pp }}</b></span>
            </div>
          </template>

          <!-- 科技树（只有 249 有这一页）：中心 = 自动化中枢，主干 = 四项永久科技 -->
          <template v-else>
            <div class="l-section-title">
              科技树
              <span class="c-hint">
                中心是自动化中枢；四条主干是全局永久科技（产量 / 攻击 / 守护点数 / 记忆点数）
              </span>
              <button class="o-primary-btn c-board-refresh" @click="act('treeFit')">适配视图</button>
            </div>
            <div ref="treeHost" key="tech-tree-host" class="c-tree-host"></div>
            <div class="c-wallet-row">
              <span class="c-wallet">记忆点数（覆灭结算获得）<b>{{ vm.hud.wallets.mp }}</b></span>
              <span class="c-wallet c-wallet--pp">守护点数（守护结算获得）<b>{{ vm.hud.wallets.pp }}</b></span>
              <span class="c-dim-note">中枢 Lv {{ vm.body.treeCenter }} · 每 {{ vm.body.treeIntervalText }} 自动执行一次</span>
            </div>
            <div class="c-dim-note c-page-note">
              点击节点购买；主干需先购买「自动化中枢」。叶子与角色节点为占位，无效果。
            </div>
          </template>
        </template>

        <!-- ═══ 永久科技（守护页） ═══ -->
        <template v-else-if="vm.kind === 'guard'">
          <div class="l-section-title">永久科技
            <span class="c-hint">结算后自动购买，永不重置</span>
          </div>
          <div class="c-wallet-row">
            <span class="c-wallet">记忆点数（覆灭结算获得）<b>{{ vm.body.guard.wallets.mp }}</b></span>
            <span class="c-wallet c-wallet--pp">守护点数（守护结算获得）<b>{{ vm.body.guard.wallets.pp }}</b></span>
          </div>
          <table class="c-stats-table c-guard-table">
            <thead>
              <tr><th>名称</th><th>效果</th><th>等级</th><th>下一级价格（守护点数）</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in vm.body.guard.rows" :key="r.id">
                <td>{{ r.name }}</td>
                <td class="c-dim-note">{{ r.desc }}</td>
                <td>{{ r.level }}</td>
                <td class="c-item-table__price">{{ r.nextCost }}</td>
              </tr>
            </tbody>
          </table>
          <div class="l-section-title">覆灭永久（记忆点数购买，永不重置）</div>
          <table class="c-stats-table">
            <thead><tr><th>名称</th><th>等级</th><th>效果</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in vm.body.guard.failures" :key="f.id">
                <td>{{ f.name }}</td>
                <td>{{ f.level }}</td>
                <td class="c-dim-note">{{ f.effect }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- ═══ 排行榜 ═══ -->
        <template v-else-if="vm.kind === 'board'">
          <div class="l-section-title">
            排行榜
            <button class="o-primary-btn c-board-refresh" @click="act('boardRefresh')">刷新</button>
          </div>
          <div v-if="vm.body.board.note" class="c-dim-note c-board-note">{{ vm.body.board.note }}</div>
          <table class="c-stats-table c-board-table" v-if="vm.body.board.rows.length">
            <thead>
              <tr><th>#</th><th>玩家</th><th>层</th><th>净化力</th><th>轮数</th><th>守护</th><th>累计游玩</th><th>终局</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in vm.body.board.rows" :key="'b' + r.rank" :class="{ 'c-board-me': r.name === vm.body.board.myName }">
                <td>{{ r.rank }}</td>
                <td>{{ r.name }}<span v-if="r.name === vm.body.board.myName" class="c-board-tag">你</span></td>
                <td>{{ r.stageText }}</td>
                <td>{{ r.purifiedText }}</td>
                <td>{{ r.cycles }}</td>
                <td>{{ r.guards }}</td>
                <td>{{ r.timeText }}</td>
                <td>{{ r.endgame ? '✓' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- ═══ 统计 ═══ -->
        <template v-else-if="vm.kind === 'stats'">
          <div class="l-section-title">产量</div>
          <table class="c-stats-table c-effect-table">
            <tbody>
              <tr v-for="(e, i) in vm.body.production" :key="'pd' + i"><td>{{ e[0] }}</td><td>{{ e[1] }}</td></tr>
            </tbody>
          </table>

          <div class="l-section-title">攻击</div>
          <table class="c-stats-table c-effect-table">
            <tbody>
              <tr v-for="(e, i) in vm.body.attack" :key="'ak' + i"><td>{{ e[0] }}</td><td>{{ e[1] }}</td></tr>
            </tbody>
          </table>

          <div class="l-section-title">资源</div>
          <table class="c-stats-table c-effect-table">
            <tbody>
              <tr v-for="(e, i) in vm.body.resource" :key="'rs' + i"><td>{{ e[0] }}</td><td>{{ e[1] }}</td></tr>
            </tbody>
          </table>

          <div class="l-section-title">有效等级（各机制的等效级数）</div>
          <div class="c-kv c-kv--grid">
            <div v-for="(t, i) in vm.body.totals" :key="'tt' + i">
              <span class="c-kv__k">{{ t[0] }}</span> <span class="c-kv__v">{{ t[1] }}</span>
            </div>
          </div>

          <div class="l-section-title">累计统计</div>
          <div class="c-kv">
            <div v-for="(kv, i) in vm.body.kv" :key="'kv' + i">
              <span class="c-kv__k">{{ kv[0] }}</span> <span class="c-kv__v">{{ kv[1] }}</span>
            </div>
          </div>

          <div class="l-section-title">最近 20 次结算</div>
          <div v-if="!vm.body.ledger.length" class="c-dim-note c-page-note">还没有结算记录：守护或覆灭后才会写入账目。</div>
          <table v-else class="c-stats-table c-ledger-table">
            <thead><tr><th>结算</th><th>层</th><th>获得点数</th><th>自动花费</th><th>用时</th></tr></thead>
            <tbody>
              <tr v-for="e in vm.body.ledger" :key="e.key" :class="'c-ledger--' + e.kind">
                <td>{{ e.kindText }}</td>
                <td>{{ e.stage }} · {{ e.stageName }}</td>
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
          </div>

          <div class="l-section-title">玩家</div>
          <div class="l-options-row c-name-row">
            <span class="c-kv__k">用户名</span>
            <input id="name-input" class="o-input c-name-input" maxlength="16" :value="nameDraft || vm.body.net.name" placeholder="2–16 个字符" @input="nameDraft = $event.target.value" />
            <button class="o-primary-btn" @click="act('setName')">改名</button>
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
            每 10 秒自动保存到本地（版本 {{ version }}），每分钟同步到服务器；载入时优先本地、再试服务器。
            旧版本存档不会被迁移，需要重新开始。
          </div>
          <div v-if="vm.saveIssue" class="c-save-issue c-page-note">{{ vm.saveIssue }}</div>

          <div class="l-section-title">调试 <span class="c-hint">跳层入口 + 控制台 window.__dny，不能改数值</span></div>
          <div class="l-options-row">
            <button v-for="d in vm.body.debugJumps" :key="'dj' + d.stage" class="o-primary-btn c-debug-jump"
              :class="{ 'c-debug-jump--current': d.current }" :title="d.title"
              @click="act('debugJumpOpen', d.stage)">{{ d.label }}</button>
          </div>
          <div class="c-dim-note c-page-note">
            跳层会进入「首次抵达该层」的检查点存档（覆盖当前进度，需要保留请先导出存档）。
            控制台：<code>__dny.tick(400)</code> 快进 400 步 · <code>__dny.view()</code> 读状态 · <code>__dny.jumpTo(4)</code> 等价点按钮。
          </div>

          <div class="l-section-title">玩法速记</div>
          <div class="c-dim-note c-page-note">
            每 0.05 秒一步：解锁升级 → 自动购买最便宜项 → 产量增长并赚取奶茶币 → 深渊上升 →
            攻击削减深渊 → 净化力达标即「守护」，进入下一层；深渊追上净化力即「覆灭」，回到第一层
            （永久科技保留）。八层全部守护后进入终局：终局不判成功，被深渊追上即结束本轮。
            剧情播放与暂停时游戏完全停止。
          </div>
        </template>
      </div>

      <!-- ── 底部状态 ── -->
      <div class="l-status-bar">
        <span>{{ vm.message }}</span>
      </div>

      <!-- ── 剧情播放器 ── -->
      <div v-if="story" class="l-story" :class="storyMode === 'full' ? 'l-story--full' : 'l-story--bottom'"
        @click="nextStory">
        <div v-if="storyTitle" class="c-story-title">{{ storyTitle }}</div>
        <div v-if="storySpeaker" class="c-story-speaker">{{ storySpeaker }}</div>
        <div class="c-story-text">{{ storyLine }}</div>
        <div class="c-story-hint">点击继续 · {{ storyProgress }}</div>
      </div>

      <!-- ── 结算弹窗 ── -->
      <div class="l-modal-wrap" v-if="vm.pending && !story" @click.self="act('resolvePending')">
        <div class="c-modal c-modal--pending">
          <div class="c-modal__title">{{ vm.pending.title }}</div>
          <div class="c-pending-row">第 {{ vm.pending.stage }} 层「{{ vm.pending.stageName }}」· 片段 {{ vm.pending.time }}</div>
          <div class="c-pending-row">获得 <b>{{ vm.pending.gained }}</b> {{ vm.pending.walletName }}，自动买到 <b>{{ vm.pending.levelsGained }}</b> 级（余额 {{ vm.pending.walletAfter }}）</div>
          <div class="c-pending-row c-dim-note" v-for="(l, i) in vm.pending.lines" :key="'pl' + i">{{ l }}</div>
          <div class="c-pending-row c-dim-note" v-if="vm.pending.autoNote">{{ vm.pending.autoNote }}</div>
          <div class="c-pending-row c-dim-note">{{ vm.pending.next }}</div>
          <div class="l-options-row">
            <button class="o-primary-btn" data-action="resolve" @click="act('resolvePending')">{{ vm.pending.button }}</button>
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
            <button v-if="vm.modal.actions.includes('debugJump')" class="o-primary-btn" data-action="debugJump" @click="act('debugJump')">确认进入</button>
            <button class="o-primary-btn" data-action="close" @click="act('close')">关闭</button>
          </div>
        </div>
      </div>
    </div>`,
});

// ───────────────────────────── 主循环（固定 20Hz）─────────────────────────────
const DT = 0.05;
let acc = 0;
let last = performance.now();
let lastSave = Date.now();
let uiTimer = 0;
let hookHoldUntil = 0;

function frame(now) {
  const real = (now - last) / 1000;
  last = now;
  let dt = Number.isFinite(real) && real > 0 ? real : 0;
  if (dt > 0.5) dt = 0.5;
  uiTimer += dt;

  const st = engine.state;
  const holding = now < hookHoldUntil;
  if (!st.paused && !holding) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 200) { engine.tick(); acc -= DT; n++; }
    if (acc > DT * 200) acc = 0;
  } else {
    acc = 0;
  }

  if (uiTimer > 0.12) { uiTimer = 0; app.render(); }
  if (Date.now() - lastSave > 10000) { saveGame(); lastSave = Date.now(); }
  requestAnimationFrame(frame);
}

// ───────────────────────────── 启动 ─────────────────────────────
{
  const local = tryLocalSave();
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
bootServer();
window.addEventListener('beforeunload', saveGame);
setInterval(() => { syncNow(); }, SYNC_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveGame(); syncNow(); }
});

// ───────────────────────────── 调试钩子 ─────────────────────────────
function flushViewSync() {
  app.render();
  if (app._watcher) app._watcher.run();
}

window.__dny = {
  get engine() { return engine; },
  view: () => engine.view(),
  tick: (n = 1) => {
    const total = Math.max(0, Math.floor(Number(n) || 0));
    for (let i = 0; i < total; i++) engine.tick();
    hookHoldUntil = performance.now() + 1200;
    flushViewSync();
    return total;
  },
  save: () => engine.save(),
  metrics: () => engine.metrics(),
  sync: (manual = true) => syncNow(manual),
  // 截图 / 验收场景：把引擎放到某层的干净片段并跑若干 tick（不参与正常流程）
  scene: (stage = 1, ticks = 0, opts = {}) => {
    engine.headless = true;
    engine.scene(stage, { ticks, ...opts });
    hookHoldUntil = performance.now() + 1200;
    flushViewSync();
    return engine.view();
  },
  setAuto: (stage, level) => {
    engine.s.autoBuyLv[LAYER_TO_CHAR[Math.min(stage, 8)]] = level;
    flushViewSync();
  },
  settleAuto: (on = true) => {
    engine.s.auto.collapse = !!on;
    engine.s.auto.guard = !!on;
    flushViewSync();
  },
  jumpTo: (stage) => {
    const entry = performDebugJump(stage);
    flushViewSync();
    return entry ? engine.view() : null;
  },
  clearStory: () => {
    engine.s.storyQueue.length = 0;
    engine.s.storyActive = false;
    engine.s.paused = false;
    flushViewSync();
  },
};
