// src/num.js — 显示层的大数与文本口径（**只做显示，不参与任何数值**）
//
// V8 的真实量是 Scientific{mantissa, exponent}（§2.1），工作坐标仍是 Number。
// 这里统一把三种输入（Scientific / {m,e} / Number / 字符串）转成同一种输出：
//   · 0                → "0"
//   · < 1              → 小数（永不出现 e-1 这种负指数）
//   · ≥ 1 且指数不大    → 整数或科学计数法
//   · 指数 ≥ 1e6       → 双指数写法 2.49e2.49e9（八层真实量最大到 2.49e2492094949）
import { Scientific } from './v8.js';

export { Scientific };

/** 统一成 Scientific；非法输入抛错，避免静默变成 0 或 Infinity */
export function toSci(v) {
  if (v instanceof Scientific) return v;
  if (typeof v === 'number') return new Scientific(v);
  if (typeof v === 'string') return Scientific.parse(v);
  if (v && typeof v === 'object') {
    if (Number.isFinite(v.mantissa)) return Scientific.fromJSON(v);
    if (Number.isFinite(v.m)) return new Scientific(v.m, v.e);
  }
  throw new RangeError(`无法识别的数值：${JSON.stringify(v)}`);
}

const shortExponent = (exp) => String(exp);

/** 真实量下溢出 Number 表示范围（1e-344 这种）时按 0 兜底，不让显示层抛错 */
const safeNumber = (d) => {
  try { return d.toNumber(); } catch (e) { return 0; }
};

/** 科学计数法：2.49e249 / 2.49e2492094949 / 1.23e-1（负指数只在内部，显示走 formatDisplay） */
export function formatScientific(v, digits = 3) {
  const d = toSci(v);
  if (d.mantissa === 0) return '0';
  const mant = d.mantissa.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return `${mant}e${shortExponent(d.exponent)}`;
}

/** 全游戏统一显示口径：<1 写小数，其余走科学计数法 */
export function formatDisplay(v, digits = 3) {
  const d = toSci(v);
  if (d.mantissa === 0) return '0';
  const log = d.exponent + Math.log10(d.mantissa);
  if (log < 0) {
    const value = safeNumber(d);
    if (value === 0) return '0';
    const a = Math.abs(value);
    const places = Math.min(9, Math.max(2, 2 - Math.floor(Math.log10(a))));
    const s = value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
    return s === '0' || s === '-0'
      ? value.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')
      : s;
  }
  if (log < 6) {
    const value = safeNumber(d);
    return log < 3 ? String(Math.round(value * 100) / 100) : String(Math.round(value));
  }
  return formatScientific(d, digits);
}

/** mtc 口径：一律整数；大到 1e6 以上才用科学计数法 */
export function formatInteger(v, digits = 3) {
  const d = toSci(v);
  if (d.mantissa === 0) return '0';
  const log = d.exponent + Math.log10(d.mantissa);
  if (log >= 6) return formatScientific(d, digits);
  return String(Math.round(d.toNumber()));
}

/** 价格口径：整数，但正数价格至少显示 1 */
export function formatPrice(v, digits = 3) {
  const d = toSci(v);
  if (d.mantissa === 0) return '0';
  const log = d.exponent + Math.log10(d.mantissa);
  if (log >= 6) return formatScientific(d, digits);
  return String(Math.max(1, Math.round(d.toNumber())));
}

/** 倍率（×1.32 这种）：永远普通小数 */
export function formatRatio(x, digits = 2) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e6 || a < 1e-4) return formatScientific(x, 3);
  return String(Number(x.toFixed(digits)));
}

/** mtc 显示乘数（随档动态）：第 1 层 ×10 是既定口径（2.2 → 22 mtc）；
 *  第 L ≥ 2 层 ×10^(L+1)，把各层开局的门票价 / 奶茶币收入抬回 2X 的整数
 *  （各层首价内部值约 0.024 × 0.1^(L-2)，否则会显示成 0.00 几）。只改显示，不改任何计算。 */
export function mtcFactorOf(layer) {
  const l = Math.max(1, Math.min(9, Math.floor(Number(layer) || 1)));
  return l <= 1 ? 10 : 10 ** (l + 1);
}

/** mtc 显示口径：内部 R × 当前档乘数（尾数移位，不做 Number 乘法，八层的量级会溢出）；
 *  显示侧再四舍五入成整数（formatPrice / formatInteger） */
export function scaledMtc(v, layer = 1) {
  const d = toSci(v);
  if (d.mantissa === 0) return new Scientific(0);
  const f = mtcFactorOf(layer);
  return new Scientific(d.mantissa * f, d.exponent);
}

export function formatTime(sec) {
  if (!isFinite(sec)) return '∞';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

export function formatPercent(x, digits = 1) {
  if (!isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}
