import { useMemo } from 'react';
import { useData } from './store';
import { addDays, periodFor, shiftPeriod, todayISO, type Period } from './dates';
import type { Category, Transaction } from './types';
import { summariseBudget } from '@/features/budget/math';
import { seriesVar } from '@/design/chartPalette';

export function useToday() {
  // Re-evaluated on each render; cheap and keeps "Today" correct past midnight.
  return todayISO();
}

export function useCurrentPeriod(offset = 0): Period {
  const startDay = useData((s) => s.settings.monthStartDay);
  const today = useToday();
  return useMemo(() => {
    const p = periodFor(today, startDay);
    return offset ? shiftPeriod(p, offset, startDay) : p;
  }, [today, startDay, offset]);
}

export function useCategoryMap() {
  const categories = useData((s) => s.categories);
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

export function useActiveCategories(): Category[] {
  const categories = useData((s) => s.categories);
  const groups = useData((s) => s.groups);
  return useMemo(() => {
    const order = new Map(groups.map((g) => [g.id, g.order]));
    return categories
      .filter((c) => !c.archived)
      .sort((a, b) => (order.get(a.groupId) ?? 99) - (order.get(b.groupId) ?? 99) || a.order - b.order);
  }, [categories, groups]);
}

export function categoryColour(c: Category | undefined): string {
  return c ? seriesVar(c.colour) : 'var(--series-other)';
}

/** Most-used categories in the last 60 days, padded with defaults. */
export function useTopCategories(n = 6): Category[] {
  const txs = useData((s) => s.transactions);
  const cats = useActiveCategories();
  const today = useToday();
  return useMemo(() => {
    const from = addDays(today, -60);
    const counts = new Map<string, number>();
    for (const t of txs) {
      if (t.type === 'expense' && t.categoryId && t.date >= from) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    }
    return [...cats].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.order - b.order).slice(0, n);
  }, [txs, cats, today, n]);
}

export function useBudgetSummary(offset = 0) {
  const txs = useData((s) => s.transactions);
  const budgets = useData((s) => s.budgets);
  const startDay = useData((s) => s.settings.monthStartDay);
  const period = useCurrentPeriod(offset);
  const today = useToday();
  return useMemo(() => {
    const budget = budgets.find((b) => b.id === period.start);
    const asOf = today > period.end ? period.end : today;
    return summariseBudget({ budget, budgets, txs, today: asOf, startDay, period });
  }, [txs, budgets, period, startDay, today]);
}

export function labelForTx(t: Transaction, cats: Map<string, Category>): string {
  if (t.item) return t.item;
  if (t.place) return t.place;
  if (t.categoryId) return cats.get(t.categoryId)?.name ?? 'Payment';
  return t.type === 'income' ? 'Money in' : 'Payment';
}
