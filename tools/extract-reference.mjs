// tools/extract-reference.mjs — 从 docs/数值设计.md §14 抽出唯一一段 javascript，写成参考物
//
// 数值设计 §13 明确：本文唯一的 javascript 代码块就是完整独立模拟器。参考物必须由文档
// 自动抽出，任何手抄都可能改掉一个符号或运算顺序，对拍就失去意义。
//
//   node tools/extract-reference.mjs          → tools/v8-reference.cjs
//
import fs from 'node:fs';

const DOC = 'docs/数值设计.md';
const OUT = 'tools/v8-reference.cjs';

const text = fs.readFileSync(DOC, 'utf8');
const blocks = [...text.matchAll(/^```javascript\n([\s\S]*?)^```/gm)];
if (blocks.length !== 1) {
  console.error(`[extract] 期望恰好 1 段 javascript 代码块，实际 ${blocks.length} 段。`);
  process.exit(1);
}
const code = blocks[0][1];
if (!code.includes('module.exports')) {
  console.error('[extract] 代码块里没有 module.exports，抽出来不可用。');
  process.exit(1);
}
const banner = `// tools/v8-reference.cjs — 由 tools/extract-reference.mjs 从 ${DOC} §14 原样抽出。\n`
  + '// 禁止手改：文档是唯一权威，要改就改文档再重抽。\n\n';
fs.writeFileSync(OUT, banner + code, 'utf8');
console.log(`[extract] ${DOC} → ${OUT}（${code.split('\n').length} 行）`);
