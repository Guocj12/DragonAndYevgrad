// web/js/app.js — 龙与耶维城 前端（AD 壳：Vue 2 + AD 的 styles.css/old-ui.css 类名与版式）
// 逻辑全部来自 ../../src/engine.js，本文件只做「引擎 → 视图模型 → 模板」的桥接。

import { Dec, formatScientific, formatTime } from '../../src/num.js';
import {
  ENGINE_VERSION, Engine, createInitialState, deserialize, serialize, tierCapLog,
} from '../../src/engine.js';
import { CHARACTERS, CHARACTER_ORDER, TUNING } from '../../src/db.js';
import { TreeView } from './tree.js';

const SAVE_KEY = 'dny-save-v1';
const fmt = (v) => formatScientific(v);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// ───────────────────────────── 引擎与存档 ─────────────────────────────
let engine = new Engine(createInitialState());
let message = '欢迎来到耶维城：先攒 mtc，买「灌装线」。';
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
      say(`离线 ${formatTime(elapsed)} 结束：档位 ${engine.s.tier}，累计覆灭 ${engine.s.stats.cycles} 次`);
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
  tabs.push({ id: 'tree', name: '科技树', kind: 'tree' });
  tabs.push({ id: 'stats', name: '数据', kind: 'stats' });
  tabs.push({ id: 'options', name: '设置', kind: 'options' });
  return tabs;
};

