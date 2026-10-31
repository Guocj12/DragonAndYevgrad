// tools/gen-debug-jumps.mjs — 生成「各层首次进入」的调试存档数据 → src/debug.js
//
//   node tools/gen-debug-jumps.mjs
//
// 口径：跑 v8.js 的完整确定性流程（= docs/数值设计.md §12 八层检查点旅程，settle 默认
// 自动购买永久），在**第一次创建某个 stage 的片段**的那一刻把整个状态拍下来。
// 所以每个入口 = 玩家按数值文档自然玩到该层时的真实状态：永久等级 F/U、钱包 WF/WS、
// 轮数、统计全部对得上 §12.2 / §12.4。对拍锚写死在文件末尾，文档改了或代码漂了会直接抛错。
import fs from 'node:fs';
import {
  CONFIG, Segment, Scientific, initialPermanent, snapshot, settle, forceFromWork,
} from '../src/v8.js';

const stats = {
  playTime: 0, ticks: 0, runs: 0, guards: 0, collapses: 0, endgames: 0,
  failures: Array(8).fill(0), guardsByStage: Array(8).fill(0),
  firstGuard: Array(8).fill(false), firstCollapse: Array(8).fill(false),
  releases: 0, bufferSaved: 0, cleared: new Scientific(0), bestPowerLog: 0,
};

const statsJSON = () => ({
  playTime: Number(stats.playTime.toFixed(2)),
  ticks: stats.ticks,
  runs: stats.runs,
  guards: stats.guards,
  collapses: stats.collapses,
  endgames: stats.endgames,
  failures: [...stats.failures],
  guardsByStage: [...stats.guardsByStage],
  firstGuard: [...stats.firstGuard],
  firstCollapse: [...stats.firstCollapse],
  releases: stats.releases,
  bufferSaved: stats.bufferSaved,
  cleared: stats.cleared.toJSON(),
  bestPowerLog: stats.bestPowerLog,
});

const entries = [];
const p = initialPermanent();
let run = 0;

for (;;) {
  run++;
  if (run > 400) throw new Error('400 轮内没有集齐九个层入口（与 GUARDS.campaignRuns 不一致）');
  let runTicks = 0;
  for (let stage = 1; stage <= 9; stage++) {
    if (!entries[stage - 1]) {
      entries[stage - 1] = {
        stage,
        run,
        // 引擎在终局入口把 runTicks 归零（engine.finishSegment 的 stage 8 分支），这里保持一致
        runTicks: stage === 9 ? 0 : runTicks,
        permanent: snapshot(p),
        stats: statsJSON(),
      };
      if (stage === 9) break;   // 终局入口拿到即可，不用跑终局片段
    }
    const seg = new Segment(stage, p, { runTicks });
    let result;
    for (;;) {
      result = seg.tick();
      if (result) break;
    }
    // —— 以下按 engine.finishSegment 的顺序记统计 ——
    stats.bestPowerLog = Math.max(stats.bestPowerLog, forceFromWork(stage, result.peak).log10());
    stats.cleared = stats.cleared.add(seg.cleared);
    stats.releases += seg.releases;
    stats.bufferSaved += seg.savedTicks;
    stats.playTime += seg.tickIndex * CONFIG.dt;
    stats.ticks += seg.tickIndex;
    if (result.win) {
      stats.guards++;
      stats.guardsByStage[Math.min(stage, 8) - 1]++;
      stats.firstGuard[Math.min(stage, 8) - 1] = true;
    } else {
      stats.collapses++;
      stats.failures[Math.min(stage, 8) - 1]++;
      stats.firstCollapse[Math.min(stage, 8) - 1] = true;
      stats.runs++;
    }
    runTicks += result.ticks;
    settle(p, result);
    if (stage === 8 && result.win) stats.endgames++;
    if (!result.win) break;
  }
  if (entries[8]) break;
}

// ── 对拍：入口轮次 = §12.2「首次成功轮」，终局入口 = §12.1 / §12.4 第 50 轮检查点 ──
const expectedRuns = [1, 7, 12, 19, 23, 30, 37, 42, 50];
entries.forEach((e, i) => {
  if (e.run !== expectedRuns[i]) {
    throw new Error(`第 ${e.stage} 层入口轮次 ${e.run} ≠ 文档 ${expectedRuns[i]}（§12.2）`);
  }
});
const last = entries[8].permanent;
const expectLast = {
  failure: [7, 6, 8, 4, 9, 9, 8, 9], success: [37, 37, 36, 36],
  failureWallet: 446103510, successWallet: 88739910,
};
for (const key of Object.keys(expectLast)) {
  const got = JSON.stringify(last[key]);
  const want = JSON.stringify(expectLast[key]);
  if (got !== want) throw new Error(`终局入口 ${key} = ${got} ≠ 文档 §12.1 ${want}`);
}

// ── 写 src/debug.js ──
const header = `// src/debug.js — 调试跳层入口数据（自动生成，勿手改）
//
// 由 \`node tools/gen-debug-jumps.mjs\` 跑 v8.js 全流程模拟（= docs/数值设计.md §12 八层
// 检查点旅程）生成：每一项是**玩家第一次抵达该层**那一刻的完整状态（轮数、runTicks、
// 永久等级 F/U、钱包 WF/WS、累计统计）。tier 0..8 对应 stage 1..9，终局入口的 runTicks
// 与引擎一致取 0。对拍锚：入口轮次 = §12.2 首次成功轮，终局入口 = §12.1 检查点。
export const DEBUG_ENTRIES = ${JSON.stringify(entries, null, 2)};
`;

fs.writeFileSync(new URL('../src/debug.js', import.meta.url), header, 'utf8');

// ── 摘要（人工对 §12.4 用）──
const name = (i) => `第 ${i} 层`;
console.log('入口 | 层 | 轮 | runTicks | F(n1..n8) | U(up..uf) | WF | WS | 累计秒');
for (const e of entries) {
  console.log([
    name(e.stage - 1), e.stage, e.run, e.runTicks,
    `[${e.permanent.failure.join(',')}]`,
    `[${e.permanent.success.join(',')}]`,
    e.permanent.failureWallet, e.permanent.successWallet,
    e.stats.playTime.toFixed(2),
  ].join(' | '));
}
console.log(`\n已写 src/debug.js（${entries.length} 个入口，对拍锚全过）`);
