import { daysElapsed, daysLeft, periodFor, shiftPeriod, type Period } from '@/data/dates';
import type { Budget, Category, Contribution, ISODate, Paise, Transaction } from '@/data/types';
import { roundRupee } from '@/data/money';

/** Money that counts as spending: expenses that aren't excluded. Transfers never count. */
export function isSpending(t: Transaction): boolean {
  return t.type === 'expense' && !t.excluded;
}

export function isIncome(t: Transaction): boolean {
  return t.type === 'income' && !t.excluded && t.subtype !== 'payback' && t.subtype !== 'refund';
}

export function inPeriod(t: { date: ISODate }, p: Period): boolean {
  return t.date >= p.start && t.date <= p.end;
}

export function spentByCategory(txs: Transaction[], p: Period, upTo?: ISODate): Map<string, Paise> {
  const m = new Map<string, Paise>();
  for (const t of txs) {
    if (!isSpending(t) || !inPeriod(t, p) || (upTo && t.date > upTo)) continue;
    const k = t.categoryId ?? 'uncategorised';
    m.set(k, (m.get(k) ?? 0) + t.amountPaise);
  }
  return m;
}

export function totalSpent(txs: Transaction[], p: Period, upTo?: ISODate): Paise {
  let s = 0;
  for (const t of txs) if (isSpending(t) && inPeriod(t, p) && (!upTo || t.date <= upTo)) s += t.amountPaise;
  return s;
}

export function totalIncome(txs: Transaction[], p: Period): Paise {
  let s = 0;
  for (const t of txs) if (isIncome(t) && inPeriod(t, p)) s += t.amountPaise;
  return s;
}

export type LimitState = 'none' | 'ok' | 'close' | 'over';

/** On track below 80%, "close" from 80%, "over" past 100%. */
export function limitState(spent: Paise, limit: Paise): LimitState {
  if (limit <= 0) return 'none';
  const r = spent / limit;
  if (r > 1) return 'over';
  if (r >= 0.8) return 'close';
  return 'ok';
}

/** (money left in the month) ÷ (days left including today), floored to whole rupees, never negative. */
export function safeToSpendToday(leftPaise: Paise, daysRemaining: number): Paise {
  if (daysRemaining <= 0 || leftPaise <= 0) return 0;
  return Math.floor(leftPaise / daysRemaining / 100) * 100;
}

/** Spending flagged as a one-off big item; excluded from pace projections. */
export function bigItemsSpent(txs: Transaction[], p: Period, categoryId?: string): Paise {
  let s = 0;
  for (const t of txs) if (t.bigItem && isSpending(t) && inPeriod(t, p) && (!categoryId || t.categoryId === categoryId)) s += t.amountPaise;
  return s;
}

/** Straight-line month-end projection from the pace so far; one-off big items are added once, not extrapolated. */
export function projectMonthEnd(spentSoFar: Paise, elapsed: number, totalDays: number, oneOffs: Paise = 0): Paise {
  if (elapsed <= 0) return spentSoFar;
  return oneOffs + roundRupee(((spentSoFar - oneOffs) / elapsed) * totalDays);
}

/**
 * Unspent money carried into `period` for a category with rollover on.
 * Walks back through consecutive budgets that have rollover enabled; overspending never carries.
 */
export function rolloverInto(
  categoryId: string,
  period: Period,
  budgets: Budget[],
  txs: Transaction[],
  startDay: number,
  depth = 12,
): Paise {
  if (depth <= 0) return 0;
  const prev = shiftPeriod(period, -1, startDay);
  const budget = budgets.find((b) => b.id === prev.start);
  const alloc = budget?.allocations.find((a) => a.targetType === 'category' && a.targetId === categoryId);
  if (!budget || !alloc || !alloc.rollover) return 0;
  const carried = rolloverInto(categoryId, prev, budgets, txs, startDay, depth - 1);
  const spent = spentByCategory(txs, prev).get(categoryId) ?? 0;
  return Math.max(0, alloc.amountPaise + carried - spent);
}

