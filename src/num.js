// src/num.js — Decimal 大数（AD: break_infinity.js 的等价实现）
// 值 = m * 10^e，1 <= |m| < 10（0 用 m=0,e=0 表示）。
// 指数是普通 double，足够覆盖本作最大量级（e249209）。

const LOG10_2 = Math.log10(2);

export class Dec {
  constructor(m = 0, e = 0) {
    this.m = m;
    this.e = e;
  }

  static from(x) {
    if (x instanceof Dec) return x;
    if (typeof x === 'number') return Dec.fromNumber(x);
    if (typeof x === 'string') return Dec.fromString(x);
    if (x && typeof x === 'object' && typeof x.m === 'number') return new Dec(x.m, x.e);
    return new Dec(0, 0);
  }

  static fromNumber(n) {
    if (!isFinite(n) || n === 0) return new Dec(0, 0);
    const sign = n < 0 ? -1 : 1;
    const a = Math.abs(n);
    const e = Math.floor(Math.log10(a));
    const m = a / Math.pow(10, e);
    return Dec.normalize(sign * m, e);
  }

  // 支持 "1e100" / "2.49e249" / "1.5e-3" / "123"
  static fromString(s) {
    s = String(s).trim();
    const idx = s.toLowerCase().indexOf('e');
    if (idx < 0) return Dec.fromNumber(parseFloat(s) || 0);
    const mant = parseFloat(s.slice(0, idx)) || 0;
    const exp = parseFloat(s.slice(idx + 1)) || 0;
    if (mant === 0) return new Dec(0, 0);
    return Dec.mul(Dec.fromNumber(mant), Dec.pow10(exp));
  }

  static normalize(m, e) {
    if (m === 0 || !isFinite(m)) return new Dec(0, 0);
    if (!isFinite(e)) return new Dec(0, 0);
    while (Math.abs(m) >= 10) { m /= 10; e += 1; }
    while (Math.abs(m) < 1) { m *= 10; e -= 1; }
    return new Dec(m, e);
  }

  static zero() { return new Dec(0, 0); }
  static one() { return new Dec(1, 0); }

  static pow10(e) {
    if (!isFinite(e)) return new Dec(0, 0);
    // e 可能是小数（如 10^0.5），拆成整数部分 + 尾数
    const ei = Math.floor(e);
    const frac = e - ei;
    return Dec.normalize(Math.pow(10, frac), ei);
  }

  static add(a, b) {
    a = Dec.from(a); b = Dec.from(b);
    if (a.m === 0) return b.clone();
    if (b.m === 0) return a.clone();
    let big = a, small = b;
    if (b.e > a.e || (b.e === a.e && Math.abs(b.m) > Math.abs(a.m))) { big = b; small = a; }
    const diff = big.e - small.e;
    if (diff > 17) return big.clone();
    const m = big.m + small.m / Math.pow(10, diff);
    return Dec.normalize(m, big.e);
  }

  static sub(a, b) {
    b = Dec.from(b);
    return Dec.add(a, new Dec(-b.m, b.e));
  }

  static mul(a, b) {
    a = Dec.from(a); b = Dec.from(b);
    if (a.m === 0 || b.m === 0) return new Dec(0, 0);
    return Dec.normalize(a.m * b.m, a.e + b.e);
  }

  static div(a, b) {
    a = Dec.from(a); b = Dec.from(b);
    if (b.m === 0) return new Dec(0, 0);
    if (a.m === 0) return new Dec(0, 0);
    return Dec.normalize(a.m / b.m, a.e - b.e);
  }

  static log10(a) {
    a = Dec.from(a);
    if (a.m === 0) return -Infinity;
    if (a.m < 0) return NaN;
    return a.e + Math.log10(a.m);
  }

  static ln(a) {
    return Dec.log10(a) * Math.LN10;
  }

  // 幂：指数用普通 number（或 Dec，此时按 10^(log10(base)*p) 算）
  static pow(a, p) {
    a = Dec.from(a);
    if (p instanceof Dec) {
      const lp = Dec.log10(p);
      return Dec.pow10(Dec.log10(a) * p.toNumber());
    }
    if (p === 0) return Dec.one();
    if (a.m === 0) return p > 0 ? new Dec(0, 0) : Dec.one();
    const lg = Dec.log10(a) * p;
    if (!isFinite(lg)) return new Dec(lg > 0 ? 1 : 0, lg > 0 ? 1e308 : -1e308);
    return Dec.pow10(lg);
  }

