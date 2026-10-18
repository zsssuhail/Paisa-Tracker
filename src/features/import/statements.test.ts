/**
 * Regression tests built from the layout of real statements (Indian Overseas Bank PDF, an Apple Numbers
 * expense tracker exported to PDF and Excel, a Google Takeout CSV). Names and numbers are invented.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { PdfLine } from './types';
import { groupLines } from './pdf/extract';
import { pdfLinesToTable } from './pdf/toTable';
import { iobParser, labelledValue } from './parsers/bank';
import { legacySheetParser } from './parsers/others';
import { googlePayParser } from './parsers/googlePay';
import { fromCsv, fromWorkbook, sniff } from './load';
import { meaningfulNote, parseNarration } from './upi';
import { canonicalPayee } from './payees';
import { reconcile } from './pipeline/reconcile';
import { amountsIn, buildCandidates, type BuildContext } from './pipeline/build';
import { classify } from './classify';
import { DEFAULT_CATEGORIES } from '@/features/categories/defaults';
import type { Transaction } from '@/data/types';

/** One positioned text run; width approximates a 9pt font. */
type Run = [x: number, text: string];
const line = (page: number, y: number, runs: Run[]): PdfLine => {
  const cells = runs.map(([x, text]) => ({ x, width: text.length * 4.6, text }));
  return { page, y, cells, text: cells.map((c) => c.text).join(' ') };
};