export interface CategoryLine {
  categoryId: string;
  limitPaise: Paise;
  carriedPaise: Paise;
  availablePaise: Paise;
  spentPaise: Paise;
  leftPaise: Paise;
  projectedPaise: Paise;
  state: LimitState;
}

export interface BudgetSummary {
  period: Period;
  hasBudget: boolean;
  /** What this month's spending is measured against. */
  spendablePaise: Paise;
  spentPaise: Paise;
  leftPaise: Paise;
  safeTodayPaise: Paise;
  daysLeft: number;
  elapsed: number;
  projectedPaise: Paise;
  incomePaise: Paise;
  /** Zero-based only: income not yet given a job. */
  leftToAssignPaise: Paise;
  savingsAllocatedPaise: Paise;
  lines: CategoryLine[];
  state: LimitState;
}

export function summariseBudget(args: {
  budget: Budget | undefined;
  budgets: Budget[];
  txs: Transaction[];
  today: ISODate;
  startDay: number;
  period?: Period;
}): BudgetSummary {
  const { budget, budgets, txs, today, startDay } = args;
  const period = args.period ?? periodFor(today, startDay);
  const spentMap = spentByCategory(txs, period);
  const spent = totalSpent(txs, period);
  const elapsed = daysElapsed(period, today);
  const remainingDays = daysLeft(period, today);
  const income = totalIncome(txs, period);

  const lines: CategoryLine[] = [];
  let categoryTotal = 0;
  let savingsAllocated = 0;
  for (const a of budget?.allocations ?? []) {
    if (a.targetType !== 'category') {
      savingsAllocated += a.amountPaise;
      continue;
    }
    const carried = a.rollover ? rolloverInto(a.targetId, period, budgets, txs, startDay) : 0;
    const available = a.amountPaise + carried;
    const s = spentMap.get(a.targetId) ?? 0;
    categoryTotal += available;
    lines.push({
      categoryId: a.targetId,
      limitPaise: a.amountPaise,
      carriedPaise: carried,
      availablePaise: available,
      spentPaise: s,
      leftPaise: available - s,
      projectedPaise: projectMonthEnd(s, elapsed, period.days, bigItemsSpent(txs, period, a.targetId)),
      state: limitState(s, available),
    });
  }

  let spendable = 0;
  if (budget) {
    if (budget.mode === 'zero') spendable = categoryTotal;
    else spendable = budget.totalLimitPaise || categoryTotal;
  } else {
    spendable = income;
  }

  const baseIncome = budget?.incomePaise || income;
  const assigned = (budget?.allocations ?? []).reduce((s, a) => s + a.amountPaise, 0);
  const left = spendable - spent;
  return {
    period,
    hasBudget: Boolean(budget),
    spendablePaise: spendable,
    spentPaise: spent,
    leftPaise: left,
    safeTodayPaise: safeToSpendToday(left, remainingDays),
    daysLeft: remainingDays,
    elapsed,
    projectedPaise: projectMonthEnd(spent, elapsed, period.days, bigItemsSpent(txs, period)),
    incomePaise: baseIncome,
    leftToAssignPaise: budget?.mode === 'zero' ? baseIncome - assigned : 0,
    savingsAllocatedPaise: savingsAllocated,
    lines,
    state: limitState(spent, spendable),
  };
}

export interface Nudge {
  categoryId: string;
  overByPaise: Paise;
}

/** "At this pace you'll overspend Eating Out by about ₹400." Only after a few days of data. */
export function paceNudges(summary: BudgetSummary, minDays = 5): Nudge[] {
  if (summary.elapsed < minDays || summary.daysLeft <= 0) return [];
  return summary.lines
    .filter((l) => l.availablePaise > 0 && l.projectedPaise > l.availablePaise && l.state !== 'over')
    .map((l) => ({ categoryId: l.categoryId, overByPaise: roundNice(l.projectedPaise - l.availablePaise) }))
    .sort((a, b) => b.overByPaise - a.overByPaise);
}

