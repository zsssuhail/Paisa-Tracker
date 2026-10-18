import { describe, expect, it } from 'vitest';
import { analyseNarration, classify } from './classify';
import { parseUpiNarration, titleCase, cleanPayee, joinWrapped } from './upi';
import { parseLooseDate } from './dates';
import { detectColumns, readTable } from './table';
import { fromCsv, fromPaste } from './load';
import { iobParser, genericBankParser } from './parsers/bank';
import { googlePayParser } from './parsers/googlePay';
import { legacySheetParser, parsePastedText, paytmParser } from './parsers/others';
import { rankParsers } from './parsers';
import { groupLines } from './pdf/extract';
import { pdfLinesToTable } from './pdf/toTable';
import { buildCandidates, payeeSimilarity, type BuildContext } from './pipeline/build';
import { reconcile } from './pipeline/reconcile';
import { DEFAULT_CATEGORIES } from '@/features/categories/defaults';
import type { Transaction } from '@/data/types';

describe('UPI narration parser (real examples)', () => {
  it('UPI/629032644176/DR/CSA Automobile/YES/UPI → payee "CSA Automobile", debit', () => {
    const r = analyseNarration('UPI/629032644176/DR/CSA Automobile/YES/UPI', 5_000);
    expect(r.payee).toBe('CSA Automobile');
    expect(r.direction).toBe('debit');
    expect(r.type).toBe('expense');
    expect(r.upiRef).toBe('629032644176');
    expect(r.note).toBeUndefined();
  });

  it('UPI/628982348642/CR/ SRINIVAS S/IOB/dinner → payee "Srinivas S", credit, note "dinner"', () => {
    const r = analyseNarration('UPI/628982348642/CR/ SRINIVAS S/IOB/dinner', 22_000);
    expect(r.payee).toBe('Srinivas S');
    expect(r.direction).toBe('credit');
    expect(r.note).toBe('dinner');
    expect(r.type).toBe('income');
    expect(r.subtype).toBe('payback');
  });

  it('APBS: TN262 Post Matric Sc 25092026-011712 → credit, scholarship', () => {
    const r = analyseNarration('APBS: TN262 Post Matric Sc 25092026-011712', 1_000_000);
    expect(r.direction).toBe('credit');
    expect(r.type).toBe('income');
    expect(r.subtype).toBe('scholarship');
  });

  it('By SHAHUL HAMEED → credit, family', () => {
    const r = analyseNarration('By SHAHUL HAMEED', 500_000);
    expect(r.direction).toBe('credit');
    expect(r.subtype).toBe('family');
    expect(r.payee).toBe('Shahul Hameed');
  });

  it('strips bank codes and title-cases messy payees', () => {
    expect(parseUpiNarration('UPI/629038165565/DR/ANNATCHI FAMOU/YES/UPI')?.payee).toBe('Annatchi Famou');
    expect(titleCase('CSA Automobile')).toBe('CSA Automobile');
    expect(titleCase('SRINIVAS S')).toBe('Srinivas S');
    expect(cleanPayee('UPI/629011112222/DR/  SHRI   RAMANA ME /SBI/')).toBe('Shri Ramana Me');
  });

  it('rejoins names the PDF split across two lines', () => {
    const joined = joinWrapped('UPI/629011112222/DR/SHRI RAMANA', 'ME/YES/UPI');
    expect(parseUpiNarration(joined)?.payee).toBe('Shri Ramana Me');
    const j2 = joinWrapped('UPI/629011113333/DR/FIR MEDICAL', 'SH/IOB/UPI');
    expect(parseUpiNarration(j2)?.payee).toBe('Fir Medical Sh');
  });

  it('handles the hyphen narration style', () => {
    const r = parseUpiNarration('UPI-SWIGGY-swiggy@icici-ICIC0DC0099-629011114444-Dinner');
    expect(r?.payee).toBe('Swiggy');
    expect(r?.upiRef).toBe('629011114444');
    expect(r?.note).toBe('Dinner');
  });
});

describe('bank line classification', () => {
  const c = (description: string, direction: 'debit' | 'credit', amountPaise = 10_000) => classify({ description, direction, payee: '', amountPaise });
  it('interest, charges, ATM', () => {
    expect(c('Int.Pd:01-07-2026 to 30-09-2026', 'credit').subtype).toBe('interest');
    expect(c('SMS CHRGS FOR QTR', 'debit')).toMatchObject({ type: 'expense', subtype: 'bank-charge', categoryId: 'c-misc' });
    expect(c('ATM WDL/MADURAI/1234', 'debit')).toMatchObject({ type: 'transfer', subtype: 'cash-withdrawal' });
  });
  it('ignores tiny mandate verification', () => {
    expect(c('UPI MANDATE/629/DR/GOOGLE/HDFC', 'debit', 100).excluded).toBe(true);
  });
});