/** IOB statement: details above a three-line heading, then three printed lines per transaction, newest first. */
function iobStatement(): PdfLine[] {
  const L: PdfLine[] = [
    line(1, 758, [[284, 'Report Generation Date & Time : 17-10-2026 15:26:42']]),
    line(1, 740, [[70, 'STATEMENT OF THE ACCOUNT FOR THE PERIOD OF : 2026-10-01 to 2026-10-17']]),
    line(1, 708, [[46, 'CUSTOMER DETAILS']]),
    // Values sit a couple of points off their labels, as in the real file.
    line(1, 677, [[295, 'R.S.NO.1, MAIN ROAD,']]),
    line(1, 674, [[49, 'Account No']]),
    line(1, 676.2, [[169, ': 000100000012345']]),
    line(1, 661.6, [[49, 'Account Holder Name']]),
    line(1, 664.2, [[169, ': ARUN KUMAR ,']]),
    line(1, 628.9, [[49, 'IFS Code']]),
    line(1, 626.9, [[169, ': IOBA0000123']]),
    line(1, 558, [[50, 'Date(Value'], [283, 'Ref No.'], [333, 'Transaction']]),
    line(1, 555, [[168, 'Particulars'], [398, 'Debit(Rs)'], [456, 'Credit(Rs)'], [507, 'Balance(Rs)']]),
    line(1, 549, [[63, 'Date)'], [275, '/Cheque No'], [346, 'Type']]),
  ];
  const tx = (y: number, date: string, top: string, ref: string, debit: string, credit: string, balance: string, bottom: string) => [
    line(1, y, [[45, date], [112, top]]),
    line(1, y - 4, [[278, ref], [344, 'Transfer'], [415, debit], [474, credit], [522, balance]]),
    line(1, y - 9, [[45, `(${date})`], [112, bottom]]),
  ];
  L.push(
    ...tx(530, '17-Oct-26', 'UPI/629038165565/DR/ANNATCHI', 'S74301559', '120.00', '-', '8,993.91', 'FAMOU/YES/UPI'),
    ...tx(507, '17-Oct-26', 'UPI/629032644176/DR/CSA Automobile', 'S71962537', '234.52', '-', '9,113.91', '/YES/UPI'),
    ...tx(484, '16-Oct-26', 'UPI/628982348642/CR/ RAVI S', 'S59424806', '-', '235.00', '9,348.43', '/IOB/dinner'),
    ...tx(461, '15-Oct-26', 'UPI/628834348055/DR/ Blinkit/HDF', 'S18109651', '181.00', '-', '9,113.43', '/UPIIntent'),
    ...tx(438, '15-Oct-26', 'UPI/954462138770/CR/', 'S18073639', '-', '200.00', '9,294.43', 'KAVIN D/BAR/Payment f'),
    ...tx(415, '14-Oct-26', 'UPI/628848830997/DR/Flipkart Payme', 'S26517043', '108.00', '-', '9,094.43', '/YES/UPI'),
    ...tx(392, '13-Oct-26', 'UPI/110247305399/DR/MADURAI', 'S71106703', '607.90', '-', '9,202.43', 'MEDICA/ICI/collect-p'),
    ...tx(369, '12-Oct-26', 'UPI/534387507303/DR/ ARUN KUMAR', 'S89764509', '100.00', '-', '9,810.33', '/IOB/LiteEnable'),
  );
  // A row printed on one line with the dates on their own lines (seen in longer statements).
  L.push(line(1, 346, [[45, '11-Oct-26']]));
  L.push(line(1, 342, [[112, 'UPI/629051376366/CR/ Swathi S/SBI/UPI'], [278, 'S67691640'], [344, 'Transfer'], [437, '-'], [479, '20.00'], [526, '9,910.33']]));
  L.push(line(1, 337, [[45, '(11-Oct-26)']]));
  // An IMPS credit from home.
  L.push(...tx(323, '10-Oct-26', 'IMPS/619917580047/ANBU /SBIN', 'S71000782', '-', '5,000.00', '9,890.33', '/XXXXXX5972/Bill'));
  L.push(line(1, 15, [[277, 'Page 1 of 2']]));
  // Page 2 continues without a heading; then totals and the footer.
  L.push(...[line(2, 771, [[45, '09-Oct-26'], [112, 'UPI/626152432417/DR/ IPPB']]), line(2, 767, [[278, 'S22300281'], [344, 'Transfer'], [420, '55.00'], [496, '-'], [526, '4,890.33']]), line(2, 762, [[45, '(09-Oct-26)'], [112, 'MERCHANT/IPO/UPI']])]);
  L.push(line(2, 740, [[397, '1,405.42'], [456, '5,455.00']]));
  L.push(line(2, 704, [[44, 'Effective available balance as on 17-10-2026 15:26:42 is INR 8,993.91']]));
  L.push(line(2, 673, [[44, '**This is a computer generated statement and does not require a signature.']]));
  L.push(line(2, 15, [[273, 'Page 2 of 2']]));
  return L;
}

const iobFile = () => {
  const lines = iobStatement();
  return { name: 'AccountStatement_17102026.pdf', kind: 'pdf' as const, lines, text: lines.map((l) => l.text).join('\n') };
};

