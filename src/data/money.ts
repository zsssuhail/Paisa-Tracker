import type { Paise } from './types';

let currency = 'INR';
let locale = 'en-IN';
const cache = new Map<string, Intl.NumberFormat>();

export function configureMoney(next: { currency: string; locale: string }) {
  currency = next.currency;
  locale = next.locale;
  cache.clear();
}

function formatter(fraction: number, compact = false) {
  const key = `${currency}|${locale}|${fraction}|${compact}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
      notation: compact ? 'compact' : 'standard',
    });
    cache.set(key, f);
  }
  return f;
}

/** ₹1,25,000 — paise shown only when non-zero (₹560.20). */
export function formatMoney(paise: Paise, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(paise);
  const fraction = opts.compact ? 0 : abs % 100 === 0 ? 0 : 2;
  const text = formatter(fraction, opts.compact).format(abs / 100);
  if (paise < 0) return `−${text}`;
  if (opts.sign && paise > 0) return `+${text}`;
  return text;
}

/** Short axis-label form: ₹1.2K, ₹1.3L style via compact notation. */
export function formatMoneyShort(paise: Paise): string {
  return formatMoney(paise, { compact: Math.abs(paise) >= 100_000 });
}

export function currencySymbol(): string {
  const parts = formatter(0).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? '₹';
}

/**
 * Parse a human/bank amount into integer paise without floating point.
 * Accepts "1,25,000", "560.2", "₹ 99", "(250.00)", "1,250.50 Dr".
 */
export function parseMoney(input: string | number | null | undefined): Paise | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/(?:rs\.?|inr|₹)/gi, '').replace(/\b(?:dr|cr)\b\.?/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = Number(m[1] || '0');
  const frac = Number(((m[2] ?? '') + '00').slice(0, 2));
  const value = whole * 100 + frac;
  return negative ? -value : value;
}

/** Input-field helper: paise -> editable string ("560.20" / "99"). */
export function paiseToInput(paise: Paise): string {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
}

export const rupees = (r: number): Paise => Math.round(r * 100);

/** Averages and projections are estimates: show them in whole rupees, not false precision. */
export const roundRupee = (p: number): Paise => Math.round(p / 100) * 100;
