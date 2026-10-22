// web/js/tree.js — 科技树：照搬 AD Perks 树的绘制方式（vis-network），但布局是「中心辐射」：
//   中心（r0）   = 科技自动化
//   主干（r1）   = 四个斜角上的四种资源翻倍
//   叶子（r2）   = 八个方向各一个，每个主干接两个叶子
//   角色树（r3+）= 从叶子沿同一方向继续向外长，5 层 9 节点（扇形展开）
// 节点是矩形（shape: 'box'），交互全部交给 vis：拖拽平移、滚轮缩放（钳 0.2~4）、点击购买、悬停 tooltip。

import { CHARACTERS, CHARACTER_ORDER, GENERIC_TREE } from '../../src/db.js';
import { Dec, formatScientific } from '../../src/num.js';

const fmt = (v) => formatScientific(v);

const FAMILY = {
  generic: { primary: '#b241e3', secondary: '#8b1cba' },
  '249': { primary: '#22aa48', secondary: '#156a2d' },
  yewei: { primary: '#8e6cd6', secondary: '#5f449e' },
  baiqi: { primary: '#e05555', secondary: '#8f2222' },
  heng: { primary: '#d8b23a', secondary: '#8a6d13' },
};

// 环半径（vis 坐标，单位任意，靠 fit 缩放）
const R = { center: 0, trunk: 190, leaf: 350 };
const CHAR_RING = 108;          // 角色每层之间的半径增量
const CHAR_START = 520;         // 角色树第一层（r3）
// 角色树每层的角度偏移（度）
const LAYER_SPREAD = {
  1: [0],
  2: [-7, 7],
  3: [-13, 0, 13],
  4: [-7, 7],
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
    this.minScale = 0.2;
    this.maxScale = 4;
    this.initialFit = false;
  }

  attach(host) {
    if (this.host === host) return;
    this.host = host;
    if (this.network) { try { this.network.destroy(); } catch (e) { /* ignore */ } }
    this.network = null;
    this.nodes = null;
    this.edges = null;
    this.container = null;
    this.signature = '';
    this.initialFit = false;
  }

  ensureContainer() {
    if (this.container) return this.container;
    const el = document.createElement('div');
    el.className = 'c-wide-canvas-element vis-network c-perk-network';
    el.tabIndex = 900;
    el.style.width = '100%';
    el.style.height = '100%';
    const canvas = document.createElement('canvas');
    canvas.className = 'c-perk-network__canvas';
    el.appendChild(canvas);
    this.host.innerHTML = '';
    this.host.appendChild(el);
    this.container = el;
    return el;
  }

  // ── 数据：节点状态 ──
  genericState(engine, n) {
    const lv = engine.s.generic[n.id] || 0;
    const maxed = n.cap && lv >= n.cap;
    const owned = !n.repeat && lv > 0;
    const unlocked = engine.genericUnlocked(n.id);
    const cost = engine.costOfGeneric(n.id, lv);
    const costText = owned ? '已解锁' : maxed ? '已满级' : !unlocked ? `需先买${engine.parentName(n.id)}` : `${fmt(cost)} PP`;
    return {
      id: n.id, name: n.name, family: 'generic',
      level: lv, repeat: !!n.repeat,
      owned: owned || maxed, unlocked,
      canBuy: unlocked && !owned && !maxed && Dec.gte(engine.s.pp, cost),
      costText,
      title: `${n.name}\n${n.desc(lv, engine.bonuses().ctx)}\n${owned ? '已解锁' : maxed ? '已满级' : !unlocked ? `需要先购买「${engine.parentName(n.id)}」` : `成本 ${fmt(cost)} PP`}`,
    };
  }

  charState(engine, charId, n) {
    const owned = !!engine.s.chars[charId].tree[n.id];
    const cost = engine.costOfTreeNode(charId, n.layer);
    // 前置：层数必须连续（第 1 层随意，之后要先买过上一层）
    const ownedLayers = CHARACTERS[charId].tree
      .filter((x) => engine.s.chars[charId].tree[x.id])
      .map((x) => x.layer);
    const maxLayer = ownedLayers.length ? Math.max(...ownedLayers) : 0;
    const layerOk = n.layer <= maxLayer + 1;
    const costText = owned ? '已解锁' : !layerOk ? '需先解锁上一层' : `${fmt(cost)} AP`;
    return {
      id: n.id, name: n.name, family: charId,
      level: 0, repeat: false, owned, layerOk,
      canBuy: layerOk && !owned && Dec.gte(engine.s.ap, cost),
      costText,
      title: `${CHARACTERS[charId].name} · ${n.name}\n${n.desc(0, engine.bonuses().ctx)}\n${owned ? '已解锁' : !layerOk ? '需要先解锁上一层的节点' : `成本 ${fmt(cost)} AP`}`,
    };
  }

  buildData(engine) {
    const nodes = [];
    const edges = [];

    // 1) 中心 + 主干 + 叶子
    const center = GENERIC_TREE.find((n) => n.slot === 'center');
    const trunks = GENERIC_TREE.filter((n) => n.slot === 'trunk');
    const leaves = GENERIC_TREE.filter((n) => n.slot === 'leaf');

    const put = (n, radius, deg) => {
      const p = toXY(radius, deg);
      nodes.push({ id: n.id, ...p, __st: this.genericState(engine, n) });
    };
    put(center, R.center, 0);
    for (const t of trunks) { put(t, R.trunk, t.angle); edges.push({ from: center.id, to: t.id }); }
    for (const leaf of leaves) {
      put(leaf, R.leaf, leaf.angle);
      edges.push({ from: leaf.parent, to: leaf.id });
    }

    // 2) 角色树：挂在同方向的叶子上
    for (const charId of CHARACTER_ORDER) {
      if (!engine.s.unlocked.includes(charId)) continue;
      const baseAngle = CHARACTERS[charId].angle;
      const tree = CHARACTERS[charId].tree;
      const layers = [...new Set(tree.map((n) => n.layer))].sort((a, b) => a - b);
      const ringFor = (layer) => CHAR_START + (layer - 1) * CHAR_RING;
      layers.forEach((layer) => {
        const group = tree.filter((n) => n.layer === layer);
        const spread = LAYER_SPREAD[layer] || group.map((_, i) => (i - (group.length - 1) / 2) * 18);
        group.forEach((n, i) => {
          const deg = baseAngle + (spread[i] ?? 0);
          const p = toXY(ringFor(layer), deg);
          nodes.push({ id: n.id, ...p, __st: this.charState(engine, charId, n) });
        });
      });
      // 叶子 → 角色第一层；层间：上一层第一个节点连到下一层全部节点
      const leaf = leaves.find((l) => l.angle === baseAngle);
      const first = tree.filter((n) => n.layer === layers[0]);
      if (leaf && first.length) edges.push({ from: leaf.id, to: first[0].id });
      for (let li = 1; li < layers.length; li++) {
        const from = tree.find((n) => n.layer === layers[li - 1]);
        for (const to of tree.filter((n) => n.layer === layers[li])) {
          edges.push({ from: from.id, to: to.id });
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
    const lv = st.repeat ? ` Lv${st.level}` : '';
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
          widthConstraint: { minimum: 118, maximum: 150 },
          font: { size: 23, face: 'Typewriter', multi: true, vadjust: 0 },
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
      // 首次渲染定位到中心并给一个合适缩放（之后保留玩家视角）
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

  // 全树自适应：fit 之后把缩放钳在一个舒服的区间
  resetView() {
    if (!this.network) return;
    this.network.fit({ animation: false });
    const s = this.network.getScale();
    const clamped = Math.min(0.85, Math.max(0.34, s));
    if (Math.abs(clamped - s) > 0.001) this.network.moveTo({ scale: clamped });
  }

  fitTree() { this.resetView(); }
}
