import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import type { ImportBatch, SourceKind, Split, Transaction } from '@/data/types';
import { equalShares } from '@/features/friends/math';
import { addCategory, ensureDefaultCategories } from '@/features/categories/actions';
import { learnRule } from '@/features/transactions/actions';
import type { Candidate } from './build';

export interface CommitInput {
  candidates: Candidate[];
  sourceKind: SourceKind;
  parserId: string;
  fileName: string;
  unreadable: number;
  skipped: number;
  /** Payees the user said "always use this category" for. */
  learn: { payee: string; categoryId: string }[];
}

/**
 * Save an import as one batch: new rows become transactions, same-payment rows add a source
 * tag to the existing transaction instead of a copy, duplicates are dropped. Undo removes the batch.
 */
export async function commitImport(input: CommitInput): Promise<ImportBatch> {
  await ensureDefaultCategories();
  const batchId = uid();
  const now = Date.now();
  const tag = { kind: input.sourceKind, parser: input.parserId, batchId };
  const approved = input.candidates.filter((c) => c.approved && c.status !== 'duplicate');

  // Spreadsheet categories that don't exist yet are created once, by name.
  const categories = await repo.categories.all();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  for (const c of approved) {
    if (c.categoryId || !c.raw.categoryName || c.cls.type !== 'expense') continue;
    const key = c.raw.categoryName.toLowerCase();
    if (!byName.has(key)) byName.set(key, await addCategory(c.raw.categoryName));
    c.categoryId = byName.get(key)!;
  }

  const fresh: Transaction[] = [];
  const splits: Split[] = [];
  const mergedIntoIds: string[] = [];
  const before: Transaction[] = [];
  await repo.transaction(async () => {
    for (const c of approved) {
      if (c.status === 'merge' && c.mergeWithId) {
        const t = await repo.transactions.get(c.mergeWithId);
        if (!t) continue;
        mergedIntoIds.push(t.id);
        before.push(t);
        // The notebook (spreadsheet or typed in) knows what the payment was for and my share of it;
        // the bank knows the reference and time. Keep the best of both.
        const notebookIncoming = input.parserId === 'legacy-sheet' && !t.sources.some((s) => s.kind === 'manual' || s.parser === 'legacy-sheet');
        await repo.transactions.put({
          ...t,
          ...(notebookIncoming
            ? {
                amountPaise: c.raw.amountPaise,
                categoryId: c.cls.type === 'expense' ? c.categoryId ?? t.categoryId : t.categoryId,
                item: c.item || t.item,
                place: c.cls.payee || t.place,
                note: c.raw.note ?? t.note,
                paymentMode: c.raw.paymentMode ?? t.paymentMode,
                needsReview: c.cls.type === 'expense' && !(c.categoryId ?? t.categoryId),
              }
            : { note: t.note || c.cls.note || '' }),
          sources: [...t.sources, { ...tag, ref: c.importRef }],
          upiRef: t.upiRef ?? c.cls.upiRef,
          time: t.time ?? c.raw.time,
          rawPayee: t.rawPayee ?? c.raw.rawPayee,
          bankNote: t.bankNote ?? (input.parserId === 'legacy-sheet' ? undefined : c.raw.description),
          updatedAt: now,
        });
        continue;
      }
      const isExpense = c.cls.type === 'expense' && !c.cls.excluded;
      const id = uid();
      let amountPaise = c.raw.amountPaise;
      let splitId: string | undefined;
      if (isExpense && c.splitWith?.length) {
        const shares = equalShares(c.raw.amountPaise, c.splitWith.length + 1);
        splitId = uid();
        amountPaise = shares[0];
        splits.push({ id: splitId, transactionId: id, totalPaise: c.raw.amountPaise, myShareP: shares[0], paidBy: 'me', shares: c.splitWith.map((personId, i) => ({ personId, sharePaise: shares[i + 1] })) });
      }
      fresh.push({
        id,
        splitId,
        date: c.raw.date,
        time: c.raw.time,
        type: c.cls.type,
        subtype: c.cls.subtype,
        amountPaise,
        categoryId: isExpense ? c.categoryId : null,
        item: c.item,
        place: c.cls.payee,
        paymentMode: c.raw.paymentMode ?? c.cls.paymentMode,
        note: c.cls.note ?? c.raw.note ?? '',
        importRef: c.importRef,
        upiRef: c.cls.upiRef,
        rawPayee: c.raw.rawPayee,
        bankNote: c.raw.description,
        balancePaise: c.raw.balancePaise,
        sources: [{ ...tag, ref: c.importRef }],
        batchId,
        excluded: c.cls.excluded,
        needsReview: isExpense && !c.categoryId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await repo.transactions.bulkPut(fresh);
    await repo.splits.bulkPut(splits);
  });

  for (const l of input.learn) await learnRule(l.payee, l.categoryId, undefined, 'learned');
  // A bank name that turned out to be a place from the notebook keeps that category from now on.
  const rules = await repo.rules.all();
  for (const c of approved) {
    if (c.status !== 'merge' || c.cls.type !== 'expense' || !c.categoryId || input.parserId === 'legacy-sheet') continue;
    const key = c.cls.payee.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (key && !rules.some((r) => r.matchText === key)) await learnRule(c.cls.payee, c.categoryId, c.item || undefined, 'learned');
  }

  const batch: ImportBatch = {
    id: batchId,
    source: input.sourceKind,
    parser: input.parserId,
    fileName: input.fileName,
    importedAt: now,
    counts: {
      found: input.candidates.length,
      added: fresh.length,
      duplicates: input.candidates.filter((c) => c.status === 'duplicate').length,
      merged: mergedIntoIds.length,
      needCategory: fresh.filter((t) => t.needsReview).length,
      unreadable: input.unreadable,
    },
    mergedIntoIds,
    before,
  };
  await repo.batches.put(batch);
  return batch;
}

/** Undo a whole import: delete what it added, strip its tag from what it merged into. */
export async function undoImport(batchId: string) {
  const batch = await repo.batches.get(batchId);
  if (!batch) return;
  await repo.transaction(async () => {
    const all = await repo.transactions.all();
    const added = all.filter((t) => t.batchId === batchId);
    await repo.transactions.bulkRemove(added.map((t) => t.id));
    await repo.splits.bulkRemove(added.map((t) => t.splitId).filter((x): x is string => Boolean(x)));
    for (const id of batch.mergedIntoIds) {
      const previous = batch.before?.find((x) => x.id === id);
      const t = all.find((x) => x.id === id);
      if (previous) await repo.transactions.put(previous);
      else if (t) await repo.transactions.put({ ...t, sources: t.sources.filter((s) => s.batchId !== batchId) });
    }
    await repo.batches.remove(batchId);
  });
}
