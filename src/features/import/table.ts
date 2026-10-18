import type { ColumnMapping } from '@/data/types';
import { parseMoney } from '@/data/money';
import { inferDateOrder, parseLooseDate, parseLooseTime } from './dates';
import type { Direction, ParseResult, RawTransaction, Unreadable } from './types';
import { cleanPayee, joinWrapped, parseNarration, squash } from './upi';

const SYN = {
  date: [/^(?:txn |tran |transaction |value |posting |post )?date$/, /^date\b/, /\bdate\b/],
  description: [/particulars/, /narration/, /description/, /remarks/, /transaction details/, /^details$/, /transaction remarks/],
  debit: [/^debit/, /withdrawal/, /^dr\b/, /debit amount/, /^withdrawals?/, /^paid out/],
  credit: [/^credit/, /deposit/, /^cr\b/, /credit amount/, /^deposits?/, /^paid in/],
  amount: [/^amount\b/, /^txn amount/, /^transaction amount/, /amount \(/],
  balance: [/balance/],
  reference: [/ref/, /chq/, /cheque/, /utr/, /transaction id/],
  direction: [/^dr ?\/ ?cr$/, /^type$/, /^cr\/dr$/, /debit\/credit/],
};

function match(cell: string, res: RegExp[]) {
  const c = cell.toLowerCase().replace(/\s+/g, ' ').trim();
  return res.some((r) => r.test(c));
}

/** Find the header row and map columns by their names. */
export function detectColumns(table: string[][], maxScan = 40): { headerRow: number; mapping: Partial<ColumnMapping> } | null {
  for (let r = 0; r < Math.min(table.length, maxScan); r++) {
    const row = table[r].map((c) => String(c ?? ''));
    const find = (key: keyof typeof SYN, exclude: number[] = []) => row.findIndex((c, i) => !exclude.includes(i) && c.trim() && match(c, SYN[key]));
    const date = find('date');
    const description = find('description');
    if (date < 0 || description < 0) continue;
    const debit = find('debit');
    const credit = find('credit');
    const amount = debit < 0 || credit < 0 ? find('amount') : -1;
    const balance = find('balance');
    const reference = find('reference', [date, description, debit, credit, balance]);
    const direction = find('direction', [date, description, debit, credit, balance, reference]);
    if ((debit < 0 || credit < 0) && amount < 0) continue;
    const mapping: Partial<ColumnMapping> = { date, description, headerRow: r, dateFormat: 'DMY' };
    if (debit >= 0 && credit >= 0) Object.assign(mapping, { debit, credit });
    else mapping.amount = amount;
    if (balance >= 0) mapping.balance = balance;
    if (reference >= 0) mapping.reference = reference;
    if (direction >= 0) mapping.directionColumn = direction;
    return { headerRow: r, mapping };
  }
  return null;
}

function amountOf(cell: string | undefined): number | null {
  if (cell == null) return null;
  const s = String(cell).trim();
  if (!s || s === '-' || s === '0' || s === '0.00') return null;
  return parseMoney(s);
}

/**
 * Read a table with a known column mapping. Rows without a date continue the previous
 * row's description (wrapped narrations); anything else unreadable is kept, not dropped.
 */
export function readTable(table: string[][], m: ColumnMapping): ParseResult {
  const rows: RawTransaction[] = [];
  const unreadable: Unreadable[] = [];
  let last: RawTransaction | null = null;
  // Auto-detected layouts guess the day/month order from the whole column; a saved mapping says it.
  const dateOrder = m.dateFormat === 'DMY' && !m.dateFormatConfirmed ? inferDateOrder(table.slice(m.headerRow + 1).map((r) => String(r[m.date] ?? ''))) : m.dateFormat;
  // In a single signed amount column, negatives are money out and positives money in.
  const signed = m.amount != null && table.slice(m.headerRow + 1).some((row) => (amountOf(String(row[m.amount!] ?? '')) ?? 0) < 0);

  for (let r = m.headerRow + 1; r < table.length; r++) {
    const row = table[r].map((c) => (c == null ? '' : String(c)));
    if (row.every((c) => !c.trim())) continue;
    const dateCell = row[m.date] ?? '';
    const date = parseLooseDate(dateCell, dateOrder);
    const desc = squash(row[m.description] ?? '');

    if (!date) {
      // Continuation of a wrapped description, or a footer / opening-balance line.
      const hasMoney = [m.debit, m.credit, m.amount].some((i) => i != null && amountOf(row[i]) != null);
      if (last && desc && !hasMoney && !/opening|closing|total|balance b\/f|brought forward|carried/i.test(desc)) {
        last.description = joinWrapped(last.description, desc);
        continue;
      }
      if (desc && hasMoney && !/opening|closing|total/i.test(row.join(' '))) unreadable.push({ text: row.join(' | '), reason: "Couldn't read the date" });
      continue;
    }

    let amount: number | null = null;
    let direction: Direction = 'debit';
    if (m.debit != null && m.credit != null) {
      const dr = amountOf(row[m.debit]);
      const cr = amountOf(row[m.credit]);
      if (dr != null && dr !== 0) {
        amount = Math.abs(dr);
        direction = 'debit';
      } else if (cr != null && cr !== 0) {
        amount = Math.abs(cr);
        direction = 'credit';
      }
    } else if (m.amount != null) {
      const raw = row[m.amount] ?? '';
      const a = amountOf(raw);
      if (a != null) {
        amount = Math.abs(a);
        const marker = `${m.directionColumn != null ? row[m.directionColumn] : ''} ${raw}`.toUpperCase();
        if (/\bCR\b|CREDIT|^\s*C\s/.test(marker)) direction = 'credit';
        else if (/\bDR\b|DEBIT|^\s*D\s/.test(marker)) direction = 'debit';
        else direction = (signed && a > 0) || raw.trim().startsWith('+') ? 'credit' : 'debit';
      }
    }
    if (amount == null || amount === 0) {
      if (!/opening|closing|balance b\/f|brought forward|carried forward/i.test(desc)) unreadable.push({ text: row.join(' | '), reason: 'No amount found' });
      continue;
    }

    const balanceCell = m.balance != null ? row[m.balance] : undefined;
    const balance = balanceCell ? parseMoney(balanceCell.replace(/\s*(?:cr|dr)\.?$/i, '')) : null;
    const ref = m.reference != null ? squash(row[m.reference] ?? '') : '';
    last = {
      date,
      time: parseLooseTime(dateCell.slice(10)),
      amountPaise: amount,
      direction,
      description: desc,
      payee: '',
      reference: ref || undefined,
      balancePaise: balance ?? undefined,
      rowIndex: r,
    };
    rows.push(last);
  }

  // Payee cleaning happens after wrapped lines are joined.
  for (const row of rows) {
    const parsed = parseNarration(row.description);
    row.payee = parsed?.payee || cleanPayee(row.description);
    row.rawPayee = parsed?.rawPayee ?? row.description;
    row.upiRef = parsed?.upiRef ?? (/^\d{12}$/.test(row.reference ?? '') ? row.reference : undefined);
    row.reference = row.reference ?? parsed?.transferRef;
    row.note = parsed?.note;
    if (parsed?.direction) row.direction = parsed.direction;
  }
  return { rows, unreadable, skipped: 0 };
}

/** Header signature for remembering custom mappings. */
export function headerSignature(table: string[][], headerRow: number): string {
  return (table[headerRow] ?? []).map((c) => String(c ?? '').toLowerCase().trim()).filter(Boolean).join('|');
}
