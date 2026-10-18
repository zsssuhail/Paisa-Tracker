/** All money is integer paise. All dates are ISO `YYYY-MM-DD` (IST). */
export type Paise = number;
export type ISODate = string;

export type TxType = 'expense' | 'income' | 'transfer';
/** Finer meaning for imported/typed rows. Drives labels and "not spending" logic. */
export type TxSubtype =
  | 'pocket-money'
  | 'family'
  | 'scholarship'
  | 'interest'
  | 'refund'
  | 'payback'
  | 'salary'
  | 'cash-withdrawal'
  | 'bank-charge'
  | 'settlement'
  | 'bucket'
  | 'verification';

export type PaymentMode = 'UPI' | 'Cash' | 'Card' | 'Net banking' | 'Other';
export const PAYMENT_MODES: PaymentMode[] = ['UPI', 'Cash', 'Card', 'Net banking', 'Other'];

export type SourceKind = 'manual' | 'googlepay' | 'bank' | 'csv' | 'paste' | 'recurring' | 'sample';

export interface SourceTag {
  kind: SourceKind;
  /** Parser id, e.g. `iob`, `googlepay-html`, `legacy-sheet`. */
  parser?: string;
  batchId?: string;
  ref?: string;
}

export interface Transaction {
  id: string;
  date: ISODate;
  time?: string;
  type: TxType;
  subtype?: TxSubtype;
  amountPaise: Paise;
  categoryId: string | null;
  item: string;
  place: string;
  paymentMode: PaymentMode;
  note: string;
  accountId?: string;
  splitId?: string;
  recurringId?: string;
  /** Stable identity of the source row (hash) — re-importing the same file adds nothing. */
  importRef?: string;
  upiRef?: string;
  rawPayee?: string;
  bankNote?: string;
  balancePaise?: Paise;
  sources: SourceTag[];
  batchId?: string;
  /** Ignored rows (mandate verification pairs) stay stored but never count. */
  excluded?: boolean;
  needsReview?: boolean;
  bigItem?: boolean;
  isSample?: boolean;
  photo?: Blob;
  createdAt: number;
  updatedAt: number;
}

export type Nature = 'need' | 'want';

export interface CategoryGroup {
  id: string;
  name: string;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  groupId: string;
  icon: string;
  /** Chart slot 1–8, see design/chartPalette.ts. */
  colour: number;
  nature: Nature;
  archived: boolean;
  order: number;
}

export type BudgetMode = 'simple' | 'zero';

export interface Allocation {
  targetType: 'category' | 'goal' | 'bucket';
  targetId: string;
  amountPaise: Paise;
  rollover: boolean;
}

export interface Budget {
  /** Period start date (respects month-start day). */
  id: ISODate;
  mode: BudgetMode;
  /** Created by sample data and untouched since; cleared with the sample. */
  isSample?: boolean;
  incomePaise: Paise;
  /** Simple mode: one total for the month. */
  totalLimitPaise: Paise;
  allocations: Allocation[];
}

export interface Goal {
  id: string;
  name: string;
  targetPaise: Paise;
  deadline?: ISODate;
  icon: string;
  monthlyAllocationPaise: Paise;
  isEmergency?: boolean;
  archived: boolean;
  /** Highest milestone (25/50/75/100) already celebrated. */
  celebrated: number;
  createdAt: number;
}

export type BucketRule = 'fixed' | 'percent' | 'leftover';

export interface Bucket {
  id: string;
  name: string;
  icon: string;
  rule: BucketRule;
  /** Paise for fixed, basis points (100 = 1%) for percent. */
  ruleValue: number;
  targetPaise?: Paise;
  archived: boolean;
  order: number;
  createdAt?: number;
}

export interface Contribution {
  id: string;
  potType: 'goal' | 'bucket';
  potId: string;
  date: ISODate;
  /** Negative to withdraw / move out. */
  amountPaise: Paise;
  source: 'manual' | 'auto' | 'roundup' | 'leftover' | 'move' | 'income-split';
  note?: string;
}

export interface Debt {
  id: string;
  name: string;
  direction: 'i-owe' | 'owed-to-me';
  totalPaise: Paise;
  payments: { date: ISODate; amountPaise: Paise }[];
  createdAt: number;
}

export interface Person {
  id: string;
  name: string;
  /** Normalised payee names seen in UPI rows, used to match paybacks. */
  aliases: string[];
}

export interface SplitShare {
  personId: string;
  sharePaise: Paise;
  settledByTransactionId?: string;
  settledAt?: ISODate;
}

export interface Split {
  id: string;
  transactionId: string;
  totalPaise: Paise;
  myShareP: Paise;
  /** `me` when I paid the bill; otherwise the person who paid (I owe them my share). */
  paidBy: 'me' | string;
  shares: SplitShare[];
}

export interface Rule {
  id: string;
  /** Normalised place text. */
  matchText: string;
  categoryId: string;
  item?: string;
  source: 'learned' | 'manual';
  hits: number;
  createdAt: number;
}

export interface ImportCounts {
  found: number;
  added: number;
  duplicates: number;
  merged: number;
  needCategory: number;
  unreadable: number;
}

export interface ImportBatch {
  id: string;
  source: SourceKind;
  parser: string;
  fileName: string;
  importedAt: number;
  counts: ImportCounts;
  /** Transactions this batch merged into (so undo can strip the source tag instead of deleting). */
  mergedIntoIds: string[];
  /** Merged transactions as they were before this import, so undo restores them exactly. */
  before?: Transaction[];
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface Recurring {
  id: string;
  name: string;
  amountPaise: Paise;
  categoryId: string | null;
  place: string;
  paymentMode: PaymentMode;
  frequency: Frequency;
  nextDue: ISODate;
  mode: 'auto' | 'remind';
  active: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: 'bank' | 'cash' | 'wallet';
  openingBalancePaise: Paise;
}

export interface ColumnMapping {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  reference?: number;
  balance?: number;
  /** For a single signed/typed amount column. */
  directionColumn?: number;
  dateFormat: 'DMY' | 'MDY' | 'YMD';
  /** The person chose the date order in the column mapper (otherwise it is inferred). */
  dateFormatConfirmed?: boolean;
  headerRow: number;
}

export interface CustomSource {
  id: string;
  name: string;
  /** Lower-cased joined header cells, used by detect(). */
  headerSignature: string;
  mapping: ColumnMapping;
  createdAt: number;
}

export interface TxFilter {
  range?: { from: ISODate; to: ISODate };
  categoryIds?: string[];
  place?: string;
  paymentModes?: PaymentMode[];
  minPaise?: Paise;
  maxPaise?: Paise;
  text?: string;
  types?: TxType[];
}

export interface SavedFilter {
  id: string;
  name: string;
  filter: TxFilter;
}

export type Focus = 'track' | 'budget' | 'save';

export interface Settings {
  id: 'app';
  name: string;
  currency: string;
  locale: string;
  theme: 'system' | 'light' | 'dark';
  monthStartDay: number;
  focus: Focus;
  budgetMode: BudgetMode;
  onboarded: boolean;
  pinHash?: string;
  roundUp: { enabled: boolean; bucketId?: string };
  sampleLoaded: boolean;
  defaultRollover: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  name: '',
  currency: 'INR',
  locale: 'en-IN',
  theme: 'system',
  monthStartDay: 1,
  focus: 'track',
  budgetMode: 'simple',
  onboarded: false,
  roundUp: { enabled: false },
  sampleLoaded: false,
  defaultRollover: false,
};
