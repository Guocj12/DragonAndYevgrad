// web/js/app.js — 龙与耶维城 前端（AD 壳：Vue 2 + AD 的 styles.css/old-ui.css 类名与版式）
// 逻辑全部来自 ../../src/engine.js，本文件只做「引擎 → 视图模型 → 模板」的桥接。

import { Dec, formatScientific, formatTime } from '../../src/num.js';
import {
  ENGINE_VERSION, Engine, createInitialState, deserialize, serialize, tierCapLog,
} from '../../src/engine.js';
import { CHARACTERS, CHARACTER_ORDER, TIER_NAMES, TUNING } from '../../src/db.js';
import { ACHIEVEMENTS } from '../../src/achievements.js';
import { TreeView } from './tree.js';

const SAVE_KEY = 'dny-save-v1';
const SYNC_MS = 60000;   // 每分钟自动上传一次（存档 + 排行榜指标）

// 服务器身份与存档：cookie 由服务端下发，前端不碰
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

async function bootstrapServer() {
  const me = await apiFetch('/api/me');
  if (!me.ok || !me.data) { NET.note = '离线（服务器不可用），进度只存本地'; return; }
  NET.name = me.data.name;
  NET.rev = me.data.rev;
  NET.hasSave = me.data.hasSave;
  NET.online = true;
  if (me.data.hasSave) {
    const saved = await apiFetch('/api/save');
    if (saved.ok && saved.data && saved.data.save) {
      try {
        engine = new Engine(deserialize(saved.data.save));
        NET.rev = saved.data.rev;
        const elapsed = Math.min(8 * 3600, Math.max(0, (Date.now() - (saved.data.updatedAt || Date.now())) / 1000));
        if (elapsed > 5 && !engine.s.pending) {
          engine.offlineMult = (engine.s.generic['g4'] || 0) > 0 ? 0.25 : 1;
          engine.advance(elapsed);
          engine.offlineMult = 1;
        }
        NET.note = '已从服务器载入';
        saveGame();
        app.render();
      } catch (e) {
        NET.note = '服务器存档损坏，使用本地存档';
      }
    }
  }
}

function metricsNow() {
  const st = engine.s.stats;
  return {
    tier: st.maxTier || 0,
    purified: Number.isFinite(st.purifiedLog) ? st.purifiedLog : 0,
    cycles: st.cycles || 0,
    guards: (st.tierGuards || []).reduce((x, y) => x + y, 0),
    playTime: Math.round(st.playTime || 0),
    won: !!engine.s.won,
    cleared: st.clears || 0,
  };
}

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
    const save = serialize(engine.s);
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
const fmt = (v) => formatScientific(v);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// ───────────────────────────── 引擎与存档 ─────────────────────────────
let engine = new Engine(createInitialState());
let message = '欢迎来到耶维城：先攒奶茶币，买「灌装线」。';
let modal = null;
let activeTab = '249';
let activeSub = 'upgrades';
let treeView = null;

function say(msg) { message = msg; }

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ t: Date.now(), s: serialize(engine.s) }));
  } catch (e) { /* 忽略配额错误 */ }
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    const obj = JSON.parse(raw);
    engine = new Engine(deserialize(obj.s));
    const elapsed = Math.min(8 * 3600, Math.max(0, (Date.now() - obj.t) / 1000));
    if (elapsed > 5 && !engine.s.pending) {
      engine.offlineMult = (engine.s.generic['g4'] || 0) > 0 ? 0.25 : 1;
      engine.advance(elapsed);
      engine.offlineMult = 1;
      say(`离线 ${formatTime(elapsed)} 结束：现在在${TIER_NAMES[engine.s.tier]}，累计覆灭 ${engine.s.stats.cycles} 次`);
    }
    return true;
  } catch (e) {
    console.warn('存档损坏，已重新开始', e);
    return false;
  }
}

// ───────────────────────────── 视图模型 ─────────────────────────────
const TAB_DEFS = () => {
  const tabs = CHARACTER_ORDER.filter((id) => engine.s.unlocked.includes(id))
    .map((id) => ({ id, name: CHARACTERS[id].name, kind: 'char' }));
  tabs.push({ id: 'achievements', name: '成就', kind: 'ach' });
  tabs.push({ id: 'board', name: '排行榜', kind: 'board' });
  tabs.push({ id: 'stats', name: '数据', kind: 'stats' });
  tabs.push({ id: 'options', name: '设置', kind: 'options' });
  return tabs;
};

// 每个角色自己的子页签：升级 / 科技 + 一个专属界面
const SUBTABS = (charId) => {
  const list = [{ id: 'upgrades', name: '升级' }, { id: 'techs', name: '科技' }];
  if (charId === '249') list.push({ id: 'tree', name: '科技树' });
  if (charId === 'yewei') list.push({ id: 'shop', name: '万事屋' });
  if (charId === 'baiqi') list.push({ id: 'battle', name: '战斗' });
  if (charId === 'heng') list.push({ id: 'abyss', name: '深渊' });
  return list;
};

// 角色页顶部的「主要数据」
function mainStatVM(charId) {
  const b = engine.bonuses();
  // 与顶部状态栏保持同一口径：都是总产量
  if (charId === '249') return { label: '奶茶产量', value: `${fmt(b.prodTotal)}/s` };
  if (charId === 'yewei') return { label: '奶茶产量', value: `${fmt(b.prodTotal)}/s` };
  if (charId === 'baiqi') return { label: '战力', value: fmt(b.powerBaiqi) };
  if (charId === 'heng') return { label: '战力', value: fmt(b.hengPower) };
  return { label: '', value: '' };
}

