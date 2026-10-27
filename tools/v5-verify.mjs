// tools/v5-verify.mjs — 对拍：本仓库实现 vs docs/数值设计.md §13 参考模拟器
//
// 用法：node tools/v5-verify.mjs
// 通过条件：两边 campaign() 的所有字段（含浮点末位）完全一致。
// 注意：这里不允许容差。用户验收口径是「跑出来的结果和文档中模拟器跑出来的的一样」。

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as mine from '../src/v5.js';

const require = createRequire(import.meta.url);
const ref = require('./v5-reference.cjs');

// 深度比较：数字一律用 ===（不允许 1e-8 容差），数组/对象递归
function deepEqualExact(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b) && a !== b) throw new Error(`${path}: ${a} !== ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) throw new Error(`${path}: array mismatch`);
    if (a.length !== b.length) throw new Error(`${path}: length ${a.length} !== ${b.length}`);
    for (let i = 0; i < a.length; i++) deepEqualExact(a[i], b[i], `${path}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka.join()} !== ${kb.join()}`);
    for (const k of ka) deepEqualExact(a[k], b[k], `${path}.${k}`);
    return;
  }
  if (a !== b) throw new Error(`${path}: ${a} !== ${b}`);
}

const t0 = Date.now();
const refResult = ref.campaign();
const t1 = Date.now();
const myResult = mine.campaign();
const t2 = Date.now();

deepEqualExact(myResult, refResult, 'campaign');

const seconds = refResult.runs.reduce((sum, r) => sum + r.time, 0);
console.log('[v5-verify] campaign 逐字段完全一致');
console.log(`  轮数 ${refResult.runs.length}  失败次数 ${JSON.stringify(refResult.failures)}`);
console.log(`  F=${JSON.stringify(refResult.permanent.failure)} U=${JSON.stringify(refResult.permanent.success)}`);
console.log(`  钱包 WF=${refResult.permanent.failureWallet} WS=${refResult.permanent.successWallet}`);
console.log(`  累计秒数 ${seconds}（${(seconds / 3600).toFixed(2)} 小时）`);
console.log(`  耗时：参考 ${t1 - t0}ms / 本实现 ${t2 - t1}ms`);

// 文档 §10.1 的硬指标也一并复核，防止两边一起跑偏
assert.deepEqual(refResult.failures, [6, 5, 6, 4]);
assert.equal(refResult.runs.length, 22);
assert.deepEqual(refResult.permanent, {
  failure: [5, 6, 6, 3], success: [11, 4, 1, 1], failureWallet: 18327, successWallet: 5670,
});
assert.equal(seconds, 14997.2);
console.log('[v5-verify] §10.1 基准数字一致');
