import { repo } from '@/data/repo';
import { periodFor, shiftPeriod, todayISO } from '@/data/dates';
import type { Allocation, Budget, ISODate, Paise } from '@/data/types';

export async function getOrCreateBudget(periodStart: ISODate): Promise<Budget> {
  const existing = await repo.budgets.get(periodStart);
  if (existing) return existing;
  const settings = await repo.settings.read();
  // Carry the structure forward from the most recent earlier budget.
  const prevId = shiftPeriod(periodFor(periodStart, settings.monthStartDay), -1, settings.monthStartDay).start;
  const prev = await repo.budgets.get(prevId);
  const fresh: Budget = prev
    ? { ...prev, id: periodStart, isSample: false }
    : { id: periodStart, mode: settings.budgetMode, incomePaise: 0, totalLimitPaise: 0, allocations: [] };
  await repo.budgets.put(fresh);
  return fresh;
}

export async function saveBudget(b: Budget) {
  await repo.budgets.put({ ...b, isSample: false });
}

export async function setAllocation(periodStart: ISODate, target: Pick<Allocation, 'targetType' | 'targetId'>, amountPaise: Paise, rollover?: boolean) {
  const b = await getOrCreateBudget(periodStart);
  const settings = await repo.settings.read();
  const i = b.allocations.findIndex((a) => a.targetType === target.targetType && a.targetId === target.targetId);
  const allocations = [...b.allocations];
  if (amountPaise <= 0 && i >= 0) allocations.splice(i, 1);
  else if (i >= 0) allocations[i] = { ...allocations[i], amountPaise, rollover: rollover ?? allocations[i].rollover };
  else if (amountPaise > 0) allocations.push({ ...target, amountPaise, rollover: rollover ?? settings.defaultRollover });
  await saveBudget({ ...b, allocations });
}

/** Used by insight cards: "Set a ₹900 limit". */
export async function setCategoryLimitNow(categoryId: string, amountPaise: Paise) {
  const { monthStartDay } = await repo.settings.read();
  await setAllocation(periodFor(todayISO(), monthStartDay).start, { targetType: 'category', targetId: categoryId }, amountPaise);
}
