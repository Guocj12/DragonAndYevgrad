// src/story.js — 剧情文本（数据驱动，不写死在代码里）
//
// ── 条目结构 ──────────────────────────────────────────────────
//   { id, trigger, mode, repeat?, speaker?, title?, lines: [] }
//   id 唯一。repeat: true 表示每次触发都播（未标 repeat 的只播一次）。
//   lines 里的每一段可以是：
//     '字符串'                         普通一段
//     { speaker, text }               这一段单独指定说话人；speaker 为空串则当旁白（不显示名字）
//   text 里的 \n 是段内换行。
//
// ── 触发方式（trigger）─────────────────────────────────────────
//   { type: 'restart' }                       进店 / 每次覆灭后重开
//   { type: 'restart', count: 1 }             第 1 次覆灭后的重开
//   { type: 'guard',    tier?: x, count?: y } 在档 x 的第 y 次守护
//   { type: 'collapse', tier?: x, count?: y } 在档 x 的第 y 次覆灭
//   { type: 'win' }                           最高档净化成功
//   { type: 'cond', when: {...} }             条件型，每 0.5s 轮询一次（详见引擎 condMet）
//     when.at: 'tier' | 'mtc' | 'cycles' | 'guards' | 'time' | 'ap' | 'prog'
//            | 'upgrade' | 'tech' | 'node' | 'tree'；支持 { all: [...] } / { any: [...] }
//
// ── 播放方式（mode）────────────────────────────────────────────
//   'fullscreen'  全黑屏，居中白字；可选 title 显示在顶部
//   'bottom'      遮住下方 1/3；有 speaker 时左上角显示名字
//
// 文本格式（作者定）：每个换行 = 一段；`/` = 段内换行；`（）` = 无 speaker 的旁白；
// 有「角色：」= 底部对话；没有角色和冒号 = 全屏。文本稿见 docs/15-剧情文本.md。

export const STORY = [
  // ── 开场（首次进店 + 每次覆灭后重开）──
  {
    id: 'intro',
    trigger: { type: 'restart' },
    repeat: true,
    mode: 'fullscreen',
    lines: [
      '你在耶维城经营着一家奶茶店',
      '耶维城面临被深渊吞噬的危机\n深渊会污染人的神智，把人变成怪物',
      '这种可怖的物质还会加速自我增殖，不断扩张',
      '但你的奶茶可以净化深渊，使人恢复神智',
      '尽可能多的生产奶茶，守住耶维城',
    ],
  },
  // ── 249 登场与教学（紧接着开场；每次重开也播）──
  {
    id: '249-intro',
    trigger: { type: 'restart' },
    repeat: true,
    mode: 'bottom',
    lines: [
      { speaker: '', text: '249是奶茶店的人工智能' },
      { speaker: '', text: '她可以全自动生产奶茶' },
      { speaker: '249', text: '店长您回来了~\n奶茶产线还在正常工作' },
      { speaker: '249', text: '现在城内到处都是深渊和它的怪物们' },
      { speaker: '249', text: '要尽快提高奶茶产量来净化深渊了' },
    ],
  },
  // ── 第一次覆灭后的重开（只播一次）──
  {
    id: 'first-restart',
    trigger: { type: 'restart', count: 1 },
    mode: 'bottom',
    lines: [
      { speaker: '249', text: '这里还有...记忆点数' },
      { speaker: '249', text: '好像可以用来提升一些科技' },
      { speaker: '249', text: '为什么记忆库中有内容，但我却没有一点印象' },
      { speaker: '249', text: '店长有什么头绪吗' },
      { speaker: '249', text: '不管了，还是先继续生产奶茶要紧' },
    ],
  },
  // ── 覆灭（每次）──
  {
    id: 'collapse',
    trigger: { type: 'collapse' },
    repeat: true,
    mode: 'fullscreen',
    lines: [
      '深渊吞噬了耶维城',
    ],
  },
  // ── 第一次净化（档 0 首次守护）──
  {
    id: 'first-guard',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'fullscreen',
    lines: [
      '经过你和249的努力，城内的深渊被完全清除了',
      '耶维城的居民在尽力进行战后重建\n你结识了城内经营万事屋的店主 耶维奇',
      '城内的危机解除，但城外仍旧遍布深渊势力',
      '若不及时解决，深渊仍旧会反扑',
    ],
  },
  // ── 耶维奇登场（紧接第一次净化）──
  {
    id: 'yewei-join',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'bottom',
    lines: [
      { speaker: '耶维奇', text: '哟，还开着呢' },
      { speaker: '耶维奇', text: '全城的重建工作还真是麻烦啊' },
      { speaker: '耶维奇', text: '我也来搭把手吧\n处理城外的深渊也算在万事屋的业务范围内嘛' },
      { speaker: '耶维奇', text: '至于人情账...先记着\n等安宁了再和你算~' },
    ],
  },
];

export const STORY_BY_ID = Object.fromEntries(STORY.map((s) => [s.id, s]));