// 万事屋：奶茶币兑换记忆点数 / 净化点数
function shopVM() {
  const mpPrice = engine.shopPrice('mp');
  const ppPrice = engine.shopPrice('pp');
  return {
    mp: { price: fmt(mpPrice), count: engine.s.shop.mp || 0, can: Dec.gte(engine.s.mtc, mpPrice) },
    pp: { price: fmt(ppPrice), count: engine.s.shop.pp || 0, can: Dec.gte(engine.s.mtc, ppPrice) },
    mpGrowth: engine.shopGrowth('mp').toFixed(3),
    ppGrowth: engine.shopGrowth('pp').toFixed(3),
  };
}

// 战斗：深渊总量 + 每个战斗角色的秒伤与贡献
function battleVM() {
  const b = engine.bonuses();
  const total = b.dmgTotal;
  const share = (x) => (Dec.gt(total, 0) ? `${(Dec.div(x, total).toNumber() * 100).toFixed(1)}%` : '—');
  const rows = [];
  if (engine.s.unlocked.includes('baiqi')) {
    rows.push({ id: 'baiqi', name: '白琦', dps: fmt(b.dmgBaiqi), share: share(b.dmgBaiqi), speed: '1.00/s' });
  }
  if (engine.s.unlocked.includes('heng')) {
    rows.push({ id: 'heng', name: '恒', dps: fmt(b.dmgHeng), share: share(b.dmgHeng), speed: `${(b.atkSpeed || 1).toFixed(2)}/s` });
  }
  return {
    abyss: fmt(engine.s.S),
    cap: fmt(Dec.pow10(tierCapLog(engine.s.tier))),
    progress: `${(engine.progress() * 100).toFixed(1)}%`,
    total: fmt(total),
    rows,
  };
}

function headerVM() {
  const s = engine.s;
  const b = engine.bonuses();
  const yS = Math.max(0, Dec.log10(s.S));
  const yCap = tierCapLog(s.tier);
  const progress = Math.max(0, Math.min(1, yS / yCap));
  return {
    mtc: fmt(s.mtc), mp: fmt(s.mp), pp: fmt(s.pp), ap: fmt(s.ap),
    tier: s.tier, tierMax: TUNING.maxTier, tierName: TIER_NAMES[s.tier] || `第 ${s.tier} 区`,
    abyss: fmt(s.S), cap: fmt(Dec.pow10(yCap)),
    prod: fmt(b.prodTotal), purify: fmt(b.purifyTea.add(b.dmgTotal)),
    runTime: `${s.t.toFixed(1)}s`, progress: progress * 100,
    doomed: progress > 0.92 && !s.pending,
    paused: !!s.paused, pending: s.pending,
  };
}

function upgradeListVM(charId) {
  const st = engine.s.chars[charId];
  const b = engine.bonuses();
  return CHARACTERS[charId].upgrades.map((u, i) => {
    const lv = st.upgrades[i];
    const unlocked = engine.upgradeUnlocked(charId, i);
    const cost = engine.costOfUpgrade(charId, i, lv);
    const prevName = i > 0 ? CHARACTERS[charId].upgrades[i - 1].name : '';
    const maxLevel = u.maxLevel ?? Infinity;
    const maxed = lv >= maxLevel;
    const bulk = engine.bulkInfo(charId, i, TUNING.bulkGroup);
    return {
      key: u.id, name: u.name, level: lv, maxLevel, maxed, unlocked,
      levelText: maxLevel === Infinity ? `Lv ${lv}` : `Lv ${lv} / ${maxLevel}`,
      reqText: unlocked ? '' : `需要「${prevName}」Lv${u.reqLevel}`,
      desc: u.desc(lv, b.ctx),
      preview: engine.upgradePreview(charId, i),
      previewLine: maxed
        ? `当前 ${engine.upgradePreview(charId, i)}（已满级）`
        : `当前 ${engine.upgradePreview(charId, i)} → 下一级 ${engine.upgradePreview(charId, i, lv + 1)}`,
      bulkCount: bulk.count,
      costLabel: maxed ? '已满级'
        : bulk.count > 0 ? `买 ${bulk.count} 个 · ${fmt(bulk.total)} 奶茶币`
          : `${fmt(cost)} 奶茶币`,
      can: unlocked && !maxed && bulk.count > 0,
      kind: 'upgrade', charId, index: i,
    };
  });
}

function techListVM(charId) {
  const st = engine.s.chars[charId];
  const b = engine.bonuses();
  return CHARACTERS[charId].techs.map((t, i) => {
    const lv = st.techs[i];
    const cost = engine.costOfTech(charId, i, lv);
    const maxLevel = t.maxLevel || 20;
    const maxed = lv >= maxLevel;
    return {
      key: t.id, name: t.name, level: lv, maxLevel, maxed, unlocked: true, reqText: '',
      levelText: `Lv ${lv} / ${maxLevel}`,
      desc: t.desc(lv, b.ctx),
      cost: maxed ? '已满级' : `${fmt(cost)} 记忆点数`,
      preview: engine.techPreview(charId, i),
      previewLine: maxed
        ? `当前 ${engine.techPreview(charId, i)}（已满级）`
        : `当前 ${engine.techPreview(charId, i)} → 下一级 ${engine.techPreview(charId, i, lv + 1)}`,
      can: !maxed && Dec.gte(engine.s.mp, cost),
      kind: 'tech', charId, index: i,
    };
  });
}

