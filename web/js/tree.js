// web/js/tree.js — 科技树：沿用 586164c 的 AD Perks 式绘制（vis-network），布局「中心辐射」：
//   中心（r0）   = 自动化中枢（13 级，PP）
//   主干（r1）   = 四个斜角节点 = 现有的四项成功科技（净化效率 / 伤害效率 / MP 倍率 / PP 倍率）
//   叶子（r2）   = 八个方向各一个，保留旧节点名，效果为空、价格 0
//   角色树（r3+）= 8 个角色 × 9 节点（5 层扇形），AP 结构复原但效果为空、不可购买
// 节点是矩形（shape: 'box'）；拖拽平移、滚轮缩放（钳 0.2~4）、点击购买、悬停 tooltip。

import { CHARACTERS, CHARACTER_ORDER } from '../../src/db.js';
import {
  TREE_CENTER, TREE_TRUNKS, TREE_LEAVES, CHAR_TREE_NODES, treeInterval, centerCost,
} from '../../src/tree.js';

const FAMILY = {
  generic: { primary: '#b241e3', secondary: '#8b1cba' },
  '249': { primary: '#22aa48', secondary: '#156a2d' },
  yewei: { primary: '#8e6cd6', secondary: '#5f449e' },
  baiqi: { primary: '#e05555', secondary: '#8f2222' },
  heng: { primary: '#d8b23a', secondary: '#8a6d13' },
  shuangjin: { primary: '#4bb3c9', secondary: '#2b6d7d' },
  xixi: { primary: '#e0863e', secondary: '#8a4d16' },
  kongmiao: { primary: '#6f52e8', secondary: '#151029' },
  xyt: { primary: '#8d8d8d', secondary: '#4d4d4d' },
};

// 环半径（vis 坐标，单位任意，靠 fit 缩放）
const R = { center: 0, trunk: 220, leaf: 400 };
const CHAR_RING = 120;
const CHAR_START = 600;
const LAYER_SPREAD = {
  1: [0],
  2: [-9, 9],
  3: [-18, 0, 18],
  4: [-9, 9],
  5: [0],
};

const toXY = (radius, deg) => ({
  x: Math.cos((deg * Math.PI) / 180) * radius,
  y: -Math.sin((deg * Math.PI) / 180) * radius,
});

export class TreeView {
  constructor(host, { onBuy, getEngine }) {
    this.host = host;
    this.onBuy = onBuy;
    this.getEngine = getEngine;
    this.network = null;
    this.nodes = null;
    this.edges = null;
    this.signature = '';
    this.container = null;
    this.minScale = 0.12;
    this.maxScale = 4;
    this.initialFit = false;
  }

  attach(host) {
    if (this.host === host && this.container && this.container.isConnected) return;
    this.host = host;
    if (this.network) { try { this.network.destroy(); } catch (e) { /* ignore */ } }
    this.network = null;
    this.nodes = null;
    this.edges = null;
    this.container = null;
    this.signature = '';
    this.initialFit = false;
  }

  /**
   * 离开科技树页时调用：销毁 vis 实例并把容器从 DOM 摘掉。
   * 不这么做的话，Vue 会就地复用这个 div（同名 div 走 patch），残留 canvas 会挤进升级页的栅格，
   * 并被后续 render 反复追加，页面高度就一直往下涨。
   */
  detach() {
    if (this.network) { try { this.network.destroy(); } catch (e) { /* ignore */ } }
    this.network = null;
    this.nodes = null;
    this.edges = null;
    this.signature = '';
    this.initialFit = false;
    if (this.container && this.container.parentElement) this.container.remove();
    this.container = null;
    this.host = null;
  }

  ensureContainer() {
    if (this.container && this.container.isConnected && this.container.parentElement === this.host) {
      return this.container;
    }
    const el = document.createElement('div');
    el.className = 'c-wide-canvas-element vis-network c-perk-network';
    el.tabIndex = 900;
    el.style.width = '100%';
    el.style.height = '100%';    const canvas = document.createElement('canvas');
    canvas.className = 'c-perk-network__canvas';
    el.appendChild(canvas);
    this.host.innerHTML = '';
    this.host.appendChild(el);
    this.container = el;
    return el;
  }

  // ── 单个节点的状态（引擎给出的 treeNodes() 是唯一数据源）──
  state(engine, n) {
    const pp = engine.permanent.successWallet;
    if (n.slot === 'center') {
      const cost = centerCost(n.level);
      const canBuy = cost !== null && pp >= cost;
      return {
        id: n.id, name: n.name, family: 'generic',
        level: n.level, max: n.maxLevel, cost,
        canBuy, owned: n.level > 0,
        costText: cost === null ? '已满级' : `${cost} 守护点数`,
        title: `${n.name} Lv ${n.level}/${n.maxLevel}\n${n.desc}\n`
          + `自动间隔：${treeInterval(n.level) === Infinity ? '—' : `${treeInterval(n.level)} 秒`}`,
      };
    }
    const canBuy = !!n.canBuy;
    return {
      id: n.id, name: n.name, family: n.slot === 'char' ? n.charId : 'generic',
      level: n.level, max: n.maxLevel || null, cost: n.cost,
      canBuy, owned: (n.level || 0) > 0,
      costText: n.cost === null ? '未开放' : (canBuy ? `${n.cost} 守护点数` : '需前置'),
      title: `${n.name}${n.stat ? `（${n.stat}）` : ''} Lv ${n.level}\n${n.desc}\n`
        + (n.cost === null ? '不可购买' : (canBuy ? `下一级 ${n.cost} 守护点数` : n.blocked || '需前置')),
    };
  }

