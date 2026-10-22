// src/story.js — 剧情文本（数据驱动）
// 触发节点：
//   { type: 'firstRun' }                    第一次进入游戏
//   { type: 'guard',    tier: x, count: y }  在档 x 的第 y 次守护时
//   { type: 'collapse', tier: x, count: y }  在档 x 的第 y 次覆灭时
// 播放类型：
//   mode: 'fullscreen'  全黑屏，中间白字
//   mode: 'bottom'      只遮住下方 1/3 屏幕，白字
// lines：多段连续播放，点击继续；最后一段点击后自动消失

export const STORY = [
  {
    id: 'intro',
    trigger: { type: 'firstRun' },
    mode: 'fullscreen',
    lines: [
      '耶维城，一座被深渊缓慢吞掉的城市。',
      '深渊每秒都更黑一点，而这座城里唯一还能反抗它的东西，是一杯奶茶。',
      '你是唯一还开着的店。开机吧。',
    ],
  },
  {
    id: 'first-collapse',
    trigger: { type: 'collapse', tier: 0, count: 1 },
    mode: 'fullscreen',
    lines: [
      '深渊漫过了杯口。',
      '街道、招牌、还有你刚攒起来的一切，都被抹平了。',
      '……但有些东西留下来了。记忆、协议、还有那棵还没长开的树。',
    ],
  },
  {
    id: 'first-guard',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'bottom',
    lines: [
      '249：深渊清零。上限 +1 档。',
      '249：别高兴太早——下一档的深渊，指数是这一档的十倍。',
      '249：我会把这一轮记进数据库。你不记得，我记得。',
    ],
  },
  {
    id: 'yewei-join',
    trigger: { type: 'guard', tier: 1, count: 1 },
    mode: 'bottom',
    lines: [
      '一个穿旧西装的男人推开店门，肩上落着灰。',
      '耶维奇：「万事屋，什么活都接。」',
      '耶维奇：「听说你这儿的奶茶能压深渊？那我也开几条产线。」',
    ],
  },
  {
    id: 'baiqi-join',
    trigger: { type: 'guard', tier: 2, count: 1 },
    mode: 'bottom',
    lines: [
      '白发少女把重剑往地上一插，剑身还在响。',
      '白琦：「深渊里有东西在叫我。」',
      '白琦：「我砍它。你负责别死。」',
    ],
  },
  {
    id: 'heng-join',
    trigger: { type: 'guard', tier: 3, count: 1 },
    mode: 'bottom',
    lines: [
      '少年骑士从深渊里走出来，骨钉上还在滴黑色的东西。',
      '恒：「我和它同源。」',
      '恒：「它越强，我越强。所以——让它再强一点。」',
    ],
  },
  {
    id: 'deep-collapse',
    trigger: { type: 'collapse', tier: 2, count: 3 },
    mode: 'bottom',
    lines: [
      '249：第 3 次在档 2 覆灭。',
      '249：数据在累积。你每重来一次，我们就更接近那个上限一次。',
      '249：继续。',
    ],
  },
  {
    id: 'long-haul',
    trigger: { type: 'collapse', tier: 3, count: 20 },
    mode: 'bottom',
    lines: [
      '249：档 3，第二十次。',
      '249：我知道这听起来像在挖一口没有底的井。',
      '249：但井底已经能看见光了。',
    ],
  },
];

export const STORY_BY_ID = Object.fromEntries(STORY.map((s) => [s.id, s]));