function statsVM() {
  const c = engine.contribution();
  const s = engine.s;
  const withWarn = (rows) => {
    const bonuses = rows.filter((r) => !r.neutral);
    const top = bonuses[0];
    const enough = bonuses.length >= 3;
    return {
      rows: rows.map((r) => ({ ...r, logText: r.log.toFixed(2), pctText: r.neutral ? '—' : pct(r.pct) })),
      warn: enough && top.pct > 0.5,
      enough,
      topName: top ? top.name : '',
    };
  };
  return {
    prod: withWarn(c.prod), eta: withWarn(c.eta), damage: withWarn(c.damage),
    kv: [
      ['产量数量级', c.prodLog.toFixed(1)],
      ['净化+伤害数量级', c.purifyLog.toFixed(1)],
      ['深渊数量级', c.abyssLog.toFixed(1)],
      ['所在地', TIER_NAMES[s.tier] || s.tier],
      ['覆灭次数', s.stats.cycles],
      ['守护次数', s.stats.guards],
    ],
  };
}

function treeSummaryVM() {
  return CHARACTER_ORDER.filter((id) => engine.s.unlocked.includes(id)).map((id) => ({
    charId: id,
    name: CHARACTERS[id].name,
    count: Object.keys(engine.s.chars[id].tree).length,
  }));
}

function buildVM() {
  const page = { kind: 'char', charId: activeTab, sub: activeSub };
  const body = {};
  if (activeTab === 'achievements') {
    page.kind = 'ach';
    const got = new Set(engine.s.achievements || []);
    body.ach = {
      count: got.size,
      total: ACHIEVEMENTS.length,
      mul: `×${1 + got.size}`,
      rows: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, got: got.has(a.id) })),
    };
  } else if (activeTab === 'board') {
    page.kind = 'board';
    body.board = {
      rows: boardRows.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        tierText: TIER_NAMES[r.tier] || `第 ${r.tier} 区`,
        purifiedText: r.purified > 0 ? fmt(Dec.pow10(r.purified)) : '—',
        cycles: r.cycles,
        guards: r.guards,
        timeText: formatTime(r.playTime),
        won: r.won,
      })),
      note: boardNote,
      myName: NET.name,
    };
  } else if (activeTab === 'stats') { page.kind = 'stats'; Object.assign(body, statsVM()); }
  else if (activeTab === 'options') {
    page.kind = 'options';
    body.net = {
      name: NET.name || '（连接中）',
      online: NET.online,
      note: NET.note,
      lastSync: NET.syncedAt ? formatTime((Date.now() - NET.syncedAt) / 1000) + '前' : '还没同步过',
    };
  }
  else {
    if (!engine.s.unlocked.includes(activeTab)) activeTab = '249';
    const subtabs = SUBTABS(activeTab);
    if (!subtabs.some((t) => t.id === activeSub)) activeSub = 'upgrades';
    page.charId = activeTab;
    page.sub = activeSub;
    body.subtabs = subtabs;
    body.upgrades = activeSub === 'upgrades' ? upgradeListVM(activeTab) : [];
    body.techs = activeSub === 'techs' ? techListVM(activeTab) : [];
    body.charInfo = {
      name: CHARACTERS[activeTab].name,
      title: CHARACTERS[activeTab].title,
      blurb: CHARACTERS[activeTab].blurb,
      main: mainStatVM(activeTab),
    };
    if (activeSub === 'tree') body.treeStat = treeSummaryVM();
    if (activeSub === 'shop') body.shop = shopVM();
    if (activeSub === 'battle') body.battle = battleVM();
  }
  return {
    header: headerVM(), tabs: TAB_DEFS(), activeTab, activeSub, page, body,
    message, modal,
    pending: engine.s.pending,
    paused: engine.s.paused,
    skipReadStories: !!(engine.s.settings && engine.s.settings.skipReadStories),
  };
}

// ───────────────────────────── 动作 ─────────────────────────────
function doBuy(charId, idx) {
  const info = engine.buyUpgradeBulk(charId, idx, TUNING.bulkGroup);
  if (info.count === 0) {
    if (!engine.upgradeUnlocked(charId, idx)) {
      const def = CHARACTERS[charId].upgrades[idx];
      const prev = CHARACTERS[charId].upgrades[idx - 1];
      say(`「${def.name}」尚未解锁：需要「${prev.name}」Lv${def.reqLevel}`);
    } else {
      const u = CHARACTERS[charId].upgrades[idx];
      if (engine.s.chars[charId].upgrades[idx] >= (u.maxLevel ?? Infinity)) say('已经满级了');
      else say('奶茶币还不够买下一级');
    }
  } else {
    engine.s.run.manualActions = (engine.s.run.manualActions || 0) + 1;
  }
}