  buildData(engine) {
    const nodes = [];
    const edges = [];
    const byId = new Map(engine.treeNodes().map((n) => [n.id, n]));
    const put = (n, x, y) => { if (n) nodes.push({ id: n.id, x, y, __st: this.state(engine, n) }); };

    put(byId.get(TREE_CENTER.id), 0, 0);

    for (const t of TREE_TRUNKS) {
      const p = toXY(R.trunk, t.angle);
      put(byId.get(t.id), p.x, p.y);
      edges.push({ from: TREE_CENTER.id, to: t.id });
    }
    for (const lf of TREE_LEAVES) {
      const p = toXY(R.leaf, lf.angle);
      put(byId.get(lf.id), p.x, p.y);
      edges.push({ from: lf.parent, to: lf.id });
    }

    for (const charId of CHARACTER_ORDER) {
      const baseAngle = CHARACTERS[charId].angle;
      const list = CHAR_TREE_NODES[charId] || [];
      const layers = [...new Set(list.map((n) => n.layer))].sort((a, b) => a - b);
      const ringFor = (layer) => CHAR_START + (layer - 1) * CHAR_RING;
      layers.forEach((layer) => {
        const group = list.filter((n) => n.layer === layer);
        const spread = LAYER_SPREAD[layer] || group.map((_, i) => (i - (group.length - 1) / 2) * 18);
        group.forEach((n, i) => {
          const p = toXY(ringFor(layer), baseAngle + (spread[i] ?? 0));
          put(byId.get(n.id), p.x, p.y);
        });
      });
      const leaf = TREE_LEAVES.find((l) => l.angle === baseAngle);
      const firstLayer = list.filter((n) => n.layer === layers[0]);
      if (leaf && firstLayer.length) edges.push({ from: leaf.id, to: firstLayer[0].id });
      for (let li = 1; li < layers.length; li++) {
        const from = list.find((n) => n.layer === layers[li - 1]);
        for (const to of list.filter((n) => n.layer === layers[li])) {
          if (from) edges.push({ from: from.id, to: to.id });
        }
      }
    }
    return { nodes, edges };
  }

  colorOf(st) {
    const c = FAMILY[st.family] || FAMILY.generic;
    if (st.canBuy) {
      return {
        background: '#f2f2f2', border: c.primary,
        hover: { background: c.primary, border: c.primary },
        highlight: { background: '#f2f2f2', border: c.primary },
      };
    }
    if (st.owned) {
      return {
        background: c.primary, border: c.secondary,
        hover: { background: c.primary, border: c.secondary },
        highlight: { background: c.primary, border: c.secondary },
      };
    }
    return {
      background: '#2a2f3a', border: c.secondary,
      hover: { background: '#3a4150', border: c.secondary },
      highlight: { background: '#2a2f3a', border: c.secondary },
    };
  }

  decorate(st) {
    return {
      color: this.colorOf(st),
      font: { color: st.canBuy ? '#111111' : (st.owned ? '#0b0b0b' : '#c9d2e0') },
      borderWidth: st.owned ? 3 : 2,
      shapeProperties: { borderRadius: 6 },
    };
  }

  label(st) {
    const lv = st.max ? ` Lv${st.level}/${st.max}` : (st.level ? ` Lv${st.level}` : '');
    return `${st.name}${lv}\n${st.costText}`;
  }

  sync(engine) {
    const { nodes, edges } = this.buildData(engine);
    const data = nodes.map((n) => ({
      id: n.id, x: n.x, y: n.y, label: this.label(n.__st), title: n.__st.title, ...this.decorate(n.__st),
    }));
    const sig = JSON.stringify(data.map((n) => [n.id, n.label, n.x, n.y]));

    this.ensureContainer();
    if (!this.network) {
      this.nodes = new vis.DataSet(data);
      this.edges = new vis.DataSet(edges);
      this.network = new vis.Network(this.container, { nodes: this.nodes, edges: this.edges }, {
        physics: false,
        interaction: {
          hover: true, hoverConnectedEdges: false, selectConnectedEdges: false,
          tooltipDelay: 0, dragNodes: false, zoomView: true, dragView: true,
        },
        nodes: {
          shape: 'box',
          margin: 12,
          widthConstraint: { minimum: 104, maximum: 132 },
          font: { size: 19, face: 'Typewriter', multi: true, vadjust: 0 },
          shadow: true,
          chosen: false,
        },
        edges: {
          width: 3, shadow: false, smooth: false,
          color: { inherit: false, color: 'rgba(150,150,170,0.45)' },
        },
      });
      this.network.on('click', (params) => {
        const id = params.nodes[0];
        if (id) this.onBuy(id);
      });
      this.network.on('zoom', () => {
        const scale = this.network.getScale();
        const clamped = Math.min(this.maxScale, Math.max(this.minScale, scale));
        if (scale !== clamped) this.network.moveTo({ scale: clamped });
      });
      this.signature = sig;
      setTimeout(() => {
        if (this.network && !this.initialFit) {
          this.resetView();
          this.initialFit = true;
        }
      }, 30);
      return;
    }

    if (sig !== this.signature) {
      const view = this.network.getViewPosition();
      const scale = this.network.getScale();
      this.nodes.clear();
      this.edges.clear();
      this.nodes.add(data);
      this.edges.add(edges);
      this.network.moveTo({ position: view, scale });
      this.signature = sig;
      return;
    }
    this.nodes.update(data);
  }

  resetView() {
    if (!this.network) return;
    this.network.fit({ animation: false });
    const s = this.network.getScale();
    const clamped = Math.min(0.95, Math.max(0.12, s));
    if (Math.abs(clamped - s) > 0.001) this.network.moveTo({ scale: clamped });
  }

  fitTree() { this.resetView(); }
}
