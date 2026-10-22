# dny — 龙与耶维城

多层重置增量放置游戏（反物质维度式 prestige）。玩家在耶维城经营奶茶店，用奶茶净化深渊；
深渊超指数增长，充满则覆灭、清零则守护并进入下一档。当前实现 **档 0–3**。

前端套的是 **反物质维度（AD）的壳**：AD 的 `styles.css` / `old-ui.css`、字体与图标、
`o-primary-btn` / `o-tab-btn` 这套类名约定 + Vue 2 运行时；科技树用 **vis-network**，
绘制/缩放/拖动/连线全部照搬 AD 的 Perks 树（`PerksTab.vue` 的 `PerkNetwork`）。

## 快速开始

```powershell
node server.mjs 8080        # 浏览器打开 http://127.0.0.1:8080 即可玩
```

零依赖运行（只需要 Node 20+，`vue.min.js` 已随仓库放在 `web/shell/`）。
部署到 2c2g 机器直接 `node server.mjs 80`。

## 目录

```
dny/
├── server.mjs                    零依赖静态服务器（web/ 为站点根，/src 供模块加载）
├── src/
│   ├── num.js                    Decimal 大数（等价 break_infinity）
│   ├── db.js                     数据表：四角色 8 升级 + 4 科技 + 9 科技树节点、通用树
│   └── engine.js                 引擎：效果/成本/资源/tick/深渊/存档/贡献面板
├── web/                          前端（AD 壳）
│   ├── index.html · css/game.css · js/app.js
│   └── shell/                    ← 从 ref/AD 复制的 styles.css / old-ui.css / 图片 / vue.min.js
├── test/                         Playwright 巡检 + 模拟游玩（截图在 test/screens/）
├── sim/                          纯逻辑模拟器（worker 多开、三种策略机器人）
├── docs/
│   ├── 10-设计原话-净化版.md       设计原话（权威）
│   ├── 11-下一步执行指令.md        本轮任务与验收标准
│   └── 12-实现与调平记录.md        ★ 实现说明 + 调平实测 + 前端说明 + 调参手册
└── ref/AD/                       反物质维度源码（参考，勿改）
```

## 模拟器

```powershell
node sim/simulate.mjs value 40 0.5   # 单条时间线（策略 / 最长小时 / 步长）
node sim/run.mjs 6 9 60 1            # 9 线程 × 每策略 6 条，统计通关率与每档耗时
node sim/probe.mjs value 300         # 单轮轨迹探针
```

实测（value 策略）：**12.6 小时**通关 e249209；三种策略通关率 100%，最笨策略慢 37%。

## 前端测试（Playwright）

```powershell
node server.mjs 8080
node test/ui.e2e.mjs       # 页签/按钮/弹窗全巡检，控制台 0 报错
node test/play.e2e.mjs     # 模拟游玩：升级 → 覆灭 → 守护 → 多角色 → 刷新续玩 → 窄屏
```

## 玩法要点

- 升级有**解锁链**：第 i 个升级要前一个达到 3/3/3/4/5/6/8 级才开放
- **剧情播放器**：数据在 `src/story.js`，支持全屏黑底白字 / 下方 1/3 两种模式，点击继续
- **暂停**：可手动暂停；守护、覆灭、播放剧情时自动暂停。守护后点「净化」、覆灭后点「覆灭结算」才继续
- 升级（mtc）**每轮重置**；科技（MP）与科技树（AP）永久保留
- MP / PP / AP 一律整数

## 设计要点

- 结算 20 tick/s，深渊超指数增长（零产量 249 秒满一档）
- 三层分离：升级（mtc，覆灭清空）/ 科技（MP，永不重置）/ 科技树（AP，可重置返还）
- 通用科技树（PP）独立，深节点是机制性质变而非纯倍数
- 只实现档 0–3（`2.49e249 … 2.49e249209`），档 4–7 的角色未设计