function act(action, payload) {
  switch (action) {
    case 'tab':
      activeTab = payload;
      if (payload === 'board') loadBoard();
      break;
    case 'sub': activeSub = payload; break;
    case 'buyMax': {
      const n = engine.buyMaxAll(payload.charId);
      say(n > 0 ? `一口气买了 ${n} 级升级` : '买不起，或者全都满级了');
      break;
    }
    case 'produce': {
      const gain = engine.clickProduce();
      say(`生产了 ${fmt(gain)} 杯奶茶`);
      break;
    }
    case 'debug': {
      const k = payload.kind;
      if (k === 'money') { engine.s.mtc = engine.s.mtc.add(Dec.from('1e10')); say('奶茶币 +1e10'); }
      else if (k === 'rich') { engine.s.mtc = engine.s.mtc.add(Dec.from('1e100')); say('奶茶币 +1e100'); }
      else if (k === 'mp') { engine.s.mp = engine.s.mp.add(Dec.from(100)); say('记忆点数 +100'); }
      else if (k === 'pp') { engine.s.pp = engine.s.pp.add(Dec.from(100)); say('净化点数 +100'); }
      else if (k === 'ap') { engine.s.ap = engine.s.ap.add(Dec.from(10)); say('觉醒点 +10'); }
      else if (k === 'unlock') {
        ['yewei', 'baiqi', 'heng'].forEach((id) => { if (!engine.s.unlocked.includes(id)) engine.s.unlocked.push(id); });
        say('已解锁全部角色');
      } else if (k === 'guard') { engine.s.S = Dec.zero(); engine.tick(0.5); say('强制守护'); }
      else if (k === 'collapse') { engine.s.S = Dec.pow10(tierCapLog(engine.s.tier)); engine.tick(0.5); say('强制覆灭'); }
      else if (k === 'fast') { engine.advance(600); say('快进 10 分钟'); }
      engine.b = null;
      break;
    }
    case 'shopBuy': {
      if (engine.buyShop(payload)) say(payload === 'mp' ? '兑换成功：+1 记忆点数' : '兑换成功：+1 净化点数');
      else say('奶茶币不够');
      break;
    }
    case 'upgrade': doBuy(payload.charId, payload.index); break;
    case 'tech': engine.buyTech(payload.charId, payload.index); break;
    case 'treeBuy': {
      const id = payload;
      if (id.startsWith('g')) {
        if (!engine.genericUnlocked(id)) say(`需要先购买「${engine.parentName(id)}」`);
        else if (!engine.buyGeneric(id)) say('净化点数不够或已满级');
      }
      else {
        const charId = CHARACTER_ORDER.find((c) => CHARACTERS[c].tree.some((n) => n.id === id));
        if (charId) {
          const node = CHARACTERS[charId].tree.find((n) => n.id === id);
          const owned = CHARACTERS[charId].tree.filter((x) => engine.s.chars[charId].tree[x.id]).map((x) => x.layer);
          const maxLayer = owned.length ? Math.max(...owned) : 0;
          if (!engine.s.chars[charId].tree[id] && node.layer > maxLayer + 1) say('需要先解锁上一层的节点');
          else if (!engine.buyTreeNode(charId, id)) say('觉醒点不够');
        }
      }
      break;
    }
    case 'respec': {
      const back = engine.respecTree(payload.charId);
      say(`已重置 ${CHARACTERS[payload.charId].name} 科技树，返还 ${fmt(back)} 觉醒点`);
      break;
    }
    case 'pause': engine.togglePause(); say(engine.s.paused ? '已暂停（可以继续购买）' : '继续'); break;
    case 'resolve': {
      const out = engine.resolvePending();
      if (out) {
        const parts = [`记忆点数 +${fmt(out.mp)}`];
        if (Dec.gt(out.pp, 0)) parts.push(`净化点数 +${fmt(out.pp)}`);
        if (Dec.gt(out.ap, 0)) parts.push(`觉醒点 +${fmt(out.ap)}`);
        say(out.kind === 'guard'
          ? `净化完成：上限 +1，来到${TIER_NAMES[out.nextTier] || '下一片区域'}，${parts.join('，')}`
          : `覆灭结算：回到奶茶店，${parts.join('，')}`);
      }
      break;
    }
    case 'syncNow': syncNow(true); break;
    case 'toggleSkipRead': {
      if (!engine.s.settings) engine.s.settings = { skipReadStories: false };
      const v = !engine.s.settings.skipReadStories;
      engine.s.settings.skipReadStories = v;
      say(v ? '已开启：看过的剧情不再弹出' : '已关闭：剧情照常播放');
      break;
    }
    case 'boardRefresh': loadBoard(); break;
    case 'setName': {
      const el = document.getElementById('name-input');
      if (el && el.value.trim()) renameSelf(el.value.trim());
      break;
    }
    case 'save': saveGame(); say('已保存'); break;
    case 'export':
      modal = { title: '导出存档', text: '存档（Base64）已复制到剪贴板。', textarea: btoa(serialize(engine.s)), actions: ['close'] };
      try { navigator.clipboard?.writeText(btoa(serialize(engine.s))); } catch (e) { /* 忽略 */ }
      break;
    case 'importOpen':
      modal = { title: '导入存档', text: '粘贴 Base64 存档后点「导入」。', textarea: '', actions: ['import', 'close'] };
      break;
    case 'import': {
      const text = document.getElementById('modal-textarea')?.value || '';
      try {
        engine = new Engine(deserialize(atob(text.trim())));
        say('导入成功');
      } catch (e) { say(`导入失败：${e.message}`); }
      modal = null;
      break;
    }
    case 'resetOpen':
      modal = { title: '抹除全部进度', text: '这会清空本地存档，无法恢复。确定？', textarea: null, actions: ['reset', 'close'] };
      break;
    case 'reset':
      localStorage.removeItem(SAVE_KEY);
      app.story = null;   // 清掉可能残留的旧剧情进度，否则会从上次的位置继续播
      app._ignoreStoryClick = true;
      engine = new Engine(createInitialState());
      engine.startStoryIfFirstRun();
      activeTab = '249'; activeSub = 'upgrades';
      modal = null;
      say('已重新开始');
      break;
    case 'close': modal = null; break;
    case 'treeFit': if (treeView) treeView.fitTree(); break;
    default: break;
  }
  if (engine && engine.checkAchievements) engine.checkAchievements();   // 操作后立刻结算成就，暂停时也生效
  app.render();
}

