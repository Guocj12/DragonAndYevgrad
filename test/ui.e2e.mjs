// test/ui.e2e.mjs — 前端巡检（V5 外壳）
//
// 旧的巡检脚本覆盖的是已经退役的机制（升级解锁链、手动购买、待结算按钮、vis-network 科技树、
// 数据页四大乘区），V5 之后这些都不存在了。现在前端巡检 = 外壳自检 + HUD 与引擎一致性，
// 全部断言在 v5-shell.e2e.mjs；端到端整程验收在 v5-campaign.e2e.mjs；操作流在 play.e2e.mjs。
//
// 用法：node server.mjs 8080  然后 node test/ui.e2e.mjs [url]

import './v5-shell.e2e.mjs';