describe('IOB statement PDF (three printed lines per transaction)', () => {
  it('finds every transaction and nothing else', () => {
    const r = iobParser.parse(iobFile());
    expect(r.unreadable).toEqual([]);
    expect(r.rows).toHaveLength(11);
    expect(iobParser.detect(iobFile())).toBeGreaterThan(0.9);
  });

  it('rebuilds the split heading into columns', () => {
    const t = pdfLinesToTable(iobStatement())!;
    expect(t[0]).toEqual(['Date(Value Date)', 'Particulars', 'Ref No. /Cheque No', 'Transaction Type', 'Debit(Rs)', 'Credit(Rs)', 'Balance(Rs)']);
  });

  it('keeps the core of each line: date, payee, amount, direction, UPI ref, balance, real notes', () => {
    const [first, csa, ravi, blinkit, kavin, flipkart, medical] = iobParser.parse(iobFile()).rows;
    expect(first).toMatchObject({ date: '2026-10-17', amountPaise: 12_000, direction: 'debit', payee: 'Annatchi Famou', upiRef: '629038165565', balancePaise: 899_391 });
    expect(csa).toMatchObject({ amountPaise: 23_452, payee: 'CSA Automobile' });
    expect(ravi).toMatchObject({ direction: 'credit', payee: 'Ravi S', note: 'dinner' });
    // App tags are noise: UPIIntent, "Payment f(rom PhonePe)", collect-pay.
    expect(blinkit.note).toBeUndefined();
    expect(kavin).toMatchObject({ payee: 'Kavin D', note: undefined });
    expect(flipkart.payee).toBe('Flipkart Payme');
    expect(medical).toMatchObject({ payee: 'Madurai Medica', note: undefined });
  });

  it('reads the header facts it needs, and only those', () => {
    const r = iobParser.parse(iobFile());
    expect(r).toMatchObject({ bankName: 'Indian Overseas Bank', account: '••2345', holderName: 'ARUN KUMAR', period: { from: '2026-10-01', to: '2026-10-17' } });
    expect(r.ignored).toEqual(expect.arrayContaining(['Customer and branch details', 'Value dates (same as the transaction date)', 'Statement totals and closing balance']));
    expect(labelledValue(iobFile(), /account no/)).toBe('000100000012345');
  });

  it('reads IMPS transfers: name and note kept, reference / IFSC / masked account dropped', () => {
    const imps = iobParser.parse(iobFile()).rows.find((r) => r.description.startsWith('IMPS'))!;
    expect(imps).toMatchObject({ payee: 'Anbu', note: 'Bill', direction: 'credit', reference: 'S71000782' });
    expect(parseNarration('IMPS/619917580047/ANBU /SBIN/XXXXXX5972/Bill')).toMatchObject({ transferRef: '619917580047', payee: 'Anbu' });
  });

  it('newest-first statements still reconcile', () => {
    const rec = reconcile(iobParser.parse(iobFile()).rows)!;
    expect(rec.gaps).toEqual([]);
    expect(rec.balanced).toBe(true);
  });

  it('money to my own name or UPI Lite is a transfer, not spending', () => {
    const rows = iobParser.parse(iobFile()).rows;
    const lite = rows.find((r) => r.upiRef === '534387507303')!;
    expect(classify(lite, { holderName: 'ARUN KUMAR' }).type).toBe('transfer');
    const big = rows.find((r) => r.description.startsWith('IMPS'))!;
    expect(classify(big).subtype).toBe('family');
  });
});

describe('narration noise', () => {
  it.each(['UPI', 'UPIIntent', 'UPI Inten', 'na', 'collect-p', 'StaticQR', 'LiteEnable', 'Payment f', 'Payment from Ph', 'Sent using Paytm U', '629038165565'])('drops "%s"', (n) => {
    expect(meaningfulNote(n, 'Some Shop')).toBeUndefined();
  });
  it('keeps what a person wrote, unless it only repeats the payee', () => {
    expect(meaningfulNote('dinner', 'Ravi S')).toBe('dinner');
    expect(meaningfulNote('Bill', 'Anbu')).toBe('Bill');
    expect(meaningfulNote('Zomato Pa', 'Zomato Limited')).toBeUndefined();
  });
});

describe('payee names cut short by the bank', () => {
  it('recovers brands and drops company suffixes', () => {
    expect(canonicalPayee('Flipkart Payme', [])).toBe('Flipkart');
    expect(canonicalPayee('Zepto Marketpl', [])).toBe('Zepto');
    expect(canonicalPayee('Redbus India P', [])).toBe('Redbus');
    expect(canonicalPayee('Lenskart Solut', [])).toBe('Lenskart');
    expect(canonicalPayee('Some Shop India P', [])).toBe('Some Shop');
  });
  it('completes a cut-off name from places already in the notebook', () => {
    expect(canonicalPayee('Sugarcane juic', ['Sugarcane juice stall'])).toBe('Sugarcane juice stall');
    expect(canonicalPayee('CSA Automobile', ['CSA Automobile (petrol bunk)'])).toBe('CSA Automobile (petrol bunk)');
  });
  it('keeps initials', () => {
    expect(canonicalPayee('Shreenidhi R M', [])).toBe('Shreenidhi R M');
  });
});

