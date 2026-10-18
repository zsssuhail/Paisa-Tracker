import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { todayISO } from '@/data/dates';
import type { Contribution, Rule, Split, Transaction } from '@/data/types';
import { normalisePlace } from '@/features/rules/engine';
import { roundUpDelta } from '@/features/goals/math';

export type Draft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'sources'> &
  Partial<Pick<Transaction, 'id' | 'sources'>>;

export function blankDraft(): Draft {
  return {
    date: todayISO(),
    type: 'expense',
    amountPaise: 0,
    categoryId: null,
    item: '',
    place: '',
    paymentMode: 'UPI',
    note: '',
  };
}

/** Learn (or strengthen) "this place means this category". */
export async function learnRule(place: string, categoryId: string, item: string | undefined, source: Rule['source']) {
  const matchText = normalisePlace(place);
  if (!matchText) return;
  const existing = (await repo.rules.all()).find((r) => r.matchText === matchText);
  if (existing) {
    await repo.rules.update(existing.id, { categoryId, item: item || existing.item, source, hits: existing.hits + 1 });
  } else {
    await repo.rules.put({ id: uid(), matchText, categoryId, item: item || undefined, source, hits: 1, createdAt: Date.now() });
  }
}

async function applyRoundUp(tx: Transaction) {
  if (tx.type !== 'expense' || tx.excluded) return;
  const { roundUp } = await repo.settings.read();
  if (!roundUp.enabled || !roundUp.bucketId) return;
  const delta = roundUpDelta(tx.amountPaise);
  if (!delta) return;
  const c: Contribution = {
    id: `ru-${tx.id}`,
    potType: 'bucket',
    potId: roundUp.bucketId,
    date: tx.date,
    amountPaise: delta,
    source: 'roundup',
    note: `Round-up from ${tx.item || tx.place || 'a payment'}`,
  };
  await repo.contributions.put(c);
}

export async function saveTransaction(draft: Draft, opts: { always?: boolean; split?: Omit<Split, 'id' | 'transactionId'> } = {}) {
  const now = Date.now();
  const existing = draft.id ? await repo.transactions.get(draft.id) : undefined;
  const id = draft.id ?? uid();
  let splitId = existing?.splitId ?? draft.splitId;

  if (opts.split) {
    splitId = splitId ?? uid();
    await repo.splits.put({ ...opts.split, id: splitId, transactionId: id });
  }

  const tx: Transaction = {
    ...existing,
    ...draft,
    id,
    splitId,
    // My share only is spending; the split keeps the total.
    amountPaise: opts.split ? opts.split.myShareP : draft.amountPaise,
    sources: draft.sources ?? existing?.sources ?? [{ kind: 'manual' }],
    needsReview: draft.type === 'expense' && !draft.categoryId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await repo.transactions.put(tx);
  if (opts.always && tx.categoryId && tx.place) await learnRule(tx.place, tx.categoryId, tx.item, 'manual');
  if (!existing) await applyRoundUp(tx);
  return tx;
}

/** Deletes rows and their splits/round-ups; returns an undo function. */
export async function deleteTransactions(ids: string[]): Promise<() => Promise<void>> {
  const rows = (await Promise.all(ids.map((id) => repo.transactions.get(id)))).filter(Boolean) as Transaction[];
  const splitIds = rows.map((r) => r.splitId).filter(Boolean) as string[];
  const splits = (await Promise.all(splitIds.map((id) => repo.splits.get(id)))).filter(Boolean) as Split[];
  const roundUps = (await Promise.all(ids.map((id) => repo.contributions.get(`ru-${id}`)))).filter(Boolean) as Contribution[];
  // A deleted payback must un-settle the shares it settled.
  const allSplits = await repo.splits.all();
  const unsettled = allSplits.filter((s) => s.shares.some((sh) => sh.settledByTransactionId && ids.includes(sh.settledByTransactionId)));

  await repo.transaction(async () => {
    await repo.transactions.bulkRemove(ids);
    await repo.splits.bulkRemove(splitIds);
    await repo.contributions.bulkRemove(roundUps.map((c) => c.id));
    for (const s of unsettled) {
      await repo.splits.put({
        ...s,
        shares: s.shares.map((sh) =>
          sh.settledByTransactionId && ids.includes(sh.settledByTransactionId)
            ? { ...sh, settledByTransactionId: undefined, settledAt: undefined }
            : sh,
        ),
      });
    }
  });

  return async () => {
    await repo.transaction(async () => {
      await repo.transactions.bulkPut(rows);
      await repo.splits.bulkPut(splits);
      await repo.contributions.bulkPut(roundUps);
      await repo.splits.bulkPut(unsettled);
    });
  };
}

export async function duplicateTransaction(tx: Transaction, date = todayISO()) {
  const { id: _id, splitId: _s, importRef: _i, upiRef: _u, batchId: _b, sources: _src, photo: _p, isSample: _sample, ...rest } = tx;
  return saveTransaction({ ...rest, date, sources: [{ kind: 'manual' }] });
}

export async function bulkUpdate(ids: string[], patch: Partial<Transaction>) {
  const rows = (await Promise.all(ids.map((id) => repo.transactions.get(id)))).filter(Boolean) as Transaction[];
  const now = Date.now();
  await repo.transactions.bulkPut(
    rows.map((r) => {
      const next = { ...r, ...patch, updatedAt: now };
      return { ...next, needsReview: next.type === 'expense' && !next.categoryId };
    }),
  );
  return async () => repo.transactions.bulkPut(rows);
}
