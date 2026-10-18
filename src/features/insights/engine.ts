import { addDays, daysElapsed, isoWeekStart, shiftPeriod, type Period } from '@/data/dates';
import { formatMoney } from '@/data/money';
import type { Category, ISODate, Paise, Recurring, Transaction } from '@/data/types';
import { roundNice } from '@/features/budget/math';
import { normalisePlace } from '@/features/rules/engine';
import { byCategory, monthCompare, repeatingPayments, spendIn, topPlaces } from './aggregate';

export type InsightKind = 'increase' | 'trend' | 'habit' | 'unusual' | 'saving' | 'subscription' | 'decrease';

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  /** Higher shows first. */
  weight: number;
  categoryId?: string;
  place?: string;
  /** Suggested follow-up, rendered as a button. */
  action?: { label: string; to: string } | { label: string; kind: 'limit'; categoryId: string; amountPaise: Paise } | { label: string; kind: 'recurring'; place: string; amountPaise: Paise; categoryId: string | null };
}

const name = (cats: Map<string, Category>, id: string) => (id === 'uncategorised' ? 'Uncategorised' : cats.get(id)?.name ?? 'Other');

/**
 * Plain-English observations computed entirely on the device.
 * Every rule compares like with like: this month so far vs the same days last month.
 */
export function computeInsights(args: {
  txs: Transaction[];
  period: Period;
  today: ISODate;
  startDay: number;
  cats: Map<string, Category>;
  recurring: Recurring[];
}): Insight[] {
  const { txs, period, today, startDay, cats, recurring } = args;
  const out: Insight[] = [];
  const asOf = today > period.end ? period.end : today;
  const elapsed = daysElapsed(period, asOf);
  const last = shiftPeriod(period, -1, startDay);
  const lastSameDay = addDays(last.start, Math.min(elapsed, last.days) - 1);

  // 1. Biggest increase vs the same point last month.
  const now = new Map(byCategory(txs, { from: period.start, to: asOf }).map((c) => [c.categoryId, c.total]));
  const then = new Map(byCategory(txs, { from: last.start, to: lastSameDay }).map((c) => [c.categoryId, c.total]));
  let bestUp: { id: string; diff: number } | null = null;
  let bestDown: { id: string; diff: number } | null = null;
  for (const id of new Set([...now.keys(), ...then.keys()])) {
    if (id === 'uncategorised') continue;
    const diff = (now.get(id) ?? 0) - (then.get(id) ?? 0);
    if (diff > 0 && (!bestUp || diff > bestUp.diff)) bestUp = { id, diff };
    if (diff < 0 && (!bestDown || diff < bestDown.diff)) bestDown = { id, diff };
  }
  if (bestUp && bestUp.diff >= 20_000 && elapsed >= 3) {
    const big = txs.some((t) => t.bigItem && t.categoryId === bestUp!.id && t.date >= period.start && t.date <= asOf);
    out.push({
      id: `up-${bestUp.id}`,
      kind: 'increase',
      title: `${name(cats, bestUp.id)} is up ${formatMoney(roundNice(bestUp.diff))}`,
      body: `Compared with the same ${elapsed} days last month${big ? ', mostly from one big item' : ''}.`,
      weight: big ? 40 : 70 + Math.min(20, bestUp.diff / 10_000),
      categoryId: bestUp.id,
    });
  }
  if (bestDown && -bestDown.diff >= 20_000 && elapsed >= 7) {
    out.push({
      id: `down-${bestDown.id}`,
      kind: 'decrease',
      title: `${name(cats, bestDown.id)} is down ${formatMoney(roundNice(-bestDown.diff))}`,
      body: `Nice. That's less than the same point last month.`,
      weight: 45,
      categoryId: bestDown.id,
    });
  }

  // 2. A category up three weeks in a row.
  const weeks = [3, 2, 1, 0].map((i) => {
    const start = addDays(isoWeekStart(asOf), -7 * i);
    return { start, end: addDays(start, 6) };
  });
  const weekTotals = weeks.map((w) => new Map(byCategory(txs, { from: w.start, to: w.end }).map((c) => [c.categoryId, c.total])));
  for (const id of weekTotals[3].keys()) {
    if (id === 'uncategorised') continue;
    const v = weekTotals.map((m) => m.get(id) ?? 0);
    if (v[0] > 0 && v[1] > v[0] && v[2] > v[1] && v[3] >= v[2] * 0.6 && v[2] >= 15_000) {
      out.push({
        id: `trend-${id}`,
        kind: 'trend',
        title: `${name(cats, id)} has risen three weeks running`,
        body: `${formatMoney(v[0])} → ${formatMoney(v[1])} → ${formatMoney(v[2])} a week.`,
        weight: 65,
        categoryId: id,
      });
      break;
    }
  }

  // 3. A place visited often this month.
  const places = topPlaces(txs, { from: period.start, to: asOf }, 20).sort((a, b) => b.visits - a.visits);
  const habit = places[0];
  if (habit && habit.visits >= 5) {
    out.push({
      id: `habit-${habit.key}`,
      kind: 'habit',
      title: `${habit.visits} visits to ${habit.place} this month`,
      body: `${formatMoney(habit.total)} so far, about ${formatMoney(habit.average)} each time. Small payments add up.`,
      weight: 55,
      place: habit.place,
    });
  }

  // 4. Unusual large payment: well above what I usually spend in that category.
  const recent = spendIn(txs, { from: period.start, to: asOf });
  const history = spendIn(txs, { from: addDays(period.start, -120), to: addDays(period.start, -1) });
  for (const t of [...recent].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5)) {
    const same = history.filter((h) => h.categoryId === t.categoryId).map((h) => h.amountPaise).sort((a, b) => a - b);
    const typical = same.length ? same[Math.floor(same.length / 2)] : 0;
    if (t.amountPaise >= 50_000 && (typical === 0 || t.amountPaise >= typical * 3)) {
      out.push({
        id: `unusual-${t.id}`,
        kind: 'unusual',
        title: `A big one: ${formatMoney(t.amountPaise)} ${t.place ? `at ${t.place}` : `on ${t.item || name(cats, t.categoryId ?? 'uncategorised')}`}`,
        body: typical ? `Your usual ${name(cats, t.categoryId ?? 'uncategorised')} payment is about ${formatMoney(typical)}.` : 'Bigger than anything in this category recently.',
        weight: t.bigItem ? 35 : 60,
        categoryId: t.categoryId ?? undefined,
      });
      break;
    }
  }

  // 5. "You could save about ₹X a month by…" — projected vs 3-month average.
  const compare = monthCompare(txs, period, startDay);
  const projected = (v: number) => (elapsed > 0 ? Math.round((v / elapsed) * period.days) : v);
  const saving = compare
    .filter((c) => c.categoryId !== 'uncategorised' && c.avg3 >= 20_000 && !txs.some((t) => t.bigItem && t.categoryId === c.categoryId && t.date >= period.start))
    .map((c) => ({ ...c, over: projected(now.get(c.categoryId) ?? 0) - c.avg3 }))
    .filter((c) => c.over >= 20_000)
    .sort((a, b) => b.over - a.over)[0];
  if (saving && elapsed >= 5) {
    out.push({
      id: `save-${saving.categoryId}`,
      kind: 'saving',
      title: `You could save about ${formatMoney(roundNice(saving.over))} this month`,
      body: `by keeping ${name(cats, saving.categoryId)} near your 3-month average of ${formatMoney(roundNice(saving.avg3))}.`,
      weight: 75,
      categoryId: saving.categoryId,
      action: { label: `Set a ${formatMoney(roundNice(saving.avg3))} limit`, kind: 'limit', categoryId: saving.categoryId, amountPaise: roundNice(saving.avg3) },
    });
  }

  // 6. Subscriptions I may have forgotten: monthly repeats not tracked as recurring.
  const known = new Set(recurring.map((r) => normalisePlace(r.place || r.name)));
  const monthly = repeatingPayments(txs, { from: addDays(asOf, -120), to: asOf }).filter((r) => r.cadence === 'monthly' && !known.has(r.key));
  if (monthly[0]) {
    const m = monthly[0];
    out.push({
      id: `sub-${m.key}`,
      kind: 'subscription',
      title: `${m.place} looks like a monthly bill`,
      body: `About ${formatMoney(m.typicalPaise)} every month. Track it so it never surprises you.`,
      weight: 50,
      place: m.place,
      action: { label: 'Make it recurring', kind: 'recurring', place: m.place, amountPaise: m.typicalPaise, categoryId: m.categoryId },
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** One-sentence takeaway for the category donut. */
export function categoryTakeaway(totals: { categoryId: string; total: number }[], cats: Map<string, Category>, txs: Transaction[], range: { from: ISODate; to: ISODate }): string {
  const all = totals.reduce((s, x) => s + x.total, 0);
  const top = totals[0];
  if (!top || all === 0) return 'No spending in this range yet.';
  const share = Math.round((top.total / all) * 100);
  const items = new Map<string, number>();
  for (const t of spendIn(txs, range)) if (t.categoryId === top.categoryId && t.item) items.set(t.item.toLowerCase(), (items.get(t.item.toLowerCase()) ?? 0) + t.amountPaise);
  const topItems = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  return `${name(cats, top.categoryId)} is ${share}% of your spending${topItems.length ? `, mostly ${topItems.join(' and ')}` : ''}.`;
}