/** Apple Numbers prints a wide table as vertical strips of pages, and some ligatures as stray glyphs. */
function numbersExportPdf(): PdfLine[] {
  const raw = (page: number, y: number, items: [number, string][]) =>
    groupLines(
      items.map(([x, text]) => ({ x, y, width: text.length * 4.6, text })),
      page,
    );
  // Ligature glyphs butt into the letters around them: "Sta" "7" "onery" = Stationery.
  const glyphs = (page: number, y: number, x: number, parts: string[]) => {
    let at = x;
    return raw(
      page,
      y,
      parts.map((p) => {
        const run: [number, string] = [at, p];
        at += p.length * 4.6;
        return run;
      }),
    )[0].cells[0];
  };
  const row = (page: number, y: number, cells: PdfLine['cells']): PdfLine => ({ page, y, cells, text: cells.map((c) => c.text).join(' ') });
  return [
    ...raw(1, 756, [[81, 'Date'], [176, 'Category'], [317, 'Item / Description']]),
    row(1, 739, [{ x: 74, width: 55, text: '01-Oct-2026' }, { x: 135, width: 80, text: 'Travel & Transport' }, { x: 267, width: 30, text: 'Petrol' }]),
    row(1, 724, [{ x: 74, width: 55, text: '01-Oct-2026' }, glyphs(1, 724, 135, ['Sta', '7', 'onery & Books']), { x: 267, width: 70, text: 'Xerox / printouts' }]),
    row(1, 709, [{ x: 74, width: 55, text: '02-Oct-2026' }, glyphs(1, 709, 135, ['Ea', '7', 'ng Out']), glyphs(1, 709, 267, ['Rose milk a', 'G', 'er prayer'])]),
    ...raw(2, 44, [[294, '2']]),
    ...raw(3, 756, [[104, 'Where (shop / app)'], [255, 'Payment Mode'], [349, 'Amount ('], [388, '₹'], [394, ')']]),
    row(3, 739, [{ x: 59, width: 60, text: 'CSA Automobile' }, { x: 250, width: 15, text: 'UPI' }, { x: 396, width: 18, text: '₹50' }]),
    row(3, 724, [{ x: 59, width: 60, text: 'Penguin Xerox' }, { x: 250, width: 15, text: 'UPI' }, { x: 396, width: 18, text: '₹99' }]),
    row(3, 709, [{ x: 59, width: 60, text: 'Shri Karpaga' }, { x: 250, width: 15, text: 'UPI' }, { x: 396, width: 18, text: '₹50' }]),
    ...raw(4, 756, [[132, 'Notes']]),
    row(4, 709, [{ x: 59, width: 60, text: 'After prayer' }]),
  ];
}

describe('spreadsheet exported to PDF (Apple Numbers)', () => {
  it('repairs ligature glyphs only where they sit inside a word', () => {
    const cells = groupLines([{ x: 0, y: 0, width: 13.8, text: 'Sta' }, { x: 13.8, y: 0, width: 4.6, text: '7' }, { x: 18.4, y: 0, width: 60, text: 'onery' }], 1)[0].cells;
    expect(cells[0].text).toBe('Stationery');
    // A real "7" with space around it stays.
    expect(groupLines([{ x: 0, y: 0, width: 20, text: 'Room' }, { x: 26, y: 0, width: 4.6, text: '7' }], 1)[0].text).toBe('Room 7');
  });

  it('stitches the column strips back together and reads the sheet', () => {
    const lines = numbersExportPdf();
    const file = { name: 'Expense_Tracker.pdf', kind: 'pdf' as const, lines, text: lines.map((l) => l.text).join('\n') };
    expect(legacySheetParser.detect(file)).toBeGreaterThan(0.9);
    const r = legacySheetParser.parse(file);
    expect(r.rows.map((x) => [x.date, x.categoryName, x.item, x.payee, x.amountPaise, x.note])).toEqual([
      ['2026-10-01', 'Travel & Transport', 'Petrol', 'CSA Automobile', 5_000, undefined],
      ['2026-10-01', 'Stationery & Books', 'Xerox / printouts', 'Penguin Xerox', 9_900, undefined],
      ['2026-10-02', 'Eating Out', 'Rose milk after prayer', 'Shri Karpaga', 5_000, 'After prayer'],
    ]);
  });
});

