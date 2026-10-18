import { create } from 'zustand';
import { repo } from './repo';
import { configureMoney } from './money';
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
import { DEFAULT_SETTINGS } from './types';

export interface DataState {
  ready: boolean;
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  budgets: Budget[];
  goals: Goal[];
  buckets: Bucket[];
  contributions: Contribution[];
  debts: Debt[];
  people: Person[];
  splits: Split[];
  rules: Rule[];
  batches: ImportBatch[];
  recurring: Recurring[];
  accounts: Account[];
  customSources: CustomSource[];
  savedFilters: SavedFilter[];
  settings: Settings;
}

/**
 * Live mirror of the local database. Every repo collection is observed once;
 * screens select the slices they need and derive aggregates with memoised selectors.
 */
export const useData = create<DataState>(() => ({
  ready: false,
  transactions: [],
  categories: [],
  groups: [],
  budgets: [],
  goals: [],
  buckets: [],
  contributions: [],
  debts: [],
  people: [],
  splits: [],
  rules: [],
  batches: [],
  recurring: [],
  accounts: [],
  customSources: [],
  savedFilters: [],
  settings: DEFAULT_SETTINGS,
}));

const KEYS = [
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
] as const;

let started = false;

export function startDataSync(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  const pending = new Set<string>([...KEYS, 'settings']);
  return new Promise((resolve) => {
    const done = (key: string) => {
      if (pending.delete(key) && pending.size === 0) {
        useData.setState({ ready: true });
        resolve();
      }
    };
    for (const key of KEYS) {
      (repo[key] as { observe: (cb: (items: unknown[]) => void) => void }).observe((items) => {
        useData.setState({ [key]: items } as Partial<DataState>);
        done(key);
      });
    }
    repo.settings.observe((rows) => {
      const settings = { ...DEFAULT_SETTINGS, ...rows[0] };
      configureMoney(settings);
      useData.setState({ settings });
      done('settings');
    });
  });
}