describe('dates', () => {
  it('reads Indian bank formats', () => {
    expect(parseLooseDate('01/10/2026')).toBe('2026-10-01');
    expect(parseLooseDate('01-10-26')).toBe('2026-10-01');
    expect(parseLooseDate('01-Oct-2026')).toBe('2026-10-01');
    expect(parseLooseDate('Oct 1, 2026, 10:21:33 AM')).toBe('2026-10-01');
    expect(parseLooseDate('2026-10-01')).toBe('2026-10-01');
    expect(parseLooseDate('31/02/2026')).toBeNull();
  });
});

const IOB_CSV = `INDIAN OVERSEAS BANK
Account Statement for A/c No 123456781234
Date,Particulars,Ref No.,Debit,Credit,Balance
01/10/2026,Opening Balance,,,,"5,000.00"
01/10/2026,UPI/629032644176/DR/CSA Automobile/YES/UPI,629032644176,50.00,,"4,950.00"
02/10/2026,UPI/629011112222/DR/SHRI RAMANA,629011112222,44.00,,"4,906.00"
,ME/YES/UPI,,,,
03/10/2026,UPI/628982348642/CR/ SRINIVAS S/IOB/dinner,628982348642,,220.00,"5,126.00"
05/10/2026,APBS: TN262 Post Matric Sc 25092026-011712,,,"10,000.00","15,126.00"
06/10/2026,By SHAHUL HAMEED,,,"5,000.00","20,126.00"
07/10/2026,ATM WDL MADURAI,,"1,000.00",,"19,126.00"
08/10/2026,SMS CHRGS,,15.00,,"19,111.00"
`;

describe('IOB statement', () => {
  const file = fromCsv('iob.csv', IOB_CSV);
  it('is detected as IOB with high confidence', () => {
    expect(iobParser.detect(file)).toBeGreaterThan(0.9);
    expect(rankParsers(file, [])[0].parser.id).toBe('iob');
  });
  it('parses rows, joins wrapped narrations, reads balances', () => {
    const r = iobParser.parse(file);
    expect(r.rows).toHaveLength(7);
    expect(r.unreadable).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({ date: '2026-10-01', amountPaise: 5_000, direction: 'debit', payee: 'CSA Automobile', upiRef: '629032644176', balancePaise: 495_000 });
    expect(r.rows[1].payee).toBe('Shri Ramana Me');
    expect(r.rows[2]).toMatchObject({ direction: 'credit', payee: 'Srinivas S', note: 'dinner' });
    expect(r.bankName).toBe('Indian Overseas Bank');
  });
  it('reconciles opening + credits − debits = closing', () => {
    const rec = reconcile(iobParser.parse(file).rows)!;
    expect(rec.opening).toBe(500_000);
    expect(rec.closing).toBe(1_911_100);
    expect(rec.balanced).toBe(true);
  });
  it('flags a missing row', () => {
    const rows = iobParser.parse(file).rows.filter((_, i) => i !== 3);
    const rec = reconcile(rows)!;
    expect(rec.balanced).toBe(false);
    expect(rec.gaps).toHaveLength(1);
    expect(rec.gaps[0].differencePaise).toBe(1_000_000);
  });
});

describe('generic bank (HDFC-style single amount + Dr/Cr)', () => {
  it('reads Narration / Withdrawal Amt / Deposit Amt', () => {
    const f = fromCsv('hdfc.csv', `HDFC BANK Ltd\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/26,UPI-SWIGGY-swiggy@icici-ICIC0DC0099-629011114444-Dinner,0000629011114444,01/10/26,212.00,,"1,788.00"`);
    expect(genericBankParser.detect(f)).toBeGreaterThan(0.5);
    const r = genericBankParser.parse(f);
    expect(r.rows[0]).toMatchObject({ amountPaise: 21_200, direction: 'debit', payee: 'Swiggy' });
  });
  it('reads a signed amount column', () => {
    const t = fromCsv('x.csv', 'Txn Date,Description,Amount,Balance\n01-10-2026,UPI/629/DR/TEA STALL/SBI/UPI,-20.00,980.00\n02-10-2026,UPI/628/CR/ARUN K/SBI/UPI,500.00,1480.00').table!;
    const m = detectColumns(t)!;
    const r = readTable(t, { ...m.mapping, dateFormat: 'DMY', headerRow: m.headerRow } as never);
    expect(r.rows.map((x) => x.direction)).toEqual(['debit', 'credit']);
  });
});

