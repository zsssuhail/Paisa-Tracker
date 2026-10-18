import { addDays, diffDays, periodFor, shiftPeriod, todayISO } from '@/data/dates';
import type { Category, ISODate, Transaction, TxFilter } from '@/data/types';

export type RangePreset = 'this-month' | 'last-month' | 'last-3' | 'last-30' | 'all' | 'custom';

export function rangeFor(preset: RangePreset, startDay: number, custom?: { from: ISODate; to: ISODate }, today = todayISO()) {
  const p = periodFor(today, startDay);
  switch (preset) {
    case 'this-month':
      return { from: p.start, to: p.end };
    case 'last-month': {
      const l = shiftPeriod(p, -1, startDay);
      return { from: l.start, to: l.end };
    }
    case 'last-3':
      return { from: shiftPeriod(p, -2, startDay).start, to: p.end };
    case 'last-30':
      return { from: addDays(today, -29), to: today };
    case 'custom':
      return custom;
    default:
      return undefined;
  }
}

/** The window immediately before `range` — whole budget months if `range` is whole months, else same length. */
export function previousRange(range: { from: ISODate; to: ISODate }, startDay: number) {
  const first = periodFor(range.from, startDay);
  if (first.start === range.from) {
    let n = 0;
    let q = first;
    while (q.end < range.to && n < 120) {
      n++;
      q = shiftPeriod(q, 1, startDay);
    }
    if (q.end === range.to) return { from: shiftPeriod(first, -(n + 1), startDay).start, to: addDays(range.from, -1) };
  }
  const len = diffDays(range.to, range.from) + 1;
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

export function applyFilter(txs: Transaction[], f: TxFilter, cats: Map<string, Category>): Transaction[] {
  const text = f.text?.trim().toLowerCase();
  const place = f.place?.trim().toLowerCase();
  return txs.filter((t) => {
    if (f.range && (t.date < f.range.from || t.date > f.range.to)) return false;
    if (f.types?.length && !f.types.includes(t.type)) return false;
    if (f.categoryIds?.length) {
      const key = t.categoryId ?? 'uncategorised';
      if (!f.categoryIds.includes(key)) return false;
    }
    if (place && t.place.toLowerCase() !== place) return false;
    if (f.paymentModes?.length && !f.paymentModes.includes(t.paymentMode)) return false;
    if (f.minPaise != null && t.amountPaise < f.minPaise) return false;
    if (f.maxPaise != null && t.amountPaise > f.maxPaise) return false;
    if (text) {
      const hay = `${t.item} ${t.place} ${t.note} ${t.categoryId ? cats.get(t.categoryId)?.name ?? '' : ''} ${t.rawPayee ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

export function sortTx(a: Transaction, b: Transaction) {
  return a.date === b.date ? (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt - a.createdAt : b.date.localeCompare(a.date);
}

export function isFilterEmpty(f: TxFilter) {
  return !f.categoryIds?.length && !f.place && !f.paymentModes?.length && f.minPaise == null && f.maxPaise == null && !f.text && !f.types?.length;
}
