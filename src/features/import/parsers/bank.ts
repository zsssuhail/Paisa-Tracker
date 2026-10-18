import type { ColumnMapping } from '@/data/types';
import { pdfLinesToTable } from '../pdf/toTable';
import { detectColumns, readTable } from '../table';
import type { ImportFile, Parser, ParseResult } from '../types';
import { parseLooseDate } from '../dates';

/** The file as rows of cells, whatever its format. */
export function tableOf(file: ImportFile): string[][] | null {
  if (file.table) return file.table;
  if (file.lines) return pdfLinesToTable(file.lines);
  return null;
}

const BANKS: { name: string; re: RegExp }[] = [
  { name: 'Indian Overseas Bank', re: /indian overseas bank|\bIOBA\d|\bIOB\b/i },
  { name: 'State Bank of India', re: /state bank of india|\bSBIN\d|\bSBI\b/i },
  { name: 'HDFC Bank', re: /hdfc bank|\bHDFC\d/i },
  { name: 'ICICI Bank', re: /icici bank|\bICIC\d/i },
  { name: 'Axis Bank', re: /axis bank|\bUTIB\d/i },
  { name: 'Canara Bank', re: /canara bank|\bCNRB\d/i },
  { name: 'Kotak Mahindra Bank', re: /kotak mahindra|\bKKBK\d/i },
];

export function bankNameOf(text: string): string | undefined {
  return BANKS.find((b) => b.re.test(text))?.name;
}

/** Last four digits of the account number, never the whole number. */
export function accountOf(text: string): string | undefined {
  const m = /(?:a\/?c|account)\s*(?:no\.?|number|#)?\s*[:.-]?\s*([X*\d][X*\d -]{5,})/i.exec(text);
  const digits = m?.[1].replace(/[^\dX*]/gi, '');
  return digits && /\d{4}$/.test(digits) ? `••${digits.slice(-4)}` : undefined;
}

export function holderOf(text: string): string | undefined {
  const m = /(?:account holder(?:'s)? name|customer name|account name|name of (?:the )?(?:account holder|customer))\s*[:.-]?\s*([A-Za-z][A-Za-z .']{2,40}?)\s*(?:,|\n|\s{2,}|branch|address|$)/i.exec(text);
  return m?.[1].trim() || undefined;
}

export function periodOf(text: string): ParseResult['period'] {
  const d = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ]\d{2,4})`;
  const m = new RegExp(String.raw`(?:period|statement)[^\n]{0,40}?${d}\s*(?:to|-|–|till)\s*${d}`, 'i').exec(text);
  const from = m && parseLooseDate(m[1]);
  const to = m && parseLooseDate(m[2]);
  return from && to ? { from, to } : undefined;
}

/** The parts of a statement that are not payments, named so the review screen can say what was set aside. */
function ignoredParts(file: ImportFile, table: string[][], mapping: Partial<ColumnMapping>): string[] {
  const t = file.text;
  const out: string[] = [];
  if (/customer details|customer id|branch address|ifs ?c|address of customer|e-?mail/i.test(t)) out.push('Customer and branch details');
  const header = (table[mapping.headerRow ?? 0] ?? []).join(' ').toLowerCase();
  if (/value/.test(header)) out.push('Value dates (same as the transaction date)');
  if (mapping.reference != null) out.push('Bank reference numbers (kept only to spot duplicates)');
  if (/transaction type|txn type/.test(header)) out.push('Transaction type column');
  if (/total|effective available balance|closing balance/i.test(t)) out.push('Statement totals and closing balance');
  if (file.kind === 'pdf') out.push('Page numbers and repeated headings');
  return out;
}

/**
 * Statement headers print "Label : value" pairs whose baselines rarely match exactly, so a value can
 * land on a neighbouring line. Pair each label with the closest text to its right instead.
 */
export function labelledValue(file: ImportFile, label: RegExp): string | undefined {
  if (!file.lines) return undefined;
  const cells = file.lines.flatMap((l) => l.cells.map((c) => ({ ...c, y: l.y, page: l.page })));
  for (const c of cells) {
    const m = new RegExp(String.raw`^\s*(?:${label.source})\s*:?\s*(.*)$`, 'i').exec(c.text);
    if (!m) continue;
    const inline = m[1].replace(/^:\s*/, '').trim();
    if (inline) return inline;
    const value = cells
      .filter((v) => v.page === c.page && v.x > c.x + c.width - 1 && Math.abs(v.y - c.y) <= 4)
      .sort((a, b) => Math.abs(a.y - c.y) * 20 + (a.x - c.x) - (Math.abs(b.y - c.y) * 20 + (b.x - c.x)))[0];
    if (value) return value.text.replace(/^:\s*/, '').trim();
  }
  return undefined;
}

function headerFacts(file: ImportFile) {
  const acct = labelledValue(file, /a\/?c(?:count)? ?(?:no\.?|number)/);
  const holder = labelledValue(file, /account holder(?:'s)? name|customer name|account name|name/);
  return {
    account: (acct && accountOf(`Account No ${acct}`)) ?? accountOf(file.text),
    holderName: holder?.replace(/[,;].*$/, '').trim() || holderOf(file.text),
  };
}

function parseWith(file: ImportFile, mapping?: ColumnMapping): ParseResult {
  const table = tableOf(file);
  if (!table) return { rows: [], unreadable: [{ text: file.name, reason: 'No table found in this file' }], skipped: 0 };
  const found = mapping ? { mapping } : detectColumns(table);
  if (!found) return { rows: [], unreadable: [{ text: file.name, reason: 'Could not find the column headings' }], skipped: 0 };
  const result = readTable(table, found.mapping as ColumnMapping);
  return {
    ...result,
    bankName: bankNameOf(file.text),
    ...headerFacts(file),
    period: periodOf(file.text),
    ignored: ignoredParts(file, table, found.mapping),
  };
}

/**
 * IOB: Date | Particulars | Ref No. / Chq No | Debit | Credit | Balance, with UPI lines like
 * UPI/629038165565/DR/ANNATCHI FAMOU/YES/UPI that often wrap onto a second line in the PDF.
 */
export const iobParser: Parser = {
  id: 'iob',
  label: 'Indian Overseas Bank statement',
  source: 'bank',
  detect(file) {
    const table = tableOf(file);
    if (!table || !detectColumns(table)) return 0;
    if (/indian overseas bank|\bIOBA\d/i.test(file.text)) return 0.95;
    const header = detectColumns(table)!;
    const h = (table[header.headerRow] ?? []).join(' ').toLowerCase();
    return /particulars/.test(h) && /balance/.test(h) && /\bIOB\b/.test(file.text) ? 0.8 : 0;
  },
  parse: (file) => parseWith(file),
};

/** Any Indian bank that labels its columns (SBI, HDFC, ICICI, Axis, Canara, Kotak and more). */
export const genericBankParser: Parser = {
  id: 'bank',
  label: 'Bank statement',
  source: 'bank',
  detect(file) {
    const table = tableOf(file);
    if (!table) return 0;
    const header = detectColumns(table);
    if (!header) return 0;
    return bankNameOf(file.text) ? 0.75 : 0.55;
  },
  parse: (file) => parseWith(file),
};

export function parseWithMapping(file: ImportFile, mapping: ColumnMapping): ParseResult {
  return parseWith(file, mapping);
}