describe('workbooks and files with odd names', () => {
  const workbook = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['This document was exported from Numbers.'], ['Numbers Sheet Name', 'Excel Worksheet Name']]), 'Export Summary');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Category', 'Item / Description', 'Where (shop / app)', 'Payment Mode', 'Amount (₹)', 'Notes'],
        ['16-Oct-2026', 'Eating Out', 'Group dinner', 'Frenza Mandi', 'UPI', '₹223', 'Paid ₹1,100 for the table; friends paid back → your share ₹423'],
        ['', '', '', '', '', '', ''],
      ]),
      'Expenses',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'From', 'Type', 'Amount (₹)', 'Notes'],
        ['01-Oct-2026', 'Anbu (Dad)', 'Father', '₹12,000', 'Pocket money'],
        ['16-Oct-2026', 'Ravi S', 'Friend paid back', '₹235', 'Dinner'],
        ['TOTAL IN', '', '', '₹12,235', ''],
      ]),
      'Money In',
    );
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })).buffer;
  };

  it('picks the sheet with payments, not the first one, and reads "Money In" too', async () => {
    const f = await fromWorkbook('Expense_Tracker-2.xlsx', workbook());
    expect(f.table?.[0]).toContain('Category');
    const r = legacySheetParser.parse(f);
    expect(r.rows.map((x) => [x.direction, x.amountPaise, x.payee, x.subtypeHint])).toEqual([
      ['debit', 22_300, 'Frenza Mandi', undefined],
      ['credit', 1_200_000, 'Anbu (Dad)', 'family'],
      ['credit', 23_500, 'Ravi S', 'payback'],
    ]);
    expect(r.unreadable).toEqual([]);
  });

  it('knows a file by its content, not its name', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniff(enc('%PDF-1.7 ...'), 'download')).toBe('pdf');
    expect(sniff(new Uint8Array(workbook()), 'statement (3).csv')).toBe('xlsx');
    expect(sniff(enc('Date;Narration;Amount\n01/10/2026;UPI/1/DR/X/YES/UPI;50\n02/10/2026;UPI/2/DR/Y/YES/UPI;60'), 'file.txt')).toBe('csv');
    expect(sniff(enc('<html><body><div class="outer-cell">Google Pay</div></body></html>'), 'MyActivity')).toBe('html');
    expect(sniff(enc('[{"header":"Google Pay"}]'), 'x.dat')).toBe('json');
  });
});

describe('Google transactions CSV from Takeout', () => {
  it('reads Google purchases and sets aside cancelled ones', () => {
    const f = fromCsv(
      'transactions_246147690115.csv',
      'Time,Transaction ID,Description,Product,Payment method,Status,Amount\n"8 Feb 2026, 08:25",SOP.3333-8745,Google AI Pro (2 TB) (Google One),Google One,UPI: GPay,Cancelled,"INR 1,950.00"\n"9 Feb 2026, 09:00",SOP.4444-1,Google AI Pro (2 TB) (Google One),Google One,UPI: GPay,Complete,"INR 1,950.00"',
    );
    expect(googlePayParser.detect(f)).toBeGreaterThan(0.8);
    const r = googlePayParser.parse(f);
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ date: '2026-02-09', amountPaise: 195_000, payee: 'Google One', item: 'Google AI Pro (2 TB)', direction: 'debit' });
  });
});

