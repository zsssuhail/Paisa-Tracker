import { toISO } from '@/data/dates';
import type { ISODate } from '@/data/types';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function year(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return toISO(y, m, d);
}

/**
 * Parse the date formats Indian banks and UPI apps use. Day-first by default (India),
 * override with `order` for a custom mapping.
 */
export function parseLooseDate(input: string | number, order: 'DMY' | 'MDY' | 'YMD' = 'DMY'): ISODate | null {
  if (typeof input === 'number' || /^\d{5}(\.\d+)?$/.test(String(input).trim())) {
    // Excel serial date.
    const serial = Number(input);
    if (serial > 20_000 && serial < 80_000) {
      const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
      return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    return null;
  }
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // 2026-10-01 or 2026/10/01 (optionally with time)
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));

  // 01-Oct-2026, 01 Oct 2026, 01 Oct, 2026, 1-October-26
  m = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]+(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));

  // Oct 1, 2026 / October 01 2026
  m = /^([A-Za-z]{3,9})[ .-](\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return valid(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));

  // 01/10/2026, 01-10-26, 01.10.2026
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = year(m[3]);
    if (order === 'MDY') return valid(y, a, b);
    return valid(y, b, a);
  }
  return null;
}

/** "10:21", "10:21:33 AM", "10:21 pm" → "10:21" (24h). */
export function parseLooseTime(s: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export const DATE_AT_START = /^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ,]+\d{2,4}|[A-Za-z]{3,9} \d{1,2},? \d{4})/;

/**
 * Day-first or month-first? Look at the whole column: a first part over 12 means day-first,
 * a second part over 12 means month-first. When nothing decides it, pick the order that keeps
 * the rows in date order (statements and notebooks are written in sequence), else India's day-first.
 */
export function inferDateOrder(values: string[]): 'DMY' | 'MDY' {
  const pairs = values.map((v) => /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(v)).filter((m): m is RegExpExecArray => Boolean(m));
  if (!pairs.length) return 'DMY';
  if (pairs.some((m) => Number(m[1]) > 12)) return 'DMY';
  if (pairs.some((m) => Number(m[2]) > 12)) return 'MDY';
  const monotonic = (order: 'DMY' | 'MDY') => {
    const dates = pairs.map((m) => parseLooseDate(m[0], order)).filter((d): d is string => Boolean(d));
    let steps = 0;
    for (let i = 1; i < dates.length; i++) if (dates[i] >= dates[i - 1]) steps++;
    return Math.max(steps, dates.length - 1 - steps);
  };
  const m = monotonic('MDY');
  const d = monotonic('DMY');
  if (m !== d) return m > d ? 'MDY' : 'DMY';
  // Still tied: entries in a notebook sit close together, so the reading with the shorter span wins.
  const span = (order: 'DMY' | 'MDY') => {
    const dates = pairs.map((p) => parseLooseDate(p[0], order)).filter((x): x is string => Boolean(x)).sort();
    return dates.length ? Date.parse(dates[dates.length - 1]) - Date.parse(dates[0]) : Infinity;
  };
  return span('MDY') < span('DMY') ? 'MDY' : 'DMY';
}
