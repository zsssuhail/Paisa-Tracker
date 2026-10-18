import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { addDays, addMonths, todayISO } from '@/data/dates';
import type { Frequency, ISODate, Recurring } from '@/data/types';
import { saveTransaction } from '@/features/transactions/actions';

export function advance(date: ISODate, f: Frequency): ISODate {
  if (f === 'weekly') return addDays(date, 7);
  if (f === 'monthly') return addMonths(date, 1);
  return addMonths(date, 12);
}

export async function logRecurring(r: Recurring, date: ISODate) {
  await saveTransaction({
    date,
    type: 'expense',
    amountPaise: r.amountPaise,
    categoryId: r.categoryId,
    item: r.name,
    place: r.place,
    paymentMode: r.paymentMode,
    note: '',
    recurringId: r.id,
    sources: [{ kind: 'recurring' }],
  });
}

/** Auto-add items add themselves (catching up on missed dates); reminders wait for a tap. */
export async function runDueRecurring(today = todayISO()) {
  const items = await repo.recurring.all();
  for (const r of items) {
    if (!r.active || r.mode !== 'auto' || r.nextDue > today) continue;
    let due = r.nextDue;
    let guard = 0;
    while (due <= today && guard++ < 60) {
      await logRecurring(r, due);
      due = advance(due, r.frequency);
    }
    await repo.recurring.update(r.id, { nextDue: due });
  }
}

/** Reminder tapped "Add now": log it and move to the next date. */
export async function addDueNow(r: Recurring) {
  await logRecurring(r, r.nextDue <= todayISO() ? r.nextDue : todayISO());
  await repo.recurring.update(r.id, { nextDue: advance(r.nextDue, r.frequency) });
}

export async function skipDue(r: Recurring) {
  await repo.recurring.update(r.id, { nextDue: advance(r.nextDue, r.frequency) });
}

export async function createRecurring(partial: Omit<Recurring, 'id' | 'active'> & { active?: boolean }) {
  const id = uid();
  await repo.recurring.put({ active: true, ...partial, id });
  return id;
}
