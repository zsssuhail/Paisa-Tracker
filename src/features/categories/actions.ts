import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import type { Category } from '@/data/types';
import { DEFAULT_CATEGORIES, DEFAULT_GROUPS } from './defaults';

export async function ensureDefaultCategories() {
  const existing = await repo.categories.all();
  if (existing.length) return;
  await repo.groups.bulkPut(DEFAULT_GROUPS);
  await repo.categories.bulkPut(DEFAULT_CATEGORIES);
}

/** Two taps: name it, done. Picks the least-used colour slot so it stays distinguishable. */
export async function addCategory(name: string, groupId = 'g-lifestyle'): Promise<string> {
  const cats = await repo.categories.all();
  const usage = new Map<number, number>();
  for (let s = 1; s <= 8; s++) usage.set(s, 0);
  for (const c of cats) if (!c.archived) usage.set(c.colour, (usage.get(c.colour) ?? 0) + 1);
  const colour = [...usage.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
  const id = uid();
  await repo.categories.put({
    id,
    name,
    groupId,
    icon: 'sparkles',
    colour,
    nature: 'want',
    archived: false,
    order: Math.max(0, ...cats.map((c) => c.order)) + 1,
  });
  return id;
}

export async function updateCategory(id: string, patch: Partial<Category>) {
  await repo.categories.update(id, patch);
}

/** Move every transaction, rule and budget line from `fromId` into `intoId`, then archive `fromId`. */
export async function mergeCategories(fromId: string, intoId: string) {
  await repo.transaction(async () => {
    const txs = (await repo.transactions.all()).filter((t) => t.categoryId === fromId);
    await repo.transactions.bulkPut(txs.map((t) => ({ ...t, categoryId: intoId, updatedAt: Date.now() })));
    const rules = (await repo.rules.all()).filter((r) => r.categoryId === fromId);
    await repo.rules.bulkPut(rules.map((r) => ({ ...r, categoryId: intoId })));
    const budgets = await repo.budgets.all();
    for (const b of budgets) {
      if (!b.allocations.some((a) => a.targetId === fromId)) continue;
      const merged = new Map<string, (typeof b.allocations)[number]>();
      for (const a of b.allocations) {
        const key = `${a.targetType}:${a.targetId === fromId ? intoId : a.targetId}`;
        const prev = merged.get(key);
        merged.set(key, prev ? { ...prev, amountPaise: prev.amountPaise + a.amountPaise } : { ...a, targetId: a.targetId === fromId ? intoId : a.targetId });
      }
      await repo.budgets.put({ ...b, allocations: [...merged.values()] });
    }
    await repo.categories.update(fromId, { archived: true });
  });
}

export async function addGroup(name: string) {
  const groups = await repo.groups.all();
  const id = uid();
  await repo.groups.put({ id, name, order: groups.length });
  return id;
}
