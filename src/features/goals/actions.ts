import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { periodFor, shiftPeriod, todayISO } from '@/data/dates';
import type { Bucket, Contribution, Goal, Paise } from '@/data/types';
import { summariseBudget, totalIncome } from '@/features/budget/math';

export async function saveGoal(goal: Omit<Goal, 'id' | 'createdAt' | 'celebrated' | 'archived'> & Partial<Goal>) {
  const id = goal.id ?? uid();
  const existing = goal.id ? await repo.goals.get(goal.id) : undefined;
  await repo.goals.put({ archived: false, celebrated: 0, createdAt: Date.now(), ...existing, ...goal, id });
  return id;
}

export async function saveBucket(bucket: Omit<Bucket, 'id' | 'archived' | 'order'> & Partial<Bucket>) {
  const id = bucket.id ?? uid();
  const all = await repo.buckets.all();
  const existing = all.find((b) => b.id === id);
  await repo.buckets.put({ archived: false, order: all.length, createdAt: Date.now(), ...existing, ...bucket, id });
  return id;
}

export async function contribute(potType: Contribution['potType'], potId: string, amountPaise: Paise, source: Contribution['source'] = 'manual', note?: string) {
  await repo.contributions.put({ id: uid(), potType, potId, date: todayISO(), amountPaise, source, note });
}

/** Rolling money between pots is one move: out of one, into the other, same day. */
export async function movePot(from: { type: Contribution['potType']; id: string }, to: { type: Contribution['potType']; id: string }, amountPaise: Paise) {
  const date = todayISO();
  await repo.contributions.bulkPut([
    { id: uid(), potType: from.type, potId: from.id, date, amountPaise: -amountPaise, source: 'move' },
    { id: uid(), potType: to.type, potId: to.id, date, amountPaise, source: 'move' },
  ]);
}

const AUTO_SOURCES = new Set<Contribution['source']>(['auto', 'income-split', 'leftover']);

function hasAutoIn(contribs: Contribution[], potType: Contribution['potType'], potId: string, start: string, end: string, sources = AUTO_SOURCES) {
  return contribs.some((c) => c.potType === potType && c.potId === potId && c.date >= start && c.date <= end && sources.has(c.source));
}

/**
 * Monthly auto-saving, safe to run any number of times:
 * - goals: their monthly amount (or this month's budget line) once per month
 * - fixed buckets: their amount once per month
 * - percent buckets: a share of income logged so far this month (kept up to date)
 * - leftover buckets: last month's unspent budget, split evenly, once
 * Nothing is back-filled for months before a pot existed.
 */
