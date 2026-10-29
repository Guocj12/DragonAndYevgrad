// src/story.js — 游戏内剧情数据（文本为作者定稿，勿改字；改触发条件即可）
//
// 规则：每一条只由游玩进度触发，没有一条挂在时间上。
//
// trigger.type
//   restart   进店（首次进入 / 每次覆灭后重开）
//             字段：count（精确覆灭数，0=首次进入）、minCount / maxCount、onlyIfSeen
//   collapse  覆灭
//             字段：tier（0–3，刚覆灭的档）、count / minCount / maxCount（总覆灭数）
//   guard     守护
//             字段：tier（0–3，刚守护的档）、count / minCount / maxCount（总守护次数）
//   win       通关（档 3 守护成功）
//   cond      进度状态，只播一次
//             字段：when { at, ... } 或 { all:[...] } / { any:[...] }
//             at: layer / level(char,position) / collapses / guards / runs / progress / time 等
//
// onlyIfSeen  「看过某条之后才播」，用来区分「第一次到达」和「第 N 次到达」。
//
// mode      'fullscreen' 全屏黑底白字 | 'bottom' 屏幕下方 1/3
// speaker   底部模式的说话人；留空 = 旁白
// title     全屏模式的章节名（可选）
// lines     一段 = 点一次。字符串走 entry.speaker；{ speaker, text } 可逐段换人
//           text 里的 '\n' 是段内换行
// repeat    true = 看过之后还会再播（受设置里「跳过已读」控制）
//
// 播放顺序：同一次结算里匹配到的条目，按本数组的顺序排队。

