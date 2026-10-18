import { describe, expect, it } from 'vitest';
import { periodFor, shiftPeriod, daysLeft } from '@/data/dates';
import { formatMoney, parseMoney } from '@/data/money';
import type { Budget, Contribution, Goal, Person, Split, Transaction } from '@/data/types';
import { limitState, paceNudges, projectMonthEnd, rolloverInto, safeToSpendToday, summariseBudget, templateAllocations } from './math';
import { equalShares, friendBalances, matchPayback } from '@/features/friends/math';
import { milestoneFor, projectGoal, roundUpDelta } from '@/features/goals/math';
import { DEFAULT_CATEGORIES } from '@/features/categories/defaults';

const tx = (date: string, rupees: number, categoryId = 'c-tea', extra: Partial<Transaction> = {}): Transaction => ({
  id: `${date}-${rupees}-${Math.random()}`,
  date,
  type: 'expense',
  amountPaise: Math.round(rupees * 100),
  categoryId,
  item: '',
  place: '',
  paymentMode: 'UPI',
  note: '',
  sources: [{ kind: 'manual' }],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('money', () => {
  it('parses without floating point errors', () => {
    expect(parseMoney('560.20')).toBe(56_020);
    expect(parseMoney('1,25,000')).toBe(12_500_000);
    expect(parseMoney('₹ 234.52')).toBe(23_452);
    expect(parseMoney('(250.00)')).toBe(-25_000);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('abc')).toBeNull();
  });
  it('formats with Indian grouping and hides zero paise', () => {
    expect(formatMoney(12_500_000)).toBe('₹1,25,000');
    expect(formatMoney(56_020)).toBe('₹560.20');
  });
});

describe('month periods', () => {
  it('handles a custom month start day', () => {
    expect(periodFor('2026-10-18', 5)).toMatchObject({ start: '2026-10-05', end: '2026-11-04' });
    expect(periodFor('2026-10-03', 5)).toMatchObject({ start: '2026-09-05', end: '2026-10-04' });
  });
  it('clamps start days past the end of short months', () => {
    expect(periodFor('2026-02-28', 31)).toMatchObject({ start: '2026-02-28', end: '2026-03-30' });
    expect(shiftPeriod(periodFor('2026-01-15', 1), 1, 1)).toMatchObject({ start: '2026-02-01', end: '2026-02-28', days: 28 });
  });
  it('counts today in days left', () => {
    expect(daysLeft(periodFor('2026-10-18', 1), '2026-10-18')).toBe(14);
  });
});

describe('budget maths', () => {
  it('safe to spend = left ÷ days left, in whole rupees, never negative', () => {
    expect(safeToSpendToday(210_228, 14)).toBe(15_000);
    expect(safeToSpendToday(-500, 10)).toBe(0);
    expect(safeToSpendToday(1_000, 0)).toBe(0);
  });
  it('limit states', () => {
    expect(limitState(70, 100)).toBe('ok');
    expect(limitState(80, 100)).toBe('close');
    expect(limitState(101, 100)).toBe('over');
    expect(limitState(50, 0)).toBe('none');
  });
  it('projects month end, adding one-off big items only once', () => {
    expect(projectMonthEnd(1_000, 10, 30)).toBe(3_000);
    expect(projectMonthEnd(8_000 + 1_000, 10, 30, 8_000)).toBe(11_000);
  });
  it('summarises a simple budget', () => {
    const budget: Budget = { id: '2026-10-01', mode: 'simple', incomePaise: 0, totalLimitPaise: 300_000, allocations: [{ targetType: 'category', targetId: 'c-tea', amountPaise: 50_000, rollover: false }] };
    const s = summariseBudget({ budget, budgets: [budget], txs: [tx('2026-10-02', 300), tx('2026-10-05', 100, 'c-travel'), tx('2026-09-30', 999)], today: '2026-10-18', startDay: 1 });
    expect(s.spentPaise).toBe(40_000);
    expect(s.leftPaise).toBe(260_000);
    expect(s.safeTodayPaise).toBe(Math.floor(260_000 / 14 / 100) * 100);
    expect(s.lines[0]).toMatchObject({ spentPaise: 30_000, leftPaise: 20_000, state: 'ok' });
  });
  it('zero-based: left to assign = income − allocations', () => {
    const budget: Budget = {
      id: '2026-10-01',
      mode: 'zero',
      incomePaise: 1_000_000,
      totalLimitPaise: 0,
      allocations: [
        { targetType: 'category', targetId: 'c-tea', amountPaise: 300_000, rollover: false },
        { targetType: 'goal', targetId: 'g1', amountPaise: 200_000, rollover: false },
      ],
    };
    const s = summariseBudget({ budget, budgets: [budget], txs: [], today: '2026-10-18', startDay: 1 });
    expect(s.leftToAssignPaise).toBe(500_000);
    expect(s.spendablePaise).toBe(300_000);
    expect(s.savingsAllocatedPaise).toBe(200_000);
  });
  it('rolls over unspent money, never overspending, across months', () => {
    const mk = (id: string): Budget => ({ id, mode: 'simple', incomePaise: 0, totalLimitPaise: 0, allocations: [{ targetType: 'category', targetId: 'c-tea', amountPaise: 50_000, rollover: true }] });
    const budgets = [mk('2026-08-01'), mk('2026-09-01'), mk('2026-10-01')];
    const txs = [tx('2026-08-10', 300), tx('2026-09-10', 600)];
    // Aug leaves ₹200; Sep has ₹700 available, spends ₹600 → ₹100 carries into Oct.
    expect(rolloverInto('c-tea', periodFor('2026-10-05', 1), budgets, txs, 1)).toBe(10_000);
    const over = [tx('2026-08-10', 300), tx('2026-09-10', 900)];
    expect(rolloverInto('c-tea', periodFor('2026-10-05', 1), budgets, over, 1)).toBe(0);
  });
  it('nudges in plain words when the pace overshoots', () => {
    const budget: Budget = { id: '2026-10-01', mode: 'simple', incomePaise: 0, totalLimitPaise: 0, allocations: [{ targetType: 'category', targetId: 'c-eating-out', amountPaise: 90_000, rollover: false }] };
    const s = summariseBudget({ budget, budgets: [budget], txs: [tx('2026-10-03', 300, 'c-eating-out'), tx('2026-10-08', 300, 'c-eating-out')], today: '2026-10-10', startDay: 1 });
    const n = paceNudges(s);
    expect(n[0].categoryId).toBe('c-eating-out');
    expect(n[0].overByPaise).toBe(96_000);
  });
  it('builds a 50/30/20 template that never exceeds income', () => {
    const allocations = templateAllocations({ template: '503020', incomePaise: 1_000_000, categories: DEFAULT_CATEGORIES, txs: [], today: '2026-10-18', startDay: 1, savingsTargets: [{ targetType: 'goal', targetId: 'g1' }], rollover: false });
    const total = allocations.reduce((s, a) => s + a.amountPaise, 0);
    expect(total).toBe(1_000_000);
    expect(allocations.find((a) => a.targetType === 'goal')!.amountPaise).toBeGreaterThanOrEqual(200_000);
  });
});

describe('splits', () => {
  it('shares add back up to the total exactly', () => {
    expect(equalShares(110_000, 5)).toEqual([22_000, 22_000, 22_000, 22_000, 22_000]);
    const odd = equalShares(10_000, 3);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(odd).toEqual([3_334, 3_333, 3_333]);
  });
  const people: Person[] = [
    { id: 'p1', name: 'Srinivas S', aliases: ['srinivas s'] },
    { id: 'p2', name: 'Karthik R', aliases: ['karthik r'] },
  ];
  const split: Split = { id: 's1', transactionId: 't1', totalPaise: 110_000, myShareP: 22_300, paidBy: 'me', shares: [{ personId: 'p1', sharePaise: 22_000 }, { personId: 'p2', sharePaise: 21_900 }] };
  it('tracks who owes me', () => {
    const b = friendBalances([split], people);
    expect(b.find((x) => x.personId === 'p1')!.netPaise).toBe(22_000);
  });
  it('matches a friend’s UPI payback to the bill it settles', () => {
    const m = matchPayback({ type: 'income', place: 'Srinivas S', amountPaise: 22_000 }, [split], people);
    expect(m[0]).toMatchObject({ splitId: 's1', personId: 'p1', exact: true });
    expect(matchPayback({ type: 'income', place: 'Someone Else', amountPaise: 22_000 }, [split], people)).toHaveLength(0);
  });
  it('when a friend paid, I owe my share', () => {
    const s: Split = { id: 's2', transactionId: 't2', totalPaise: 60_000, myShareP: 30_000, paidBy: 'p2', shares: [{ personId: 'p2', sharePaise: 30_000 }] };
    expect(friendBalances([s], people).find((x) => x.personId === 'p2')!.netPaise).toBe(-30_000);
  });
});

describe('goals', () => {
  const goal: Goal = { id: 'g', name: 'New phone', targetPaise: 2_500_000, deadline: '2027-04-18', icon: 'phone', monthlyAllocationPaise: 0, archived: false, celebrated: 0, createdAt: 0 };
  const c = (date: string, amountPaise: number): Contribution => ({ id: date, potType: 'goal', potId: 'g', date, amountPaise, source: 'manual' });
  it('monthly amount needed and estimated finish', () => {
    const p = projectGoal(goal, [c('2026-08-20', 300_000), c('2026-09-20', 300_000), c('2026-10-10', 300_000)], '2026-10-18');
    expect(p.saved).toBe(900_000);
    expect(p.remaining).toBe(1_600_000);
    expect(p.monthlyNeeded).toBe(Math.ceil(1_600_000 / 6));
    expect(p.monthlyRate).toBe(300_000);
    expect(p.estimatedFinish).toBe('2027-04-18');
    expect(p.onTrack).toBe(true);
    expect(p.milestone).toBe(25);
  });
  it('milestones at 25/50/75/100', () => {
    expect([0.1, 0.25, 0.5, 0.8, 1].map(milestoneFor)).toEqual([0, 25, 50, 75, 100]);
  });
  it('round-up to the next ₹10', () => {
    expect(roundUpDelta(4_400)).toBe(600);
    expect(roundUpDelta(5_000)).toBe(0);
    expect(roundUpDelta(23_452)).toBe(548);
  });
});
