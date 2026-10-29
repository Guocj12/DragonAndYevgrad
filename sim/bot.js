// sim/bot.js — 已退役。
//
// V8 只有一条冻结策略：**八层自动购买科技全 22 级时，每 tick 最便宜优先买到买不起**
// （数值设计 §1.2 / §4.3），这条规则写在 src/v8.js 的 Segment.tick() 里，是数值本身的一部分。
// 手动选择、按性价比排序、预设顺序等旧策略都会改变购买顺序，从而改变结果，
// 因此这里不再提供任何可切换策略；保留本文件只是为了不让旧的 import 断掉。
//
// 需要跑完整流程请看 sim/simulate.mjs。

export function makeBot() {
  return () => {};
}

export const STRATEGIES = ['frozen-cheapest'];