describe('PDF row reconstruction', () => {
  it('assigns cells to header columns and keeps wrapped lines', () => {
    const items = [
      { x: 40, y: 700, width: 30, text: 'Date' }, { x: 110, y: 700, width: 60, text: 'Particulars' }, { x: 380, y: 700, width: 30, text: 'Debit' }, { x: 450, y: 700, width: 35, text: 'Credit' }, { x: 520, y: 700, width: 40, text: 'Balance' },
      { x: 40, y: 680, width: 50, text: '02/10/2026' }, { x: 110, y: 680, width: 180, text: 'UPI/629011112222/DR/SHRI RAMANA' }, { x: 388, y: 680, width: 22, text: '44.00' }, { x: 515, y: 680, width: 45, text: '4,906.00' },
      { x: 110, y: 668, width: 60, text: 'ME/YES/UPI' },
      { x: 40, y: 650, width: 50, text: '03/10/2026' }, { x: 110, y: 650, width: 200, text: 'UPI/628982348642/CR/ SRINIVAS S/IOB/dinner' }, { x: 455, y: 650, width: 30, text: '220.00' }, { x: 515, y: 650, width: 45, text: '5,126.00' },
    ];
    const table = pdfLinesToTable(groupLines(items, 1))!;
    const m = detectColumns(table)!;
    const r = readTable(table, { ...m.mapping, headerRow: m.headerRow, dateFormat: 'DMY' } as never);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ payee: 'Shri Ramana Me', amountPaise: 4_400, direction: 'debit', balancePaise: 490_600 });
    expect(r.rows[1]).toMatchObject({ payee: 'Srinivas S', amountPaise: 22_000, direction: 'credit' });
  });
});

const GPAY_HTML = `<html><body>
<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell">Google Pay</div>
<div class="content-cell">Paid ₹50.00 to CSA Automobile using Bank Account XXXXXX1234<br>Oct 1, 2026, 10:21:33 AM GMT+05:30<br></div>
<div class="content-cell">Details:<br>UPI transaction ID: 629032644176<br>Completed</div></div></div>
<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell">Google Pay</div>
<div class="content-cell">Received ₹220.00 from SRINIVAS S<br>Oct 3, 2026, 9:02:10 PM GMT+05:30<br></div>
<div class="content-cell">Details:<br>Completed</div></div></div>
<div class="outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell">Google Pay</div>
<div class="content-cell">Paid ₹99.00 to Sri Xerox using Bank Account XXXXXX1234<br>Oct 2, 2026, 1:00:00 PM GMT+05:30<br></div>
<div class="content-cell">Details:<br>Failed</div></div></div>
</body></html>`;

describe('Google Pay', () => {
  it('reads Takeout My Activity.html and skips failed payments', () => {
    const f = { name: 'My Activity.html', kind: 'html' as const, text: GPAY_HTML };
    expect(googlePayParser.detect(f)).toBeGreaterThan(0.9);
    const r = googlePayParser.parse(f);
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.rows[0]).toMatchObject({ date: '2026-10-01', time: '10:21', amountPaise: 5_000, direction: 'debit', payee: 'CSA Automobile', upiRef: '629032644176' });
    expect(r.rows[1]).toMatchObject({ direction: 'credit', payee: 'Srinivas S', amountPaise: 22_000 });
  });
  it('reads Takeout My Activity.json', () => {
    const f = {
      name: 'My Activity.json',
      kind: 'json' as const,
      text: JSON.stringify([{ header: 'Google Pay', title: 'Paid ₹212.00 to Swiggy using Bank Account XXXXXX1234', time: '2026-10-04T14:30:00.000Z', details: [{ name: 'Completed' }] }]),
    };
    const r = googlePayParser.parse(f);
    expect(r.rows[0]).toMatchObject({ date: '2026-10-04', amountPaise: 21_200, payee: 'Swiggy' });
  });
});