// ───────────────────────────── 根组件 ─────────────────────────────
const app = new Vue({
  el: '#app',
  data() {
    return { vm: buildVM(), story: null };
  },
  computed: {
    tables() {
      return [
        { title: '产量加成贡献', data: this.vm.body.prod || { rows: [], warn: false } },
        { title: '净化加成贡献（产量 × 净化效率）', data: this.vm.body.eta || { rows: [], warn: false } },
        { title: '战斗伤害贡献', data: this.vm.body.damage || { rows: [], warn: false } },
      ];
    },
    runTime() { return `${engine.s.t.toFixed(1)}s`; },
    playTime() { return formatTime(engine.s.stats.playTime); },
    version() { return ENGINE_VERSION; },
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
    storyProgress() { return this.story ? `${this.story.idx + 1} / ${this.story.entry.lines.length}` : ''; },
    pendingTitle() { return engine.s.pending === 'guard' ? '深渊已清零' : '深渊已满'; },
    pendingDesc() {
      return engine.s.pending === 'guard'
        ? '点击「净化」结算本轮：获得记忆点数 / 净化点数，并前往下一片区域。'
        : '点击「覆灭结算」：获得记忆点数，回到奶茶店；升级清空，科技与科技树保留。';
    },
    pendingReward() {
      const r = engine.previewPendingReward();
      if (!r) return '';
      const parts = [`记忆点数 +${fmt(r.mp)}`];
      if (Dec.gt(r.pp, 0)) parts.push(`净化点数 +${fmt(r.pp)}`);
      return `预计获得：${parts.join('，')}`;
    },
  },
  methods: {
    render() {
      this.vm = buildVM();
      // 换了引擎实例（抹除进度 / 导入存档）→ 旧的故事进度作废，从头播
      if (this.story && this.story.state && this.story.state !== engine.s) this.story = null;
      if (!this.story && engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0, state: engine.s, createdAt: Date.now() };
      }
      if (this.story && !engine.s.storyActive) this.story = null;
      if (this.vm.activeSub === 'tree' && this.vm.page.kind === 'char') this.$nextTick(() => this.syncTree());
    },
    syncTree() {
      const host = this.$refs.treeHost;
      if (!host) return;
      if (!treeView) treeView = new TreeView(host, { getEngine: () => engine, onBuy: (id) => act('treeBuy', id) });
      else treeView.attach(host);
      treeView.sync(engine);
    },
    act,
    go(id) { act('tab', id); },
    // 手动生产：按下立即 1 次，长按以每秒 20 次持续
    startProduce() {
      if (producing) return;
      producing = true;
      produceAcc = 0;
      engine.clickProduce();   // 按下立即生产一次
      app.render();
    },
    stopProduce() {
      if (!producing) return;
      producing = false;
      engine.s.stats.manualProduce = (engine.s.stats.manualProduce || 0) + 1;   // 长按整段只算一次
      engine.s.run.manualActions = (engine.s.run.manualActions || 0) + 1;
      say(`生产了 ${fmt(engine.bonuses().prodTotal)} 杯/次 × 20 次/秒`);
      app.render();
    },
    buy(item) {
      if (item.kind === 'upgrade') act('upgrade', item);
      else act('tech', item);
    },
    nextStory() {
      if (!this.story) return;
      // 抹除进度后，同一次点击会穿透到刚出现的剧情层 → 只吞掉这一次
      if (app._ignoreStoryClick) { app._ignoreStoryClick = false; return; }
      if (this.story.idx + 1 < this.story.entry.lines.length) { this.story.idx++; return; }
      engine.finishStory();
      this.story = null;
      if (engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0, state: engine.s, createdAt: Date.now() };
      }
      this.render();
    },
  },
  mounted() { this.render(); },
  template: `
    <div id="container" class="container c-old-ui l-old-ui" :class="{ 'is-paused': vm.paused }">
      <div class="l-game-header c-game-header">
        <div class="c-header-res"><span class="c-header-res__label">奶茶币</span><span class="c-header-res__value">{{ vm.header.mtc }}</span></div>
        <div class="c-header-res c-header-res--mp"><span class="c-header-res__label">记忆点数</span><span class="c-header-res__value">{{ vm.header.mp }}</span></div>
        <div class="c-header-res c-header-res--pp"><span class="c-header-res__label">净化点数</span><span class="c-header-res__value">{{ vm.header.pp }}</span></div>
        <div class="c-header-res c-header-res--ap"><span class="c-header-res__label">觉醒点</span><span class="c-header-res__value">{{ vm.header.ap }}</span></div>
        <div class="c-header-tier">你现在在 {{ vm.header.tierName }}</div>
        <button class="o-primary-btn c-pause-btn" :class="{ 'c-pause-btn--on': vm.paused }" :disabled="!!vm.pending" @click="act('pause')">
          {{ vm.paused ? '▶ 继续' : '⏸ 暂停' }}
        </button>
      </div>

      <div class="l-abyss-bar" :class="{ 'is-doomed': vm.header.doomed }">
        <div class="c-abyss-bar">
          <div class="c-abyss-bar__fill" :style="{ width: vm.header.progress + '%' }"></div>
          <div class="c-abyss-bar__text">深渊 {{ vm.header.abyss }} / 上限 {{ vm.header.cap }}</div>
        </div>
        <div class="c-abyss-info">
          <span>本轮 {{ vm.header.runTime }}</span>
          <span>产量 {{ vm.header.prod }}/s</span>
          <span>净化 {{ vm.header.purify }}/s</span>
          <span>进度 {{ vm.header.progress.toFixed(1) }}%</span>
          <span v-if="vm.paused" class="c-paused-tag">已暂停</span>
        </div>
      </div>

      <div class="l-tab-bar">
        <button v-for="t in vm.tabs" :key="t.id"
          class="o-tab-btn"
          :class="{ 'o-tab-btn--active': t.id === vm.activeTab }"
          @click="go(t.id)">{{ t.name }}</button>
      </div>

      <div class="c-subtab-button-container" v-if="vm.page.kind === 'char'">
        <button v-for="st in vm.body.subtabs" :key="st.id"
          class="o-tab-btn o-tab-btn--secondary" :class="{ 'o-tab-btn--active': vm.activeSub === st.id }"
          @click="act('sub', st.id)">{{ st.name }}</button>
        <span class="c-hint">每次点击最多买到「下一个 10 的倍数」：36 → 40，10 → 20；买不起就尽量买</span>
      </div>

      <div class="l-old-ui__page l-tab-page">
        <template v-if="vm.page.kind === 'char'">
          <div class="l-section-title">{{ vm.body.charInfo.name }} · {{ vm.body.charInfo.title }}</div>
          <div class="c-char-stat">
            <span class="c-char-stat__label">{{ vm.body.charInfo.main.label }}</span>
            <span class="c-char-stat__value">{{ vm.body.charInfo.main.value }}</span>
          </div>
          <div class="c-hint" style="text-align:left;max-width:110rem">{{ vm.body.charInfo.blurb }}</div>
          <div v-if="vm.activeSub === 'upgrades'" class="l-produce-row">
            <button v-if="vm.activeTab === '249'" class="o-primary-btn c-produce-btn"
              @mousedown.prevent="startProduce" @mouseup="stopProduce" @mouseleave="stopProduce"
              @touchstart.prevent="startProduce" @touchend="stopProduce" @touchcancel="stopProduce">
              生产奶茶（+{{ vm.header.prod }}）
            </button>
            <button class="o-primary-btn" @click="act('buyMax', { charId: vm.page.charId })">购买最大数量</button>
            <span v-if="vm.activeTab === '249'" class="c-dim-note">生产：点一下 = 1 秒产量，按住 = 每秒 20 次；购买：把能买的都买光</span>
            <span v-else class="c-dim-note">把当前角色所有能买的升级一次买光</span>
          </div>
          <div v-if="vm.activeSub === 'upgrades'" class="l-upgrade-grid">
            <button v-for="item in vm.body.upgrades" :key="item.key"
              class="c-upgrade-btn"
              :class="{ 'c-upgrade-btn--disabled': !item.can, 'c-upgrade-btn--locked': !item.unlocked }"
              :disabled="!item.can"
              @click="buy(item)">
              <div class="c-upgrade-btn__head"><span>{{ item.name }}</span>
                <span class="c-upgrade-btn__level">{{ item.unlocked ? item.levelText : '未解锁' }}</span>
              </div>
              <div class="c-upgrade-btn__desc">{{ item.desc }}</div>
              <div v-if="item.unlocked" class="c-upgrade-btn__preview">{{ item.previewLine }}</div>
              <div v-if="item.unlocked" class="c-upgrade-btn__cost">{{ item.costLabel }}</div>
              <div v-else class="c-upgrade-btn__req">{{ item.reqText }}</div>
            </button>
          </div>
          <div v-else-if="vm.activeSub === 'techs'" class="l-upgrade-grid">
            <button v-for="item in vm.body.techs" :key="item.key"
              class="c-upgrade-btn c-upgrade-btn--tech"
              :class="{ 'c-upgrade-btn--disabled': !item.can }"
              :disabled="!item.can"
              @click="act('tech', item)">
              <div class="c-upgrade-btn__head"><span>{{ item.name }}</span><span class="c-upgrade-btn__level">{{ item.levelText }}</span></div>
              <div class="c-upgrade-btn__desc">{{ item.desc }}</div>
              <div class="c-upgrade-btn__preview">{{ item.previewLine }}</div>
              <div class="c-upgrade-btn__cost">{{ item.cost }}</div>
            </button>
          </div>

          <div v-else-if="vm.activeSub === 'tree'">
            <div class="l-section-title">
              科技树 <span class="c-hint">滚轮缩放 · 拖动平移 · 点击节点购买</span>
              <button class="o-primary-btn" style="margin-left:1rem" @click="act('treeFit')">重置视角</button>
            </div>
            <div class="c-tree-host-wrap">
              <div ref="treeHost" class="c-tree-host"></div>
            </div>
            <div class="l-tree-actions">
              <div v-for="c in vm.body.treeStat" :key="c.charId" class="c-tree-action">
                <span>{{ c.name }} 科技树（{{ c.count }} / 9）</span>
                <button class="o-primary-btn" @click="act('respec', { charId: c.charId })">重置并返还觉醒点</button>
              </div>
            </div>
          </div>

          <div v-else-if="vm.activeSub === 'shop'" class="l-shop">
            <div class="l-section-title">万事屋 <span class="c-hint">用奶茶币兑换资源，价格随兑换次数指数上涨</span></div>
            <div class="l-shop-grid">
              <div class="c-shop-card">
                <div class="c-shop-card__head">记忆点数</div>
                <div class="c-shop-card__price">{{ vm.body.shop.mp.price }} 奶茶币 / 1 记忆点数</div>
                <div class="c-dim-note">已兑换 {{ vm.body.shop.mp.count }} 次 · 增长率 ×{{ vm.body.shop.mpGrowth }}</div>
                <button class="o-primary-btn" :disabled="!vm.body.shop.mp.can" @click="act('shopBuy', 'mp')">兑换 1 MP</button>
              </div>
              <div class="c-shop-card">
                <div class="c-shop-card__head">净化点数</div>
                <div class="c-shop-card__price">{{ vm.body.shop.pp.price }} 奶茶币 / 1 净化点数</div>
                <div class="c-dim-note">已兑换 {{ vm.body.shop.pp.count }} 次 · 增长率 ×{{ vm.body.shop.ppGrowth }}</div>
                <button class="o-primary-btn" :disabled="!vm.body.shop.pp.can" @click="act('shopBuy', 'pp')">兑换 1 PP</button>
              </div>
            </div>
          </div>

          <div v-else-if="vm.activeSub === 'battle'" class="l-battle">
            <div class="l-section-title">战斗 <span class="c-hint">深渊每秒被削减的总量</span></div>
            <div class="c-battle-stage">
              <div class="c-battle-abyss">深渊 {{ vm.body.battle.abyss }} / 上限 {{ vm.body.battle.cap }}</div>
              <div class="c-battle-progress">进度 {{ vm.body.battle.progress }}</div>
              <div class="c-battle-floats">
                <span v-for="r in vm.body.battle.rows" :key="'f' + r.id" class="c-battle-float">−{{ r.dps }}</span>
              </div>
            </div>
            <table class="c-stats-table">
              <thead><tr><th>角色</th><th>攻速</th><th>秒伤</th><th>伤害占比</th></tr></thead>
              <tbody>
                <tr v-for="r in vm.body.battle.rows" :key="r.id">
                  <td>{{ r.name }}</td><td>{{ r.speed }}</td><td>{{ r.dps }}</td><td>{{ r.share }}</td>
                </tr>
              </tbody>
            </table>
            <div class="c-dim-note">合计秒伤 {{ vm.body.battle.total }}</div>
          </div>

          <div v-else-if="vm.activeSub === 'abyss'" class="l-abyss-page">
            <div class="l-section-title">深渊</div>
            <div class="c-dim-note">尚未开放。</div>
          </div>
        </template>

        <template v-else-if="vm.page.kind === 'ach'">
          <div class="l-section-title">
            成就 <span class="c-hint">每个成就为全体角色提供 +100% 加成</span>
          </div>
          <div class="c-kv">
            <div><span class="c-kv__k">已达成</span> <span class="c-kv__v">{{ vm.body.ach.count }} / {{ vm.body.ach.total }}</span></div>
            <div><span class="c-kv__k">全体加成</span> <span class="c-kv__v">{{ vm.body.ach.mul }}</span></div>
          </div>
          <div class="l-ach-grid">
            <div v-for="a in vm.body.ach.rows" :key="a.id" class="c-ach" :class="{ 'c-ach--got': a.got }">
              <div class="c-ach__name">{{ a.got ? '✓ ' : '' }}{{ a.name }}</div>
              <div class="c-ach__desc">{{ a.desc }}</div>
            </div>
          </div>
        </template>

        <template v-else-if="vm.page.kind === 'board'">
          <div class="l-section-title">
            排行榜
            <span class="c-dim-note">按「所在地 → 净化深渊总量 → 覆灭次数」排序，每分钟自动上传</span>
            <button class="o-primary-btn c-board-refresh" @click="act('boardRefresh')">刷新</button>
          </div>
          <div v-if="vm.body.board.note" class="c-dim-note c-board-note">{{ vm.body.board.note }}</div>
          <table class="c-stats-table c-board-table" v-if="vm.body.board.rows.length">
            <thead>
              <tr><th>#</th><th>玩家</th><th>所在地</th><th>净化深渊总量</th><th>守护</th><th>覆灭</th><th>累计游玩</th><th>通关</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in vm.body.board.rows" :key="'b'+r.rank" :class="{ 'c-board-me': r.name === vm.body.board.myName }">
                <td>{{ r.rank }}</td>
                <td>{{ r.name }}<span v-if="r.name === vm.body.board.myName" class="c-board-tag">你</span></td>
                <td>{{ r.tierText }}</td>
                <td>{{ r.purifiedText }}</td>
                <td>{{ r.guards }}</td>
                <td>{{ r.cycles }}</td>
                <td>{{ r.timeText }}</td>
                <td>{{ r.won ? '✓' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-else-if="vm.page.kind === 'stats'">
          <div class="l-section-title">本轮总览</div>
          <div class="c-kv">
            <div v-for="(kv, i) in vm.body.kv" :key="'kv'+i">
              <span class="c-kv__k">{{ kv[0] }}</span> <span class="c-kv__v">{{ kv[1] }}</span>
            </div>
          </div>
          <div class="l-stats-grid">
            <div v-for="(table, idx) in tables" :key="'tab'+idx">
              <div class="l-section-title">
                {{ table.title }}
                <span :class="table.data.warn ? 'c-stats-warn' : 'c-stats-ok'">
                  {{ table.data.warn ? ('⚠ 单一加成占比超过 50%（' + table.data.topName + '）') : (table.data.enough ? '单一加成均未超过 50%' : '加成项较少，暂不比较') }}
                </span>
              </div>
              <table class="c-stats-table">
                <thead><tr><th>来源</th><th>贡献（数量级）</th><th>占比</th></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in table.data.rows" :key="'r'+idx+i">
                    <td>{{ r.name }}</td><td>{{ r.logText }}</td><td>{{ r.pctText }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="l-section-title">剧情</div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('toggleSkipRead')">跳过已读文本：{{ vm.skipReadStories ? '开' : '关' }}</button>
            <span class="c-dim-note">开启后，看过的剧情不再自动弹出（没看过的照常播放）</span>
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

          <div class="l-section-title">调试 <span class="c-hint">只用来快速验证后面的内容，正式游玩不用点</span></div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('debug', { kind: 'money' })">奶茶币 +1e10</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'rich' })">奶茶币 +1e100</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'mp' })">记忆点数 +100</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'pp' })">净化点数 +100</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'ap' })">觉醒点 +10</button>
          </div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('debug', { kind: 'unlock' })">解锁全部角色</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'guard' })">立即净化</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'collapse' })">立即覆灭</button>
            <button class="o-primary-btn" @click="act('debug', { kind: 'fast' })">快进 10 分钟</button>
          </div>

          <div class="l-section-title">存档</div>
          <div class="l-options-row">
            <button class="o-primary-btn" @click="act('save')">立即保存</button>
            <button class="o-primary-btn" @click="act('export')">导出存档</button>
            <button class="o-primary-btn" @click="act('importOpen')">导入存档</button>
            <button class="o-primary-btn" @click="act('resetOpen')">抹除全部进度</button>
          </div>
          <div class="l-section-title">状态</div>
          <div class="c-kv">
            <div><span class="c-kv__k">本轮时间</span> <span class="c-kv__v">{{ runTime }}</span></div>
            <div><span class="c-kv__k">累计游玩</span> <span class="c-kv__v">{{ playTime }}</span></div>
            <div><span class="c-kv__k">自动保存</span> <span class="c-kv__v">每 10 秒</span></div>
            <div><span class="c-kv__k">版本</span> <span class="c-kv__v">v{{ version }}</span></div>
          </div>
          <div class="l-section-title">玩法速记</div>
          <div class="c-dim-note" style="max-width:110rem;text-align:left">
            深渊每秒按超指数增长：充满 → 覆灭（回到奶茶店），清零 → 守护（前往下一片区域）。
            升级用奶茶币（每轮重置），科技用记忆点数（永不重置），角色科技树用觉醒点（可重置返还），通用树用净化点数。
            守护 / 覆灭 / 剧情播放时自动暂停，结算完自动继续。
          </div>
        </template>
      </div>

      <div class="l-status-bar">
        <span>{{ vm.message }}</span>
        <span class="c-dim-note">
          深渊 {{ vm.header.abyss }} · 产量 {{ vm.header.prod }}/s · 净化 {{ vm.header.purify }}/s
        </span>
      </div>

      <div v-if="story" class="l-story" :class="story.entry.mode === 'fullscreen' ? 'l-story--full' : 'l-story--bottom'"
        @click="nextStory">
        <div v-if="story.entry.title" class="c-story-title">{{ story.entry.title }}</div>
        <div v-if="storySpeaker" class="c-story-speaker">{{ storySpeaker }}</div>
        <div class="c-story-text">{{ storyLine }}</div>
        <div class="c-story-hint">点击继续 · {{ storyProgress }}</div>
      </div>

      <div v-if="vm.pending && !story" class="l-pending">
        <div class="c-pending-box">
          <div class="c-pending-title">{{ pendingTitle }}</div>
          <div class="c-pending-desc">{{ pendingDesc }}</div>
          <div class="c-pending-reward">{{ pendingReward }}</div>
          <button class="o-primary-btn c-pending-btn" data-action="resolve" @click="act('resolve')">
            {{ vm.pending === 'guard' ? '净化' : '覆灭结算' }}
          </button>
        </div>
      </div>

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

// ───────────────────────────── 主循环 ─────────────────────────────
const DT = TUNING.tickSeconds;
let acc = 0;
let producing = false;   // 长按生产
let produceAcc = 0;      // 生产累计时间（每 0.05s 生产一次）
let last = performance.now();
let lastSave = Date.now();
let uiTimer = 0;

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  if (!engine.s.paused && !engine.s.pending) {
    while (acc >= DT && n < 600) { engine.tick(DT); acc -= DT; n++; }
  } else {
    acc = 0;
  }
  // 长按生产：按 dt 累积，每 0.05 秒生产一次（= 每秒 20 次），与帧率无关
  if (producing) {
    produceAcc += dt;
    while (produceAcc >= DT) { produceAcc -= DT; engine.clickProduce(); }
  }

  uiTimer += dt;
  if (uiTimer > 0.12) { uiTimer = 0; app.render(); }
  if (Date.now() - lastSave > 10000) { saveGame(); lastSave = Date.now(); }
  requestAnimationFrame(frame);
}

if (!loadGame()) {
  engine = new Engine(createInitialState());
  engine.startStoryIfFirstRun();
  say('欢迎来到耶维城：先攒奶茶币，买「灌装线」。');
}
app.render();
requestAnimationFrame(frame);
window.addEventListener('beforeunload', saveGame);
bootstrapServer();
setInterval(() => { syncNow(); }, SYNC_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveGame(); syncNow(); }
});
window.__dny = {
  engine: () => engine,
  app,
  act,
  render: () => app.render(),
  give({ mtc = 0, mp = 0, pp = 0, ap = 0 } = {}) {
    const D = engine.s.mtc.constructor;
    if (mtc) engine.s.mtc = engine.s.mtc.add(D.from(String(mtc)));
    if (mp) engine.s.mp = engine.s.mp.add(D.from(String(mp)));
    if (pp) engine.s.pp = engine.s.pp.add(D.from(String(pp)));
    if (ap) engine.s.ap = engine.s.ap.add(D.from(String(ap)));
    app.render();
  },
  tree: () => treeView,
  // 临时播一条剧情（不写存档、不进 STORY 表），用于前端巡检与调试
  playStory(entry) {
    engine.s.paused = true;
    engine.s.storyActive = true;
    app.story = { entry, idx: 0, state: engine.s, createdAt: Date.now() };
    app.render();
  },
  unlock(id) {
    if (!engine.s.unlocked.includes(id)) engine.s.unlocked.push(id);
    app.render();
  },
};
