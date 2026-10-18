import type { ColumnMapping, ISODate, Paise, PaymentMode, SourceKind, TxSubtype } from '@/data/types';

export type Direction = 'debit' | 'credit';

/** What every parser produces. Parsers never decide categories; the pipeline does. */
export interface RawTransaction {
  date: ISODate;
  time?: string;
  amountPaise: Paise;
  direction: Direction;
  /** The bank's own text, untouched. */
  description: string;
  /** Cleaned, title-cased payee/merchant. */
  payee: string;
  /** Payee before cleaning, for display and learning. */
  rawPayee?: string;
  reference?: string;
  upiRef?: string;
  balancePaise?: Paise;
  status?: 'success' | 'failed' | 'pending';
  account?: string;
  note?: string;
  /** Legacy-sheet rows already know these. */
  categoryName?: string;
  item?: string;
  paymentMode?: PaymentMode;
  /** The source said what kind of money in this is ("Friend paid back", "Father"). */
  subtypeHint?: TxSubtype;
  /** Position in the source, for stable identity and reconciliation order. */
  rowIndex: number;
}

export interface Unreadable {
  text: string;
  reason: string;
}

export interface ParseResult {
  rows: RawTransaction[];
  unreadable: Unreadable[];
  /** Skipped on purpose (failed / pending), reported in the summary. */
  skipped: number;
  account?: string;
  bankName?: string;
  /** Statement header details used to read the rows (never stored as transactions). */
  holderName?: string;
  period?: { from: ISODate; to: ISODate };
  /** What was in the file but isn't a payment, in plain words, for the review screen. */
  ignored?: string[];
}

/** A positioned run of text on a PDF line. */
export interface PdfCell {
  x: number;
  width: number;
  text: string;
}

export interface PdfLine {
  page: number;
  y: number;
  cells: PdfCell[];
  text: string;
}

export interface ImportFile {
  name: string;
  kind: 'pdf' | 'csv' | 'xlsx' | 'html' | 'json' | 'text';
  /** Raw text for html/json/text, joined line text for pdf. */
  text: string;
  /** Rows of cells for csv/xlsx. */
  table?: string[][];
  /** Positioned lines for pdf. */
  lines?: PdfLine[];
  /** Every sheet of a workbook; `table` is the one that looked most like payments. */
  sheets?: { name: string; table: string[][] }[];
}

export interface Parser {
  id: string;
  label: string;
  source: SourceKind;
  /** 0 = can't read this, 1 = certainly mine. */
  detect(file: ImportFile): number;
  parse(file: ImportFile): ParseResult;
}

export interface MappingRequest {
  table: string[][];
  suggested: Partial<ColumnMapping>;
}