describe('notebook and bank together', () => {
  const ctx = (existing: Transaction[], parserId: string, sourceKind: BuildContext['sourceKind'] = 'bank'): BuildContext => ({ existing, rules: [], people: [], categories: DEFAULT_CATEGORIES, sourceKind, parserId });
  const notebook = (over: Partial<Transaction>): Transaction => ({
    id: Math.random().toString(36),
    date: '2026-10-16',
    type: 'expense',
    amountPaise: 22_300,
    categoryId: 'c-eating-out',
    item: 'Group dinner',
    place: 'Frenza Mandi',
    paymentMode: 'UPI',
    note: 'Paid ₹1,100 for the table; friends paid back → your share ₹423',
    sources: [{ kind: 'csv', parser: 'legacy-sheet' }],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });
  const bankRow = { date: '2026-10-16', amountPaise: 110_000, direction: 'debit' as const, description: 'UPI/628910812154/DR/ FRENZA MANDI/FDR/UPI', payee: 'Frenza Mandi', upiRef: '628910812154', rowIndex: 1 };

  it('reads ₹ amounts out of notes', () => {
    expect(amountsIn('Paid ₹1,100 for the table; Srinivas ₹235, Rs. 206 and INR 236')).toEqual([110_000, 23_500, 20_600, 23_600]);
  });

  it('links my share in the notebook to the full bank payment named in its note', () => {
    const t = notebook({});
    const [c] = buildCandidates([bankRow], ctx([t], 'iob'));
    expect(c).toMatchObject({ status: 'merge', mergeWithId: t.id, categoryId: 'c-eating-out' });
  });

  it('a payment merged from one statement is a duplicate in an overlapping one', () => {
    const t = notebook({ sources: [{ kind: 'csv', parser: 'legacy-sheet' }] });
    const [first] = buildCandidates([bankRow], ctx([t], 'iob'));
    const merged = { ...t, upiRef: bankRow.upiRef, sources: [...t.sources, { kind: 'bank' as const, parser: 'iob', ref: first.importRef }] };
    const [again] = buildCandidates([{ ...bankRow, rowIndex: 40 }], ctx([merged], 'iob'));
    expect(again.status).toBe('duplicate');
  });

  it('other payments to a place the notebook knows get its category', () => {
    const t = notebook({ amountPaise: 8_000, place: 'Ramana canteen', categoryId: 'c-tea', note: '', date: '2026-10-15' });
    const rows = [
      { date: '2026-10-15', amountPaise: 8_000, direction: 'debit' as const, description: 'UPI/1/DR/SHRI RAMANA/YES/UPI', payee: 'Shri Ramana', upiRef: '628831713093', rowIndex: 1 },
      { date: '2026-10-02', amountPaise: 4_400, direction: 'debit' as const, description: 'UPI/2/DR/SHRI RAMANA/YES/UPI', payee: 'Shri Ramana', upiRef: '628031713093', rowIndex: 2 },
    ];
    const cands = buildCandidates(rows, ctx([t], 'iob'));
    expect(cands.map((c) => [c.status, c.categoryId])).toEqual([
      ['merge', 'c-tea'],
      ['new', 'c-tea'],
    ]);
  });
});

describe('day-first or month-first dates', () => {
  it('decides from the whole column', async () => {
    const { inferDateOrder } = await import('./dates');
    expect(inferDateOrder(['01/10/26', '15/10/26'])).toBe('DMY');
    expect(inferDateOrder(['10/1/26', '10/15/26'])).toBe('MDY');
    // Ambiguous on its own; rows written in order settle it (Numbers prints 10/1, 10/2, 10/3 … for October).
    expect(inferDateOrder(['10/1/26', '10/2/26', '10/3/26', '10/4/26'])).toBe('MDY');
    expect(inferDateOrder(['1/10/26', '2/10/26', '3/10/26'])).toBe('DMY');
  });
});