export async function runAutoSavings(today = todayISO()) {
  const [settings, goals, buckets, contribs, budgets, txs] = await Promise.all([
    repo.settings.read(),
    repo.goals.all(),
    repo.buckets.all(),
    repo.contributions.all(),
    repo.budgets.all(),
    repo.transactions.all(),
  ]);
  const period = periodFor(today, settings.monthStartDay);
  const budget = budgets.find((b) => b.id === period.start);
  const writes: Contribution[] = [];
  const createdBefore = (createdAt: number | undefined, date: string) => !createdAt || new Date(createdAt).toISOString().slice(0, 10) <= date;

  for (const g of goals) {
    if (g.archived) continue;
    const planned = budget?.allocations.find((a) => a.targetType === 'goal' && a.targetId === g.id)?.amountPaise ?? g.monthlyAllocationPaise;
    if (planned > 0 && !hasAutoIn(contribs, 'goal', g.id, period.start, period.end)) {
      writes.push({ id: `auto-g-${g.id}-${period.start}`, potType: 'goal', potId: g.id, date: today, amountPaise: planned, source: 'auto' });
    }
  }

  const income = totalIncome(txs, period);
  const prev = shiftPeriod(period, -1, settings.monthStartDay);
  const prevBudget = budgets.find((b) => b.id === prev.start);
  const leftover = prevBudget ? Math.max(0, summariseBudget({ budget: prevBudget, budgets, txs, today: prev.end, startDay: settings.monthStartDay, period: prev }).leftPaise) : 0;
  const leftoverBuckets = buckets.filter((b) => !b.archived && b.rule === 'leftover' && createdBefore(b.createdAt, prev.end));

  for (const b of buckets) {
    if (b.archived) continue;
    const planned = budget?.allocations.find((a) => a.targetType === 'bucket' && a.targetId === b.id)?.amountPaise;
    if (b.rule === 'fixed' || planned) {
      const amount = planned ?? b.ruleValue;
      if (amount > 0 && !hasAutoIn(contribs, 'bucket', b.id, period.start, period.end)) {
        writes.push({ id: `auto-b-${b.id}-${period.start}`, potType: 'bucket', potId: b.id, date: today, amountPaise: amount, source: 'auto' });
      }
    } else if (b.rule === 'percent') {
      const id = `auto-b-${b.id}-${period.start}`;
      const amount = Math.floor((income * b.ruleValue) / 10_000);
      const others = contribs.filter((c) => c.id !== id);
      if (amount > 0 && !hasAutoIn(others, 'bucket', b.id, period.start, period.end)) {
        writes.push({ id, potType: 'bucket', potId: b.id, date: today, amountPaise: amount, source: 'auto', note: `${b.ruleValue / 100}% of income` });
      }
    } else if (b.rule === 'leftover' && leftover > 0 && leftoverBuckets.length) {
      const share = Math.floor(leftover / leftoverBuckets.length);
      if (share > 0 && !hasAutoIn(contribs, 'bucket', b.id, prev.end, prev.end, new Set(['leftover']))) {
        writes.push({ id: `leftover-${b.id}-${prev.start}`, potType: 'bucket', potId: b.id, date: prev.end, amountPaise: share, source: 'leftover', note: 'Unspent budget from last month' });
      }
    }
  }
  if (writes.length) await repo.contributions.bulkPut(writes);
}

export interface SplitProposal {
  potType: Contribution['potType'];
  potId: string;
  name: string;
  amountPaise: Paise;
}

/** Pay yourself first: when income lands, propose how much goes to each pot before spending. */
export function proposeIncomeSplit(incomePaise: Paise, goals: Goal[], buckets: Bucket[]): SplitProposal[] {
  const out: SplitProposal[] = [];
  for (const b of buckets) {
    if (b.archived) continue;
    if (b.rule === 'percent') out.push({ potType: 'bucket', potId: b.id, name: b.name, amountPaise: Math.floor((incomePaise * b.ruleValue) / 10_000) });
    else if (b.rule === 'fixed') out.push({ potType: 'bucket', potId: b.id, name: b.name, amountPaise: Math.min(b.ruleValue, incomePaise) });
  }
  for (const g of goals) {
    if (!g.archived && g.monthlyAllocationPaise > 0) out.push({ potType: 'goal', potId: g.id, name: g.name, amountPaise: g.monthlyAllocationPaise });
  }
  // Never propose more than came in.
  let left = incomePaise;
  return out.map((p) => {
    const amountPaise = Math.max(0, Math.min(p.amountPaise, left));
    left -= amountPaise;
    return { ...p, amountPaise };
  });
}

export async function applyIncomeSplit(txId: string, date: string, items: SplitProposal[]) {
  await repo.contributions.bulkPut(
    items
      .filter((i) => i.amountPaise > 0)
      .map((i) => ({ id: `split-${txId}-${i.potId}`, potType: i.potType, potId: i.potId, date, amountPaise: i.amountPaise, source: 'income-split' as const, note: 'Paid myself first' })),
  );
}

export async function addDebt(name: string, direction: 'i-owe' | 'owed-to-me', totalPaise: Paise) {
  await repo.debts.put({ id: uid(), name, direction, totalPaise, payments: [], createdAt: Date.now() });
}

export async function payDebt(id: string, amountPaise: Paise) {
  const d = await repo.debts.get(id);
  if (!d) return;
  await repo.debts.put({ ...d, payments: [...d.payments, { date: todayISO(), amountPaise }] });
}