export const STORY = [
  // ── 进店 ─────────────────────────────────────────
  {
    id: 'intro',
    trigger: { type: 'restart' },
    mode: 'fullscreen',
    repeat: true,
    lines: [
      '你在耶维城经营着一家奶茶店',
      '耶维城面临被深渊力量吞噬的危机\n深渊会污染人的神智，把人变成怪物',
      '这种可怖的物质还会加速自我增殖，不断扩张',
      '但你的奶茶可以净化深渊，使人恢复神智',
      '尽可能多的生产奶茶，守住耶维城',
    ],
  },
  {
    id: 'boot',
    trigger: { type: 'restart', count: 0 },
    mode: 'bottom',
    lines: [
      { speaker: '', text: '249是店里的超级人工智能' },
      { speaker: '', text: '她可以全自动生产奶茶' },
      { speaker: '249', text: '店长，欢迎回来~' },
      { speaker: '249', text: '城里到处都是怪物和深渊' },
      { speaker: '249', text: '要尽快着手清理了' },
      { speaker: '249', text: '生产奶茶可以净化深渊，还能换取奶茶币' },
      { speaker: '249', text: '奶茶币可以用来购买升级，以进一步提高产量' },
      { speaker: '249', text: '从购买第一个升级开始吧~' },
    ],
  },
  {
    id: 'mp',
    trigger: { type: 'restart', count: 1 },
    mode: 'bottom',
    speaker: '249',
    lines: [
      '店长，欢迎回来~',
      '城里到处都是怪物和深渊',
      '要尽快着手清理了',
      '...我的数据库中似乎有些我没印象的东西',
      '...记忆点数...似乎能用来提升科技呢',
      '店长有什么头绪吗？',
    ],
  },
  {
    id: 'n249',
    trigger: { type: 'restart', minCount: 2 },
    mode: 'bottom',
    speaker: '249',
    repeat: true,
    lines: [
      '店长，欢迎回来~',
      '城里到处都是怪物和深渊',
      '要尽快着手清理了',
    ],
  },

  // ── 覆灭 ─────────────────────────────────────────
  {
    id: 'collapse-1',
    trigger: { type: 'collapse', minCount: 1, maxCount: 9 },
    mode: 'fullscreen',
    repeat: true,
    lines: [
      '深渊吞噬了耶维城',
      '你似乎回到了最初的起点',
    ],
  },
  {
    id: 'collapse-0a-1',
    trigger: { type: 'collapse', minCount: 2, maxCount: 9 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊吞噬了耶维城。'],
  },
  {
    id: 'collapse-0a-2',
    trigger: { type: 'collapse', minCount: 11, maxCount: 19 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊吞噬了耶维城。'],
  },
  {
    id: 'collapse-0a-3',
    trigger: { type: 'collapse', minCount: 21, maxCount: 29 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊吞噬了耶维城。'],
  },
  {
    id: 'collapse-0a-4',
    trigger: { type: 'collapse', minCount: 31 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊吞噬了耶维城。'],
  },
  {
    id: 'collapse-0b',
    trigger: { type: 'collapse', count: 10 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊又吞噬了耶维城。'],
  },
  {
    id: 'collapse-0c',
    trigger: { type: 'collapse', count: 20 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊再一次吞噬了耶维城。'],
  },
  {
    id: 'collapse-30',
    trigger: { type: 'collapse', count: 30 },
    mode: 'fullscreen',
    repeat: true,
    lines: ['深渊又吞噬了耶维城...\n你不无聊吗？'],
  },

  // ── 守护 ─────────────────────────────────────────
  {
    id: 'guard-1',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'fullscreen',
    lines: [
      '你守护了耶维城。',
      '但城外的深渊仍然蠢蠢欲动。',
    ],
  },
  {
    id: 'yewei-join',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'bottom',
    lines: [
      { speaker: '', text: '在耶维城的灾后重建中，你结识了城中经营万事屋的店主耶维奇' },
      { speaker: '', text: '他可以给你提供一些支援' },
      { speaker: '耶维奇', text: '哟，还开着呢' },
      { speaker: '耶维奇', text: '全城的重建工作还真是麻烦啊' },
      { speaker: '耶维奇', text: '我也来搭把手吧\n处理城外的深渊也算在万事屋的业务范围内嘛' },
      { speaker: '耶维奇', text: '至于人情账...先记着\n等安宁了再和你算~' },
    ],
  },
  {
    id: 'voice-1',
    trigger: { type: 'guard', tier: 0, count: 1 },
    mode: 'fullscreen',
    lines: [
      '你守护了耶维城。',
      '但远方的深渊势力仍旧不断来袭。',
    ],
  },
  {
    id: 'yewei-again',
    trigger: { type: 'guard', tier: 0, minCount: 2 },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '', text: '在耶维城的灾后重建中，你结识了城中经营万事屋的店主耶维奇' },
      { speaker: '', text: '他可以给你提供一些支援' },
      { speaker: '耶维奇', text: '哟，还开着呢。' },
      { speaker: '耶维奇', text: '全城的重建工作还真是麻烦啊' },
      { speaker: '耶维奇', text: '我也来搭把手吧' },
      { speaker: '249', text: '我的数据库中多了...' },
      { speaker: '249', text: '守护点数？似乎可以用来购买科技树呢~' },
      { speaker: '249', text: '再加把劲，努力生产奶茶吧~' },
    ],
  },

  // ── 档 2 · 白琦 ──────────────────────────────────
  {
    id: 'baiqi-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 3 } },
    mode: 'fullscreen',
    lines: [
      '你守护了飞龙国。',
      '但这片大陆上的深渊并没有停息。',
    ],
  },
  {
    id: 'baiqi-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 3 } },
    mode: 'bottom',
    lines: [
      { speaker: '', text: '你在城郊遇到一位少女' },
      { speaker: '', text: '她挥舞着比她还高的重剑\n在深渊的群怪中厮杀' },
      { speaker: '', text: '你和耶维奇救下了她，她决定与你们同行' },
      { speaker: '耶维奇', text: '这位是白琦，一个...一个战斗疯子' },
      { speaker: '白琦', text: '哎呀随便啦~等我养好伤再帮你们去清理那些怪物' },
      { speaker: '白琦', text: '哦对，两杯奶茶，全糖，谢谢！' },
      { speaker: '耶维奇', text: '...唉，还是老样子...' },
    ],
  },
  {
    id: 'baiqi-again',
    trigger: { type: 'guard', tier: 1, onlyIfSeen: 'baiqi-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '', text: '你结识了白琦' },
      { speaker: '白琦', text: '哦对，两杯奶茶，全糖，谢谢！' },
    ],
  },

  // ── 档 3 · 恒 ────────────────────────────────────
  {
    id: 'heng-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 4 } },
    mode: 'fullscreen',
    lines: [
      '你守护了奶茶大陆。',
      '但大陆之外的深渊仍在躁动。',
    ],
  },
  {
    id: 'heng-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 4 } },
    mode: 'bottom',
    lines: [
      { speaker: '', text: '在奶茶大陆深渊深处的一把长椅上，你找到了恒' },
      { speaker: '', text: '一把形状和质感奇特的武器插在他身旁' },
      { speaker: '', text: '他似乎并不会受到深渊的影响\n相反，似乎还能从中获得力量' },
      { speaker: '恒', text: '...' },
      { speaker: '恒', text: '走吧' },
    ],
  },
  {
    id: 'heng-again',
    trigger: { type: 'guard', tier: 2, onlyIfSeen: 'heng-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '', text: '你又结识了恒' },
      { speaker: '恒', text: '...' },
      { speaker: '恒', text: '走吧' },
    ],
  },

  // ── 终局 ─────────────────────────────────────────
  {
    id: 'win',
    trigger: { type: 'win' },
    mode: 'fullscreen',
    lines: [
      '你守护了这个世界',
      '...吗？',
      '放眼望去，这里已再无深渊势力',
      '————直到你抬头望向天空',
    ],
  },
];
