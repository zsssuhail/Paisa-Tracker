import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { todayISO } from '@/data/dates';
import { normalisePlace } from '@/features/rules/engine';

export async function addPerson(name: string): Promise<string> {
  const existing = (await repo.people.all()).find((p) => normalisePlace(p.name) === normalisePlace(name));
  if (existing) return existing.id;
  const id = uid();
  await repo.people.put({ id, name, aliases: [normalisePlace(name)] });
  return id;
}

/** Mark one person's share of a split as settled, optionally by the payback transaction. */
export async function settleShare(splitId: string, personId: string, byTransactionId?: string, date = todayISO()) {
  const split = await repo.splits.get(splitId);
  if (!split) return;
  await repo.splits.put({
    ...split,
    shares: split.shares.map((s) => (s.personId === personId ? { ...s, settledByTransactionId: byTransactionId, settledAt: date } : s)),
  });
  // Learn the payee spelling seen on the payback so the next one auto-matches.
  if (byTransactionId) {
    const tx = await repo.transactions.get(byTransactionId);
    const person = await repo.people.get(personId);
    const alias = tx ? normalisePlace(tx.place) : '';
    if (person && alias && !person.aliases.includes(alias)) await repo.people.update(personId, { aliases: [...person.aliases, alias] });
    if (tx && tx.type === 'income' && tx.subtype !== 'payback') await repo.transactions.update(tx.id, { subtype: 'payback' });
  }
}

export async function unsettleShare(splitId: string, personId: string) {
  const split = await repo.splits.get(splitId);
  if (!split) return;
  await repo.splits.put({
    ...split,
    shares: split.shares.map((s) => (s.personId === personId ? { ...s, settledByTransactionId: undefined, settledAt: undefined } : s)),
  });
}
