// src/story.js — 剧情文本（数据驱动，不写死在代码里）
//
// ⚠ 现状：剧情表为空。此前的全部剧情文本已清空，等设计者给新设计后往里填。
//    引擎、播放器、条件触发都保留可用；往 STORY 里加对象即可，不改代码。
//
// ── 触发方式（trigger）─────────────────────────────────────────
//   事件型：
//     { type: 'firstRun' }                      第一次进入游戏
//     { type: 'guard',    tier?: x, count?: y } 在档 x 的第 y 次守护
//     { type: 'collapse', tier?: x, count?: y } 在档 x 的第 y 次覆灭
//     { type: 'win' }                           最高档净化成功
//   条件型（引擎每 0.5 秒轮询一次，命中即播，一次只推一条）：
//     { type: 'cond', when: {...} }
//       when.at: 'tier' | 'mtc' | 'cycles' | 'guards' | 'time' | 'ap' | 'prog'
//              | 'upgrade' | 'tech' | 'node' | 'tree'
//       tier: n / mtc: log / cycles|guards|ap: n / time: sec / prog: gte
//       upgrade|tech: { char, idx, level }   node: { id, level }   tree: { char, id }
//       组合：{ all: [cond, cond] } / { any: [cond, cond] }，可任意嵌套
//
// ── 播放方式（mode）────────────────────────────────────────────
//   'fullscreen'  全黑屏，居中白字；可选 title 显示在顶部
//   'bottom'      遮住下方 1/3，白字；可选 speaker 显示在左上（角色名）
//
//   lines：多段连续播放，点击继续；最后一段点完自动消失。
//
// ── 条目结构 ──────────────────────────────────────────────────
//   { id, trigger, mode, speaker?, title?, lines: [] }
//   id 唯一；同一 id 只播一次（storySeen 记录）。

export const STORY = [];

export const STORY_BY_ID = Object.fromEntries(STORY.map((s) => [s.id, s]));
