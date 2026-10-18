import Dexie, { type Table } from 'dexie';
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
} from './types';

export class PaisaDB extends Dexie {
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  groups!: Table<CategoryGroup, string>;
  budgets!: Table<Budget, string>;
  goals!: Table<Goal, string>;
  buckets!: Table<Bucket, string>;
  contributions!: Table<Contribution, string>;
  debts!: Table<Debt, string>;
  people!: Table<Person, string>;
  splits!: Table<Split, string>;
  rules!: Table<Rule, string>;
  batches!: Table<ImportBatch, string>;
  recurring!: Table<Recurring, string>;
  accounts!: Table<Account, string>;
  customSources!: Table<CustomSource, string>;
  savedFilters!: Table<SavedFilter, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'paisa') {
    super(name);
    this.version(1).stores({
      transactions: 'id, date, type, categoryId, place, batchId, importRef, upiRef, splitId, recurringId, isSample',
      categories: 'id, groupId, order',
      groups: 'id, order',
      budgets: 'id',
      goals: 'id',
      buckets: 'id, order',
      contributions: 'id, [potType+potId], date',
      debts: 'id',
      people: 'id',
      splits: 'id, transactionId',
      rules: 'id, &matchText',
      batches: 'id, importedAt',
      recurring: 'id, nextDue',
      accounts: 'id',
      customSources: 'id, headerSignature',
      savedFilters: 'id',
      settings: 'id',
    });
  }
}

export const db = new PaisaDB();

export const ALL_TABLES = [
  'transactions',
  'categories',
  'groups',
  'budgets',
  'goals',
  'buckets',
  'contributions',
  'debts',
  'people',
  'splits',
  'rules',
  'batches',
  'recurring',
  'accounts',
  'customSources',
  'savedFilters',
  'settings',
] as const;
export type TableName = (typeof ALL_TABLES)[number];

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