function headerVM() {
  const s = engine.s;
  const b = engine.bonuses();
  const yS = Math.max(0, Dec.log10(s.S));
  const yCap = tierCapLog(s.tier);
  const progress = Math.max(0, Math.min(1, yS / yCap));
  return {
    mtc: fmt(s.mtc), mp: fmt(s.mp), pp: fmt(s.pp), ap: fmt(s.ap),
    tier: s.tier, tierMax: TUNING.maxTier,
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
    const maxLevel = u.maxLevel || 10;
    const maxed = lv >= maxLevel;
    const bulk = engine.bulkInfo(charId, i, TUNING.bulkGroup);
    return {
      key: u.id, name: u.name, level: lv, maxLevel, maxed, unlocked,
      levelText: `Lv ${lv} / ${maxLevel}`,
      reqText: unlocked ? '' : `需要「${prevName}」Lv${u.reqLevel}`,
      desc: u.desc(lv, b.ctx),
      preview: engine.upgradePreview(charId, i),
      previewLine: maxed
        ? `当前 ${engine.upgradePreview(charId, i)}（已满级）`
        : `当前 ${engine.upgradePreview(charId, i)} → 下一级 ${engine.upgradePreview(charId, i, lv + 1)}`,
      bulkCount: bulk.count,
      costLabel: maxed ? '已满级'
        : bulk.count > 0 ? `买 ${bulk.count} 个 · ${fmt(bulk.total)} mtc`
          : `${fmt(cost)} mtc`,
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
      cost: maxed ? '已满级' : `${fmt(cost)} MP`,
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
      ['档位', s.tier],
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
  if (activeTab === 'tree') { page.kind = 'tree'; body.treeStat = treeSummaryVM(); }
  else if (activeTab === 'stats') { page.kind = 'stats'; Object.assign(body, statsVM()); }
  else if (activeTab === 'options') { page.kind = 'options'; }
  else {
    if (!engine.s.unlocked.includes(activeTab)) activeTab = '249';
    page.charId = activeTab;
    page.sub = activeSub;
    body.upgrades = activeSub === 'upgrades' ? upgradeListVM(activeTab) : [];
    body.techs = activeSub === 'techs' ? techListVM(activeTab) : [];
    body.charInfo = { name: CHARACTERS[activeTab].name, title: CHARACTERS[activeTab].title, blurb: CHARACTERS[activeTab].blurb };
  }
  return {
    header: headerVM(), tabs: TAB_DEFS(), activeTab, activeSub, page, body,
    message, modal,
    pending: engine.s.pending,
    paused: engine.s.paused,
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
      if (engine.s.chars[charId].upgrades[idx] >= (u.maxLevel || 10)) say('已经满级了');
      else say('mtc 还不够买下一级');
    }
  }
}

function act(action, payload) {
  switch (action) {
    case 'tab': activeTab = payload; break;
    case 'sub': activeSub = payload; break;
    case 'upgrade': doBuy(payload.charId, payload.index); break;
    case 'tech': engine.buyTech(payload.charId, payload.index); break;
    case 'treeBuy': {
      const id = payload;
      if (id.startsWith('g')) {
        if (!engine.genericUnlocked(id)) say(`需要先购买「${engine.parentName(id)}」`);
        else if (!engine.buyGeneric(id)) say('PP 不够或已满级');
      }
      else {
        const charId = CHARACTER_ORDER.find((c) => CHARACTERS[c].tree.some((n) => n.id === id));
        if (charId) {
          const node = CHARACTERS[charId].tree.find((n) => n.id === id);
          const owned = CHARACTERS[charId].tree.filter((x) => engine.s.chars[charId].tree[x.id]).map((x) => x.layer);
          const maxLayer = owned.length ? Math.max(...owned) : 0;
          if (!engine.s.chars[charId].tree[id] && node.layer > maxLayer + 1) say('需要先解锁上一层的节点');
          else if (!engine.buyTreeNode(charId, id)) say('AP 不够');
        }
      }
      break;
    }
    case 'respec': {
      const back = engine.respecTree(payload.charId);
      say(`已重置 ${CHARACTERS[payload.charId].name} 科技树，返还 ${fmt(back)} AP`);
      break;
    }
    case 'pause': engine.togglePause(); say(engine.s.paused ? '已暂停（可以继续购买）' : '继续'); break;
    case 'resolve': {
      const out = engine.resolvePending();
      if (out) {
        const parts = [`MP +${fmt(out.mp)}`];
        if (Dec.gt(out.pp, 0)) parts.push(`PP +${fmt(out.pp)}`);
        if (Dec.gt(out.ap, 0)) parts.push(`AP +${fmt(out.ap)}`);
        say(out.kind === 'guard'
          ? `净化完成：上限 +1 档（当前档 ${out.nextTier}），${parts.join('，')}`
          : `覆灭结算：回到档 0，${parts.join('，')}`);
      }
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
    storyLine() { return this.story ? this.story.entry.lines[this.story.idx] : ''; },
    storyProgress() { return this.story ? `${this.story.idx + 1} / ${this.story.entry.lines.length}` : ''; },
    pendingTitle() { return engine.s.pending === 'guard' ? '深渊已清零' : '深渊已满'; },
    pendingDesc() {
      return engine.s.pending === 'guard'
        ? '点击「净化」结算本轮：获得 MP / PP，并进入下一档。'
        : '点击「覆灭结算」：获得 MP，回到档 0；升级清空，科技与科技树保留。';
    },
    pendingReward() {
      if (!engine.s.pending) return '';
      const b = engine.bonuses();
      const base = Dec.add(TUNING.mpPerCollapse, Math.floor(engine.s.run.bestPurify * TUNING.mpPurifyFactor));
      const mp = Math.floor(Dec.mul(base, b.mpGain).toNumber());
      if (engine.s.pending === 'guard') {
        const pp = Math.floor(Dec.mul(TUNING.ppPerGuard * (engine.s.tier + 1), 1).mul(b.ppGain).toNumber());
        return `预计获得：MP +${mp}，PP +${pp}`;
      }
      return `预计获得：MP +${mp}`;
    },
  },
  methods: {
    render() {
      this.vm = buildVM();
      if (!this.story && engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0 };
      }
      if (this.story && !engine.s.storyActive) this.story = null;
      if (this.vm.activeTab === 'tree') this.$nextTick(() => this.syncTree());
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
    buy(item) {
      if (item.kind === 'upgrade') act('upgrade', item);
      else act('tech', item);
    },
    nextStory() {
      if (!this.story) return;
      if (this.story.idx + 1 < this.story.entry.lines.length) { this.story.idx++; return; }
      engine.finishStory();
      this.story = null;
      if (engine.s.storyQueue.length) {
        const entry = engine.nextStory();
        if (entry) this.story = { entry, idx: 0 };
      }
      this.render();
    },
  },
  mounted() { this.render(); },
  template: `
    <div id="container" class="container c-old-ui l-old-ui" :class="{ 'is-paused': vm.paused }">
      <div class="l-game-header c-game-header">
        <div class="c-header-res"><span class="c-header-res__label">mtc</span><span class="c-header-res__value">{{ vm.header.mtc }}</span></div>
        <div class="c-header-res c-header-res--mp"><span class="c-header-res__label">MP</span><span class="c-header-res__value">{{ vm.header.mp }}</span></div>
        <div class="c-header-res c-header-res--pp"><span class="c-header-res__label">PP</span><span class="c-header-res__value">{{ vm.header.pp }}</span></div>
        <div class="c-header-res c-header-res--ap"><span class="c-header-res__label">AP</span><span class="c-header-res__value">{{ vm.header.ap }}</span></div>
        <div class="c-header-tier">档 {{ vm.header.tier }} / {{ vm.header.tierMax }}</div>
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
        <button class="o-tab-btn o-tab-btn--secondary" :class="{ 'o-tab-btn--active': vm.activeSub === 'upgrades' }"
          @click="act('sub', 'upgrades')">升级</button>
        <button class="o-tab-btn o-tab-btn--secondary" :class="{ 'o-tab-btn--active': vm.activeSub === 'techs' }"
          @click="act('sub', 'techs')">科技</button>
        <span class="c-hint">每次点击最多买到「下一个 10 的倍数」：36 → 40，10 → 20；买不起就尽量买</span>
      </div>

      <div class="l-old-ui__page l-tab-page">
        <template v-if="vm.page.kind === 'char'">
          <div class="l-section-title">{{ vm.body.charInfo.name }} · {{ vm.body.charInfo.title }}</div>
          <div class="c-hint" style="text-align:left;max-width:110rem">{{ vm.body.charInfo.blurb }}</div>
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
          <div v-else class="l-upgrade-grid">
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
        </template>

        <template v-else-if="vm.page.kind === 'tree'">
          <div class="l-section-title">
            科技树 <span class="c-hint">滚轮缩放 · 拖动平移 · 点击节点购买（绘制逻辑照搬 AD 的 Perks 树）</span>
            <button class="o-primary-btn" style="margin-left:1rem" @click="act('treeFit')">重置视角</button>
          </div>
          <div class="c-tree-host-wrap">
            <div ref="treeHost" class="c-tree-host"></div>
          </div>
          <div class="l-tree-actions">
            <div v-for="c in vm.body.treeStat" :key="c.charId" class="c-tree-action">
              <span>{{ c.name }} 科技树（{{ c.count }} / 9）</span>
              <button class="o-primary-btn" @click="act('respec', { charId: c.charId })">重置并返还 AP</button>
            </div>
          </div>
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
            深渊每秒按超指数增长：充满 → 覆灭（回到档 0），清零 → 守护（进下一档）。
            升级用 mtc（每轮重置），科技用 MP（永不重置），科技树用 AP（可重置返还），通用树用 PP。
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
  uiTimer += dt;
  if (uiTimer > 0.12) { uiTimer = 0; app.render(); }
  if (Date.now() - lastSave > 10000) { saveGame(); lastSave = Date.now(); }
  requestAnimationFrame(frame);
}

if (!loadGame()) {
  engine = new Engine(createInitialState());
  engine.startStoryIfFirstRun();
  say('欢迎来到耶维城：先攒 mtc，买「灌装线」。');
}
app.render();
requestAnimationFrame(frame);
window.addEventListener('beforeunload', saveGame);
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
  unlock(id) {
    if (!engine.s.unlocked.includes(id)) engine.s.unlocked.push(id);
    app.render();
  },
};
