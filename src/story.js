// src/story.js — 游戏内剧情数据（文本以 docs/人物.md 为准：设定与文本冲突时先改文本）
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
//   win       （已取消）原「通关」条目改挂 guard tier 3 —— 守护第 4 层、进入第 5 层时播
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
      { speaker: '', text: '249是店里的超级人工智能' },
      { speaker: '', text: '她可以全自动生产奶茶' },
      { speaker: '', text: '你可以在设置中选择跳过已读文本' },
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
      { speaker: '', text: '他可以给你提供一些帮助' },
      { speaker: '耶维奇', text: '全城的重建工作还真是麻烦啊' },
      { speaker: '耶维奇', text: '我也来搭把手吧\n城外的活我熟' },
      { speaker: '耶维奇', text: '至于人情账...先记着\n算我欠你的~' },
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
      { speaker: '耶维奇', text: '这位是白琦\n我的老朋友了' },
      { speaker: '白琦', text: '哎呀随便啦~\n等我养好伤再帮你们去清理那些怪物' },
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
    ],
  },

  // ── 四层结尾（守护第 4 层 → 进入第 5 层）──────────
  {
    id: 'win',
    trigger: { type: 'guard', tier: 3 },
    mode: 'fullscreen',
    lines: [
      '你守护了这个世界',
      '...吗？',
      '放眼望去，这里已再无深渊势力',
      '————直到你抬头望向天空',
    ],
  },

  // ── 档 4 · 双禁（第五层 · 整颗星球）──────────────
  {
    id: 'shuangjin-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 5 } },
    mode: 'fullscreen',
    lines: [
      '你好呀~我是双禁',
      '因为实在凑不够人，只能我自己下场陪你玩啦~',
      '哦对，前面那些旁白也是我念的',
      '文笔限制只能做到这种程度啦~你将就看就好',
    ],
  },
  {
    id: 'shuangjin-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 5 } },
    mode: 'bottom',
    lines: [
      { speaker: '249', text: '店长...今天做奶茶似乎格外顺利呢' },
      { speaker: '249', text: '可能是我越来越熟练啦~' },
    ],
  },
  {
    id: 'shuangjin-again',
    trigger: { type: 'guard', tier: 3, onlyIfSeen: 'shuangjin-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '双禁', text: '好玩诶' },
      { speaker: '双禁', text: '快加油快加油，这轮多撑一会~' },
    ],
  },

  // ── 档 5 · 曦曦（第六层 · 星球之外）──────────────
  {
    id: 'xixi-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 6 } },
    mode: 'fullscreen',
    lines: [
      '你守护了奶盖星。',
      '你抬头看月亮。',
      '月亮转过来看了你一眼。',
    ],
  },
  {
    id: 'xixi-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 6 } },
    mode: 'bottom',
    lines: [
      { speaker: '249', text: '卫星观测记录：月面亮度异常上升' },
      { speaker: '白琦', text: '等一下，这月亮...是只猫？' },
      { speaker: '曦曦', text: '才不是特意下来帮你们的喵' },
      { speaker: '曦曦', text: '外面...也都是那种黑黑的东西喵...' },
      { speaker: '双禁', text: '大猫~叫~' },
      { speaker: '双禁', text: '曦曦是充能攻击类型角色' },
      { speaker: '双禁', text: '可以把生产的奶茶攒起来，然后一次性释放~' },
      { speaker: '双禁', text: '想想就很爽呢~♡' },
    ],
  },
  {
    id: 'xixi-again',
    trigger: { type: 'guard', tier: 4, onlyIfSeen: 'xixi-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '', text: '你又见到了曦曦' },
      { speaker: '曦曦', text: '外面...也都是那种黑黑的东西喵...' },
    ],
  },

  // ── 档 6 · 空喵（第七层 · 星系）──────────────────
  {
    id: 'kongmiao-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 7 } },
    mode: 'fullscreen',
    lines: [
      '近星空间清空了。',
      '星系边缘有一道紫黑的墙。',
    ],
  },
  {
    id: 'kongmiao-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 7 } },
    mode: 'bottom',
    lines: [
      { speaker: '双禁', text: '这位是空喵~' },
      { speaker: '双禁', text: '是守护星空与秩序的猫猫哦' },
      { speaker: '曦曦', text: '主人喵~好想你喵' },
      { speaker: '空喵', text: '哎哎好多深渊' },
      { speaker: '空喵', text: '我帮你们挡着，你们加油w' },
    ],
  },
  {
    id: 'kongmiao-again',
    trigger: { type: 'guard', tier: 5, onlyIfSeen: 'kongmiao-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '', text: '你又见到了空喵' },
      { speaker: '空喵', text: 'w' },
    ],
  },

  // ── 档 7 · XyT（第八层 · 宇宙）───────────────────
  {
    id: 'xyt-found',
    trigger: { type: 'cond', when: { at: 'layer', n: 8 } },
    mode: 'fullscreen',
    lines: [
      '好啦~游戏到这里就结束了~\n未完待续~',
      'XyTT2N2bTc',
      '嗯？这是什么？',
      '草为什么有bug啊这哪来的',
      '等下前面我还没亻...',
    ],
  },
  {
    id: 'xyt-line',
    trigger: { type: 'cond', when: { at: 'layer', n: 8 } },
    mode: 'bottom',
    lines: [
      { speaker: '249', text: '监控系统显示...这个宇宙似乎遇到了一些问题...' },
      { speaker: '249', text: '和深渊无关...它似乎在平等的侵蚀这个宇宙...' },
      { speaker: '249', text: '深渊也会受它的影响...' },
    ],
  },
  {
    id: 'xyt-again',
    trigger: { type: 'guard', tier: 6, onlyIfSeen: 'xyt-line' },
    mode: 'bottom',
    repeat: true,
    lines: [
      { speaker: '双禁', text: '还是它' },
      { speaker: '双禁', text: '它不会跟你说话' },
    ],
  },
  {
    id: 'universe-end',
    trigger: { type: 'guard', tier: 7 },
    mode: 'fullscreen',
    lines: [
      '你成功守护了这个宇宙！',
      '但...宇宙之外还有源源不断的深渊...',
    ],
  },
];
