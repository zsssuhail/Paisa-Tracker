import type { Category, CategoryGroup, ISODate, Transaction, TxFilter } from '@/data/types';
import { seriesVar, OTHER_COLOUR, SERIES_SLOTS } from '@/design/chartPalette';
import type { Range } from '../aggregate';

export interface InsightCtx {
  txs: Transaction[];
  range: Range;
  /** Present when "compare to last period" is on. */
  prev: Range | null;
  cats: Map<string, Category>;
  groups: CategoryGroup[];
  startDay: number;
  today: ISODate;
  /** Tap a mark → open the transaction list filtered to it. */
  onFilter: (f: TxFilter) => void;
}

export function catName(ctx: Pick<InsightCtx, 'cats'>, id: string) {
  if (id === 'other') return 'Other';
  if (id === 'uncategorised') return 'Needs a category';
  return ctx.cats.get(id)?.name ?? 'Other';
}

export function catColour(ctx: Pick<InsightCtx, 'cats'>, id: string) {
  const c = ctx.cats.get(id);
  return c ? seriesVar(c.colour) : OTHER_COLOUR;
}

export function signedPct(now: number, before: number) {
  if (!before) return now ? 'new' : '—';
  const p = Math.round(((now - before) / before) * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
}

/**
 * Colours for the series shown together in one chart. Each category keeps its own slot
 * when free; on a clash it takes the next unused slot in the fixed order, so no two
 * visible series ever share a hue. "Other" is always the neutral.
 */
export function distinctColours(ctx: Pick<InsightCtx, 'cats'>, ids: string[]): Map<string, string> {
  const used = new Set<number>();
  const out = new Map<string, string>();
  const pending: string[] = [];
  for (const id of ids) {
    const slot = ctx.cats.get(id)?.colour;
    if (id === 'other' || id === 'uncategorised' || !slot) out.set(id, OTHER_COLOUR);
    else if (!used.has(slot)) {
      used.add(slot);
      out.set(id, seriesVar(slot));
    } else pending.push(id);
  }
  for (const id of pending) {
    let slot = 1;
    while (used.has(slot) && slot <= SERIES_SLOTS) slot++;
    if (slot > SERIES_SLOTS) out.set(id, OTHER_COLOUR);
    else {
      used.add(slot);
      out.set(id, seriesVar(slot));
    }
  }
  return out;
}