/** Round to a friendly figure: nearest ₹10 under ₹1,000, nearest ₹50 above. */
export function roundNice(p: Paise): Paise {
  const step = p >= 100_000 ? 5_000 : 1_000;
  return Math.max(step, Math.round(p / step) * step);
}

export type TemplateId = '503020' | 'student' | 'history';

/** Monthly average spend per category across the last n complete periods. */
export function averageByCategory(txs: Transaction[], today: ISODate, startDay: number, n = 3): Map<string, Paise> {
  const current = periodFor(today, startDay);
  const totals = new Map<string, Paise>();
  for (let i = 1; i <= n; i++) {
    const p = shiftPeriod(current, -i, startDay);
    for (const [k, v] of spentByCategory(txs, p)) totals.set(k, (totals.get(k) ?? 0) + v);
  }
  const out = new Map<string, Paise>();
  for (const [k, v] of totals) if (k !== 'uncategorised') out.set(k, roundNice(Math.round(v / n)));
  return out;
}

const STUDENT_ESSENTIALS: Record<string, number> = {
  'c-tea': 1_000,
  'c-snacks': 800,
  'c-eating-out': 1_500,
  'c-fruits': 400,
  'c-groceries': 800,
  'c-stationery': 400,
  'c-travel': 1_500,
  'c-phone': 500,
  'c-medical': 500,
  'c-laundry': 400,
  'c-personal': 300,
  'c-misc': 500,
};

/**
 * Build allocations from a beginner template. 50/30/20 splits income into needs/wants/savings
 * and spreads each share across categories by the user's own history (or evenly).
 */
export function templateAllocations(args: {
  template: TemplateId;
  incomePaise: Paise;
  categories: Category[];
  txs: Transaction[];
  today: ISODate;
  startDay: number;
  savingsTargets: { targetType: 'goal' | 'bucket'; targetId: string }[];
  rollover: boolean;
}): Budget['allocations'] {
  const { template, incomePaise, categories, txs, today, startDay, savingsTargets, rollover } = args;
  const active = categories.filter((c) => !c.archived);
  const avg = averageByCategory(txs, today, startDay);

  if (template === 'student') {
    return active
      .filter((c) => STUDENT_ESSENTIALS[c.id])
      .map((c) => ({ targetType: 'category' as const, targetId: c.id, amountPaise: STUDENT_ESSENTIALS[c.id] * 100, rollover }));
  }
  if (template === 'history') {
    return active
      .filter((c) => (avg.get(c.id) ?? 0) > 0)
      .map((c) => ({ targetType: 'category' as const, targetId: c.id, amountPaise: avg.get(c.id)!, rollover }));
  }

  const spread = (cats: Category[], pot: Paise) => {
    const weights = cats.map((c) => avg.get(c.id) ?? 0);
    const sum = weights.reduce((a, b) => a + b, 0);
    return cats.map((c, i) => ({
      targetType: 'category' as const,
      targetId: c.id,
      amountPaise: Math.floor(((sum > 0 ? weights[i] / sum : 1 / cats.length) * pot) / 1000) * 1000,
      rollover,
    }));
  };
  const needs = spread(active.filter((c) => c.nature === 'need'), Math.round(incomePaise * 0.5));
  const wants = spread(active.filter((c) => c.nature === 'want'), Math.round(incomePaise * 0.3));
  const savingsPot = incomePaise - [...needs, ...wants].reduce((s, a) => s + a.amountPaise, 0);
  const savings = savingsTargets.length
    ? savingsTargets.map((t, i) => ({
        ...t,
        amountPaise: Math.floor(savingsPot / savingsTargets.length) + (i === 0 ? savingsPot % savingsTargets.length : 0),
        rollover: false,
      }))
    : [];
  return [...needs.filter((a) => a.amountPaise > 0), ...wants.filter((a) => a.amountPaise > 0), ...savings];
}

/** Total kept in savings pots during a period. */
export function savedInPeriod(contributions: Contribution[], p: Period): Paise {
  let s = 0;
  for (const c of contributions) if (c.date >= p.start && c.date <= p.end && c.source !== 'move') s += c.amountPaise;
  return s;
}