describe('other sources', () => {
  it('reads the old spreadsheet with its categories', () => {
    const f = fromCsv('old.csv', 'Date,Category,Item / Description,Where (shop / app),Payment Mode,Amount (₹),Notes\n01/10/2026,Tea & Vada,Tea and vada,Ramana canteen,UPI,44,\n02/10/2026,Gym,Monthly fee,Iron Gym,Cash,500,new place\n,TOTAL,,,,544,');
    expect(legacySheetParser.detect(f)).toBeGreaterThan(0.9);
    const r = legacySheetParser.parse(f);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ categoryName: 'Tea & Vada', payee: 'Ramana canteen', paymentMode: 'UPI', amountPaise: 4_400 });
    expect(r.rows[1]).toMatchObject({ paymentMode: 'Cash', note: 'new place' });
  });
  it('reads Paytm passbook', () => {
    const f = fromCsv('paytm.csv', 'Date,Time,Transaction Details,Other Transaction Details (UPI ID or A/c No),Your Account,Amount,UPI Ref No.,Order ID,Remarks,Tags,Comment\n01/10/2026,10:00:00,Paid to Burger Point,burger@paytm,SBI - 1234,-100.00,629055556666,,,,\n');
    expect(paytmParser.detect(f)).toBeGreaterThan(0.8);
    expect(paytmParser.parse(f).rows[0]).toMatchObject({ direction: 'debit', amountPaise: 10_000, payee: 'Burger Point', upiRef: '629055556666' });
  });
  it('reads SMS alerts and pasted statement rows', () => {
    const r = parsePastedText(
      'Rs.50.00 debited from A/c XX1234 on 01-10-26 to VPA csa@ybl (UPI Ref No 629032644176). -IOB\n\nDear Customer, Acct XX1234 is credited with Rs 220.00 on 03-Oct-26 from SRINIVAS S. UPI:628982348642\n\n05/10/2026 APBS: TN262 Post Matric Sc 25092026-011712 10,000.00 15,126.00',
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ direction: 'debit', amountPaise: 5_000, upiRef: '629032644176', date: '2026-10-01' });
    expect(r.rows[1]).toMatchObject({ direction: 'credit', amountPaise: 22_000, payee: 'Srinivas S' });
    expect(r.rows[2]).toMatchObject({ direction: 'credit', amountPaise: 1_000_000 });
  });
  it('treats a pasted CSV as a table', () => {
    expect(fromPaste('a,b,c\n1,2,3\n4,5,6').kind).toBe('csv');
  });
});

describe('dedupe and cross-source merge', () => {
  const ctx = (existing: Transaction[], parserId = 'iob', sourceKind: 'bank' | 'googlepay' = 'bank'): BuildContext => ({ existing, rules: [], people: [], categories: DEFAULT_CATEGORIES, sourceKind, parserId });
  const iobRows = iobParser.parse(fromCsv('iob.csv', IOB_CSV)).rows;

  it('importing the same file twice adds nothing', () => {
    const first = buildCandidates(iobRows, ctx([]));
    const saved = first.map((c, i) => ({ id: `t${i}`, importRef: c.importRef, date: c.raw.date, amountPaise: c.raw.amountPaise, type: c.cls.type, place: c.cls.payee, sources: [{ kind: 'bank', parser: 'iob' }] }) as Transaction);
    const second = buildCandidates(iobRows, ctx(saved));
    expect(second.every((c) => c.status === 'duplicate')).toBe(true);
  });

  it('merges a Google Pay row with the same bank payment (UPI ref)', () => {
    const bank = buildCandidates(iobRows, ctx([]));
    const saved = bank.map((c, i) => ({ id: `t${i}`, importRef: c.importRef, upiRef: c.cls.upiRef, date: c.raw.date, amountPaise: c.raw.amountPaise, type: c.cls.type, place: c.cls.payee, sources: [{ kind: 'bank', parser: 'iob' }] }) as Transaction);
    const gpay = googlePayParser.parse({ name: 'a.html', kind: 'html', text: GPAY_HTML }).rows;
    const cands = buildCandidates(gpay, ctx(saved, 'googlepay', 'googlepay'));
    expect(cands[0].status).toBe('merge');
    expect(cands[0].mergeWithId).toBe('t0');
    // No UPI ref on the GPay credit: matched by amount, date ±1 and payee.
    expect(cands[1].status).toBe('merge');
  });

  it('never merges two identical payments from the same source', () => {
    // Same day, place and amount, but a different bank reference: two real payments.
    const rows = [iobRows[0], { ...iobRows[0], rowIndex: 99, upiRef: undefined, reference: 'S00000001', description: 'UPI/1/DR/CSA Automobile/YES/UPI' }];
    const cands = buildCandidates(rows, ctx([]));
    expect(cands.map((c) => c.status)).toEqual(['new', 'new']);
    expect(cands[0].importRef).not.toBe(cands[1].importRef);
  });

  it('payee similarity tolerates truncation', () => {
    expect(payeeSimilarity('Annatchi Famou', 'Annatchi Famous')).toBeGreaterThanOrEqual(0.5);
    expect(payeeSimilarity('Swiggy', 'Zomato')).toBe(0);
  });

  it('classifies and guesses categories with rules of thumb', () => {
    const cands = buildCandidates(iobRows, ctx([]));
    const byPayee = Object.fromEntries(cands.map((c) => [c.cls.payee, c]));
    expect(byPayee['CSA Automobile'].categoryId).toBe('c-travel');
    expect(byPayee['Scholarship'].cls.subtype).toBe('scholarship');
    expect(byPayee['ATM'].cls.type).toBe('transfer');
    expect(cands.find((c) => c.cls.subtype === 'bank-charge')?.categoryId).toBe('c-misc');
  });
});
