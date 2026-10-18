/**
 * Repository layer. The UI talks only to these functions, never to Dexie directly,
 * so a sync backend (Supabase/Firebase) can be dropped in by re-implementing this file.
 */
import { liveQuery } from 'dexie';
import { ALL_TABLES, db, type TableName } from '../db';
import type {
  Account,
  Budget,
  Bucket,
  Category,
  CategoryGroup,
  Contribution,
  CustomSource,
  Debt,
  Goal,
  ImportBatch,
  Person,
  Recurring,
  Rule,
  SavedFilter,
  Settings,
  Split,
  Transaction,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';

export interface Collection<T extends { id: string }> {
  all(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  bulkPut(items: T[]): Promise<void>;
  update(id: string, patch: Partial<T>): Promise<void>;
  remove(id: string): Promise<void>;
  bulkRemove(ids: string[]): Promise<void>;
  /** Subscribe to the whole collection; returns an unsubscribe function. */
  observe(cb: (items: T[]) => void): () => void;
}

function collection<T extends { id: string }>(name: TableName): Collection<T> {
  const table = () => (db as any)[name] as import('dexie').Table<T, string>;
  return {
    all: () => table().toArray(),
    get: (id) => table().get(id),
    put: async (item) => {
      await table().put(item);
    },
    bulkPut: async (items) => {
      await table().bulkPut(items);
    },
    update: async (id, patch) => {
      await table().update(id, patch as any);
    },
    remove: (id) => table().delete(id),
    bulkRemove: (ids) => table().bulkDelete(ids),
    observe: (cb) => {
      const sub = liveQuery(() => table().toArray()).subscribe({ next: cb, error: console.error });
      return () => sub.unsubscribe();
    },
  };
}

export const repo = {
  transactions: collection<Transaction>('transactions'),
  categories: collection<Category>('categories'),
  groups: collection<CategoryGroup>('groups'),
  budgets: collection<Budget>('budgets'),
  goals: collection<Goal>('goals'),
  buckets: collection<Bucket>('buckets'),
  contributions: collection<Contribution>('contributions'),
  debts: collection<Debt>('debts'),
  people: collection<Person>('people'),
  splits: collection<Split>('splits'),
  rules: collection<Rule>('rules'),
  batches: collection<ImportBatch>('batches'),
  recurring: collection<Recurring>('recurring'),
  accounts: collection<Account>('accounts'),
  customSources: collection<CustomSource>('customSources'),
  savedFilters: collection<SavedFilter>('savedFilters'),
  settings: {
    ...collection<Settings>('settings'),
    async read(): Promise<Settings> {
      const s = await db.settings.get('app');
      return { ...DEFAULT_SETTINGS, ...s };
    },
    async patch(patch: Partial<Settings>) {
      const current = await repo.settings.read();
      await db.settings.put({ ...current, ...patch, id: 'app' });
    },
  },

  /** Run several writes atomically. */
  transaction<R>(fn: () => Promise<R>): Promise<R> {
    return db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), fn);
  },
};

export type Snapshot = { version: 1; exportedAt: string; app: 'paisa'; data: Record<TableName, unknown[]> };

/** Everything as one JSON-able object (photos are dropped; they are device-only). */
export async function exportSnapshot(): Promise<Snapshot> {
  const data = {} as Record<TableName, unknown[]>;
  for (const name of ALL_TABLES) {
    const rows = await db.table(name).toArray();
    data[name] =
      name === 'transactions'
        ? rows.map(({ photo: _photo, ...rest }: Transaction) => rest)
        : rows;
  }
  return { version: 1, exportedAt: new Date().toISOString(), app: 'paisa', data };
}

export async function importSnapshot(snapshot: Snapshot): Promise<void> {
  if (snapshot?.app !== 'paisa' || !snapshot.data) throw new Error('This file is not a Paisa backup.');
  await db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), async () => {
    for (const name of ALL_TABLES) {
      await db.table(name).clear();
      const rows = snapshot.data[name];
      if (Array.isArray(rows) && rows.length) await db.table(name).bulkPut(rows);
    }
  });
}

export async function wipeEverything(): Promise<void> {
  await db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), async () => {
    for (const name of ALL_TABLES) await db.table(name).clear();
  });
}
