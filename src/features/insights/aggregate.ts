import { addDays, diffDays, eachDay, isoWeekStart, periodFor, shiftPeriod, weekday, type Period } from '@/data/dates';
import type { Account, Category, CategoryGroup, Debt, ISODate, Paise, Split, Transaction } from '@/data/types';
import { isIncome, isSpending } from '@/features/budget/math';
import { normalisePlace } from '@/features/rules/engine';
import { roundRupee } from '@/data/money';

export interface Range {
  from: ISODate;
  to: ISODate;
}

const within = (t: { date: ISODate }, r: Range) => t.date >= r.from && t.date <= r.to;

export function spendIn(txs: Transaction[], r: Range): Transaction[] {
  return txs.filter((t) => isSpending(t) && within(t, r));
}

export interface CategoryTotal {
  categoryId: string;
  total: Paise;
  count: number;
}

export function byCategory(txs: Transaction[], r: Range): CategoryTotal[] {
  const m = new Map<string, CategoryTotal>();
  for (const t of spendIn(txs, r)) {
    const k = t.categoryId ?? 'uncategorised';
    const e = m.get(k) ?? { categoryId: k, total: 0, count: 0 };
    e.total += t.amountPaise;
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export function byGroup(totals: CategoryTotal[], cats: Map<string, Category>, groups: CategoryGroup[]) {
  const m = new Map<string, { groupId: string; name: string; total: Paise; children: CategoryTotal[] }>();
  for (const t of totals) {
    const g = cats.get(t.categoryId)?.groupId ?? 'none';
    const e = m.get(g) ?? { groupId: g, name: groups.find((x) => x.id === g)?.name ?? 'Needs a category', total: 0, children: [] };
    e.total += t.total;
    e.children.push(t);
    m.set(g, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** Top n, folding the rest into "Other" so a chart never runs out of distinct colours. */
export function topWithOther(totals: CategoryTotal[], n = 7): (CategoryTotal & { other?: boolean })[] {
  if (totals.length <= n + 1) return totals;
  const head = totals.slice(0, n);
  const rest = totals.slice(n);
  return [...head, { categoryId: 'other', total: rest.reduce((s, x) => s + x.total, 0), count: rest.reduce((s, x) => s + x.count, 0), other: true }];
}

export function byDay(txs: Transaction[], r: Range): { date: ISODate; total: Paise; count: number }[] {
  const m = new Map<string, { total: number; count: number }>();
  for (const t of spendIn(txs, r)) {
    const e = m.get(t.date) ?? { total: 0, count: 0 };
    e.total += t.amountPaise;
    e.count++;
    m.set(t.date, e);
  }
  return eachDay(r.from, r.to).map((date) => ({ date, total: m.get(date)?.total ?? 0, count: m.get(date)?.count ?? 0 }));
}

/** Running total vs an even pace line toward the budget, plus straight-line projection. */
export function runningVsPace(txs: Transaction[], period: Period, budgetPaise: Paise, today: ISODate) {
  const days = byDay(txs, { from: period.start, to: period.end });
  let cum = 0;
  const elapsedEnd = today < period.end ? today : period.end;
  const elapsed = Math.max(1, diffDays(elapsedEnd, period.start) + 1);
  let bigToToday = 0;
  for (const t of spendIn(txs, { from: period.start, to: elapsedEnd })) if (t.bigItem) bigToToday += t.amountPaise;
  let spentToToday = 0;
  for (const d of days) if (d.date <= elapsedEnd) spentToToday += d.total;
  const perDay = (spentToToday - bigToToday) / elapsed;
  return days.map((d, i) => {
    const isPast = d.date <= elapsedEnd;
    if (isPast) cum += d.total;
    return {
      date: d.date,
      actual: isPast ? cum : null,
      pace: budgetPaise > 0 ? Math.round((budgetPaise / period.days) * (i + 1)) : null,
      projected: d.date >= elapsedEnd ? bigToToday + roundRupee(perDay * (i + 1)) : null,
    };
  });
}

export function monthCompare(txs: Transaction[], current: Period, startDay: number) {
  const last = shiftPeriod(current, -1, startDay);
  const prev3 = [1, 2, 3].map((i) => shiftPeriod(current, -i, startDay));
  const now = new Map(byCategory(txs, { from: current.start, to: current.end }).map((c) => [c.categoryId, c.total]));
  const lastM = new Map(byCategory(txs, { from: last.start, to: last.end }).map((c) => [c.categoryId, c.total]));
  const avg = new Map<string, number>();
  for (const p of prev3) for (const c of byCategory(txs, { from: p.start, to: p.end })) avg.set(c.categoryId, (avg.get(c.categoryId) ?? 0) + c.total);
  const ids = new Set([...now.keys(), ...lastM.keys(), ...avg.keys()]);
  return [...ids]
    .map((id) => ({ categoryId: id, current: now.get(id) ?? 0, last: lastM.get(id) ?? 0, avg3: roundRupee((avg.get(id) ?? 0) / 3) }))
    .sort((a, b) => b.current - a.current || b.avg3 - a.avg3);
}

export function weekdayPattern(txs: Transaction[], r: Range) {
  const totals = Array(7).fill(0) as number[];
  const daysCount = Array(7).fill(0) as number[];
  for (const d of eachDay(r.from, r.to)) daysCount[weekday(d)]++;
  for (const t of spendIn(txs, r)) totals[weekday(t.date)] += t.amountPaise;
  // Monday first.
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ weekday: wd, total: totals[wd], average: daysCount[wd] ? roundRupee(totals[wd] / daysCount[wd]) : 0 }));
}

export const SIZE_BANDS = [
  { id: 'lt50', label: 'Under ₹50', min: 0, max: 4_999 },
  { id: '50-99', label: '₹50 – 99', min: 5_000, max: 9_999 },
  { id: '100-299', label: '₹100 – 299', min: 10_000, max: 29_999 },
  { id: '300+', label: '₹300 and up', min: 30_000, max: Infinity },
] as const;

export function sizeBands(txs: Transaction[], r: Range) {
  const out = SIZE_BANDS.map((b) => ({ ...b, count: 0, total: 0 }));
  for (const t of spendIn(txs, r)) {
    const b = out.find((x) => t.amountPaise >= x.min && t.amountPaise <= x.max);
    if (b) {
      b.count++;
      b.total += t.amountPaise;
    }
  }
  return out;
}

export interface PlaceTotal {
  place: string;
  key: string;
  visits: number;
  total: Paise;
  average: Paise;
  topCategoryId: string | null;
}

export function topPlaces(txs: Transaction[], r: Range, n = 10): PlaceTotal[] {
  const m = new Map<string, PlaceTotal & { cats: Map<string, number> }>();
  for (const t of spendIn(txs, r)) {
    if (!t.place) continue;
    const key = normalisePlace(t.place);
    const e = m.get(key) ?? { place: t.place, key, visits: 0, total: 0, average: 0, topCategoryId: null, cats: new Map() };
    e.visits++;
    e.total += t.amountPaise;
    if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1);
    m.set(key, e);
  }
  return [...m.values()]
    .map(({ cats, ...e }) => ({ ...e, average: roundRupee(e.total / e.visits), topCategoryId: [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export function lastNPeriods(today: ISODate, startDay: number, n: number): Period[] {
  const cur = periodFor(today, startDay);
  return Array.from({ length: n }, (_, i) => shiftPeriod(cur, i - n + 1, startDay));
}

export function incomeVsSpending(txs: Transaction[], periods: Period[]) {
  return periods.map((p) => {
    let income = 0;
    let spent = 0;
    for (const t of txs) {
      if (t.date < p.start || t.date > p.end) continue;
      if (isIncome(t)) income += t.amountPaise;
      else if (isSpending(t)) spent += t.amountPaise;
    }
    return { period: p, income, spent, saved: income - spent, rate: income > 0 ? (income - spent) / income : null };
  });
}

export function stackedByMonth(txs: Transaction[], periods: Period[], categoryIds: string[]) {
  return periods.map((p) => {
    const row: Record<string, number | Period> & { period: Period } = { period: p };
    const totals = byCategory(txs, { from: p.start, to: p.end });
    let other = 0;
    for (const c of totals) {
      if (categoryIds.includes(c.categoryId)) row[c.categoryId] = c.total;
      else other += c.total;
    }
    row.other = other;
    return row;
  });
}

export function needsWants(txs: Transaction[], r: Range, cats: Map<string, Category>, savedPaise: Paise, incomePaise: Paise) {
  let need = 0;
  let want = 0;
  let unknown = 0;
  for (const t of spendIn(txs, r)) {
    const n = t.categoryId ? cats.get(t.categoryId)?.nature : undefined;
    if (n === 'need') need += t.amountPaise;
    else if (n === 'want') want += t.amountPaise;
    else unknown += t.amountPaise;
  }
  const base = incomePaise || need + want + unknown + savedPaise;
  return { need, want, unknown, saved: savedPaise, base };
}

/** Weekly money in vs money out (Mondays). */
export function weeklyCashflow(txs: Transaction[], r: Range) {
  const weeks = new Map<string, { week: ISODate; moneyIn: Paise; moneyOut: Paise }>();
  for (let w = isoWeekStart(r.from); w <= r.to; w = addDays(w, 7)) weeks.set(w, { week: w, moneyIn: 0, moneyOut: 0 });
  for (const t of txs) {
    if (!within(t, r)) continue;
    const w = weeks.get(isoWeekStart(t.date));
    if (!w) continue;
    if (isIncome(t)) w.moneyIn += t.amountPaise;
    else if (isSpending(t)) w.moneyOut += t.amountPaise;
  }
  return [...weeks.values()];
}

/**
 * Net worth at each period end: account opening balances + all money in − all money out,
 * plus what friends owe me, minus what I owe. Goals and buckets are money I still hold, so they are inside "cash".
 */
export function netWorthSeries(args: { txs: Transaction[]; periods: Period[]; accounts: Account[]; splits: Split[]; debts: Debt[] }) {
  const { txs, periods, accounts, splits, debts } = args;
  const opening = accounts.reduce((s, a) => s + a.openingBalancePaise, 0);
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(txs.map((t) => [t.id, t]));
  return periods.map((p) => {
    let cash = opening;
    for (const t of sorted) {
      if (t.date > p.end) break;
      if (t.excluded) continue;
      if (t.type === 'income') cash += t.amountPaise;
      else if (t.type === 'expense') cash -= t.amountPaise;
      else if (t.subtype === 'settlement') cash -= t.amountPaise;
    }
    let owedToMe = 0;
    let iOwe = 0;
    for (const s of splits) {
      const bill = byId.get(s.transactionId);
      if (!bill || bill.date > p.end) continue;
      if (s.paidBy === 'me') {
        // I paid the full bill, but only my share is recorded as spending.
        cash -= s.totalPaise - s.myShareP;
        for (const sh of s.shares) if (!(sh.settledAt && sh.settledAt <= p.end)) owedToMe += sh.sharePaise;
      } else {
        // A friend paid: my share is spending, but the cash leaves only when I settle.
        cash += s.myShareP;
        const payer = s.shares.find((sh) => sh.personId === s.paidBy);
        if (!(payer?.settledAt && payer.settledAt <= p.end)) iOwe += s.myShareP;
      }
    }
    for (const d of debts) {
      if (new Date(d.createdAt).toISOString().slice(0, 10) > p.end) continue;
      const left = d.totalPaise - d.payments.filter((x) => x.date <= p.end).reduce((s, x) => s + x.amountPaise, 0);
      if (d.direction === 'i-owe') iOwe += left;
      else owedToMe += left;
    }
    return { period: p, cash, owedToMe, iOwe, net: cash + owedToMe - iOwe };
  });
}

export type Cadence = 'daily' | 'weekly' | 'monthly';

export interface RepeatingPattern {
  key: string;
  place: string;
  item: string;
  categoryId: string | null;
  cadence: Cadence;
  typicalPaise: Paise;
  perMonthPaise: Paise;
  visits: number;
  lastDate: ISODate;
}

/** Group repeating payments to the same place by how often they happen. */
export function repeatingPayments(txs: Transaction[], r: Range): RepeatingPattern[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of spendIn(txs, r)) {
    const key = normalisePlace(t.place || t.item);
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  const span = Math.max(1, diffDays(r.to, r.from) + 1);
  const months = span / 30.44;
  const out: RepeatingPattern[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const dates = [...new Set(list.map((t) => t.date))].sort();
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => diffDays(d, dates[i]));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const cadence: Cadence | null = median <= 2 ? 'daily' : median <= 9 ? 'weekly' : median >= 25 && median <= 35 ? 'monthly' : null;
    if (!cadence) continue;
    const amounts = list.map((t) => t.amountPaise).sort((a, b) => a - b);
    const typical = amounts[Math.floor(amounts.length / 2)];
    // Bills repeat at a steady price; varied amounts at a place are a habit, not a bill.
    if (cadence === 'monthly' && amounts.some((a) => Math.abs(a - typical) > typical * 0.1)) continue;
    const total = amounts.reduce((s, a) => s + a, 0);
    const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push({
      key,
      place: latest.place || latest.item,
      item: latest.item,
      categoryId: latest.categoryId,
      cadence,
      typicalPaise: typical,
      perMonthPaise: roundRupee(total / Math.max(1, months)),
      visits: list.length,
      lastDate: latest.date,
    });
  }
  return out.sort((a, b) => b.perMonthPaise - a.perMonthPaise);
}

export function totalOf(list: { total: number }[]) {
  return list.reduce((s, x) => s + x.total, 0);
}

export function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
