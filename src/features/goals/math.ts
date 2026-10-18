import { addMonths, diffDays, todayISO } from '@/data/dates';
import type { Contribution, Goal, ISODate, Paise } from '@/data/types';
import { roundRupee } from '@/data/money';

/** Round an expense up to the next ₹10; the difference is saved virtually. */
export function roundUpDelta(amountPaise: Paise): Paise {
  if (amountPaise <= 0) return 0;
  const step = 1000;
  return Math.ceil(amountPaise / step) * step - amountPaise;
}

export function potBalance(contributions: Contribution[], potType: Contribution['potType'], potId: string): Paise {
  let sum = 0;
  for (const c of contributions) if (c.potType === potType && c.potId === potId) sum += c.amountPaise;
  return sum;
}

/** Whole months between today and the deadline, at least 1 when the deadline is in the future. */
export function monthsUntil(deadline: ISODate, today: ISODate): number {
  const days = diffDays(deadline, today);
  if (days <= 0) return 0;
  return Math.max(1, Math.round(days / 30.44));
}

/** Average saved per month over the last `months` months (contributions only, withdrawals net). */
export function savingRate(contributions: Contribution[], potType: Contribution['potType'], potId: string, today: ISODate, months = 3): Paise {
  const from = addMonths(today, -months);
  let sum = 0;
  for (const c of contributions) {
    if (c.potType === potType && c.potId === potId && c.date > from && c.date <= today) sum += c.amountPaise;
  }
  return Math.max(0, roundRupee(sum / months));
}

export interface GoalProjection {
  saved: Paise;
  remaining: Paise;
  progress: number;
  /** Needed per month to hit the deadline; null when no deadline. */
  monthlyNeeded: Paise | null;
  /** Estimated finish at current saving rate; null when not saving. */
  estimatedFinish: ISODate | null;
  monthlyRate: Paise;
  milestone: 0 | 25 | 50 | 75 | 100;
  onTrack: boolean | null;
}

export function milestoneFor(progress: number): GoalProjection['milestone'] {
  if (progress >= 1) return 100;
  if (progress >= 0.75) return 75;
  if (progress >= 0.5) return 50;
  if (progress >= 0.25) return 25;
  return 0;
}

export function projectGoal(goal: Goal, contributions: Contribution[], today = todayISO()): GoalProjection {
  const saved = potBalance(contributions, 'goal', goal.id);
  const remaining = Math.max(0, goal.targetPaise - saved);
  const progress = goal.targetPaise > 0 ? Math.min(1, saved / goal.targetPaise) : 0;
  const observed = savingRate(contributions, 'goal', goal.id, today);
  const monthlyRate = Math.max(observed, goal.monthlyAllocationPaise);

  let monthlyNeeded: Paise | null = null;
  if (goal.deadline) {
    const months = monthsUntil(goal.deadline, today);
    monthlyNeeded = months === 0 ? remaining : Math.ceil(remaining / months);
  }

  let estimatedFinish: ISODate | null = null;
  if (remaining === 0) estimatedFinish = today;
  else if (monthlyRate > 0) estimatedFinish = addMonths(today, Math.ceil(remaining / monthlyRate));

  const onTrack =
    goal.deadline && monthlyNeeded !== null ? remaining === 0 || (estimatedFinish !== null && estimatedFinish <= goal.deadline) : null;

  return { saved, remaining, progress, monthlyNeeded, estimatedFinish, monthlyRate, milestone: milestoneFor(progress), onTrack };
}

/** What saving `monthly` builds to after n months (no interest; plain and honest). */
export function buildsTo(monthly: Paise, months: number): Paise {
  return monthly * months;
}