  static cmp(a, b) {
    a = Dec.from(a); b = Dec.from(b);
    const sa = a.m === 0 ? 0 : Math.sign(a.m);
    const sb = b.m === 0 ? 0 : Math.sign(b.m);
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (sa === 0) return 0;
    if (a.e !== b.e) return (a.e < b.e ? -1 : 1) * (sa < 0 ? -1 : 1);
    return a.m === b.m ? 0 : (a.m < b.m ? -1 : 1) * (sa < 0 ? -1 : 1);
  }

  static max(a, b) { return Dec.cmp(a, b) >= 0 ? Dec.from(a) : Dec.from(b); }
  static min(a, b) { return Dec.cmp(a, b) <= 0 ? Dec.from(a) : Dec.from(b); }

  // 数量级比较时最常用：a >= b
  static gte(a, b) { return Dec.cmp(a, b) >= 0; }
  static lte(a, b) { return Dec.cmp(a, b) <= 0; }
  static gt(a, b) { return Dec.cmp(a, b) > 0; }
  static lt(a, b) { return Dec.cmp(a, b) < 0; }
  static eq(a, b) { return Dec.cmp(a, b) === 0; }

  static logLerp(a, b, t) {
    // 在对数刻度上线性插值（用于 UI 进度条）
    const la = Dec.log10(a), lb = Dec.log10(b);
    if (!isFinite(la)) return Dec.pow10(lb);
    return Dec.pow10(la + (lb - la) * t);
  }

  clone() { return new Dec(this.m, this.e); }
  toNumber() {
    if (this.m === 0) return 0;
    if (this.e > 308) return this.m > 0 ? Infinity : -Infinity;
    if (this.e < -324) return 0;
    return this.m * Math.pow(10, this.e);
  }
  log10() { return Dec.log10(this); }
  add(x) { return Dec.add(this, x); }
  sub(x) { return Dec.sub(this, x); }
  mul(x) { return Dec.mul(this, x); }
  div(x) { return Dec.div(this, x); }
  pow(p) { return Dec.pow(this, p); }
  neg() { return new Dec(-this.m, this.e); }
  isZero() { return this.m === 0; }
  gte(x) { return Dec.gte(this, x); }
  lte(x) { return Dec.lte(this, x); }
  gt(x) { return Dec.gt(this, x); }
  lt(x) { return Dec.lt(this, x); }
  eq(x) { return Dec.eq(this, x); }
  max(x) { return Dec.max(this, x); }
  min(x) { return Dec.min(this, x); }
  toString() { return formatScientific(this); }
  toJSON() { return this.m === 0 ? 0 : `${this.m}e${this.e}`; }
  static fromJSON(v) { return Dec.from(v); }
}

export const D = Dec;

// —— 科学计数法显示（全游戏统一）——
export function formatScientific(v, digits = 3) {
  const d = Dec.from(v);
  if (d.m === 0) return '0';
  const sign = d.m < 0 ? '-' : '';
  const m = Math.abs(d.m);
  if (d.e >= 0 && d.e < 6) {
    // 小数值直接显示，避免 12.3e3 这种
    const val = m * Math.pow(10, d.e);
    if (d.e < 3) return sign + (Math.round(val * 100) / 100).toString();
    return sign + (Math.round(val).toString());
  }
  const mant = m.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return `${sign}${mant}e${d.e}`;
}

export function formatPercent(x, digits = 1) {
  if (!isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

// —— 界面显示口径（用户口径）——
// 全局不允许出现 "e-1" 这种负指数：小于 1 的值一律写成小数（两位有效数字，
// 极小的再退到定点小数），大于等于 1 的值照常走 formatScientific。
export function formatDisplay(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1) return formatScientific(v, digits);
  // 小数：按量级选位数，去掉末尾多余的 0（0.05 而不是 0.050）
  const places = Math.min(9, Math.max(2, 2 - Math.floor(Math.log10(a))));
  const s = v.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
  return s === '0' || s === '-0' ? v.toFixed(9).replace(/0+$/, '') : s;
}

// mtc 口径：四舍五入到整数；大到 1e6 以上才用科学计数法
export function formatInteger(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 1e6) return String(Math.round(v));
  return formatScientific(v, digits);
}

// 价格口径：同样显示整数，但正数价格至少显示 1，避免出现「0 mtc」这种买得到却显示 0 的情况
export function formatPrice(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 1e6) return String(Math.max(1, Math.round(v)));
  return formatScientific(v, digits);
}

export function formatTime(sec) {
  if (!isFinite(sec)) return '∞';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
}
