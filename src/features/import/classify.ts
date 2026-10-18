import type { TxSubtype, TxType } from '@/data/types';
import { looksLikePerson } from '@/features/rules/engine';
import type { RawTransaction } from './types';
import { cleanPayee, parseNarration, parseUpiNarration } from './upi';
import { normalisePlace } from '@/features/rules/engine';

export interface Classified {
  type: TxType;
  subtype?: TxSubtype;
  /** Ignored but kept (e.g. mandate verification pairs). */
  excluded?: boolean;
  /** Fixed category for well-known bank lines (charges). */
  categoryId?: string;
  item?: string;
  payee: string;
  note?: string;
  upiRef?: string;
  paymentMode: 'UPI' | 'Cash' | 'Card' | 'Net banking' | 'Other';
}

/**
 * Turn a bank line into expense / income / transfer, following how Indian statements read:
 * UPI debit → expense; UPI credit → friend payback or income; "By <name>" → family;
 * APBS / scholarship → scholarship; Int.Pd → interest; CHRGS / AMC → bank charge;
 * ATM → cash withdrawal (transfer, not spending).
 */
export interface ClassifyContext {
  /** Account holder's name from the statement header: payments to it are my own money moving. */
  holderName?: string;
}

/** "SYED SUHAIL" vs "Syed Suhail" or "S Suhail": the same person. */
export function isSameName(a: string, b?: string): boolean {
  if (!b) return false;
  const A = normalisePlace(a).split(' ').filter((w) => w.length > 1);
  const B = new Set(normalisePlace(b).split(' ').filter((w) => w.length > 1));
  return A.length > 0 && A.every((w) => B.has(w));
}

/** ₹1,000 or more from a person is rarely a friend settling up: treat it as money from home. */
const LARGE_PERSONAL_CREDIT = 100_000;

export function classify(raw: Pick<RawTransaction, 'description' | 'direction' | 'payee' | 'amountPaise' | 'note' | 'upiRef'>, ctx: ClassifyContext = {}): Classified {
  const d = raw.description;
  const D = d.toUpperCase();
  const upi = parseNarration(d);
  const payee = upi?.payee || raw.payee || cleanPayee(d);
  const base = { payee, note: upi?.note ?? raw.note, upiRef: upi?.upiRef ?? raw.upiRef };

  if (upi?.lite || /\bUPI ?LITE\b|LITE ?(?:ENABLE|LOAD|TOP ?UP)/.test(D)) {
    return { ...base, type: 'transfer', payee: 'UPI Lite', item: raw.direction === 'debit' ? 'Topped up UPI Lite' : 'UPI Lite returned', paymentMode: 'UPI' };
  }
  if (isSameName(payee, ctx.holderName)) {
    return { ...base, type: 'transfer', item: raw.direction === 'debit' ? 'To my other account' : 'From my other account', paymentMode: upi?.upiRef ? 'UPI' : 'Net banking' };
  }

  if (/\bATM\b|\bATW\b|CASH ?WDL|CASH WITHDRAWAL|\bNWD\b|\bEAW\b/.test(D) && raw.direction === 'debit') {
    return { ...base, type: 'transfer', subtype: 'cash-withdrawal', payee: 'ATM', item: 'Cash withdrawal', paymentMode: 'Other' };
  }
  if (/\bMANDATE\b/.test(D) && raw.amountPaise <= 500) {
    return { ...base, type: raw.direction === 'debit' ? 'expense' : 'income', subtype: 'verification', excluded: true, item: 'Bank verification', paymentMode: 'UPI' };
  }
  if (/\bINT\.?\s?PD\b|INTEREST (?:PAID|CREDIT)|\bSB INT\b|CREDIT INTEREST/.test(D) && raw.direction === 'credit') {
    return { ...base, type: 'income', subtype: 'interest', payee: 'Bank interest', item: 'Interest', paymentMode: 'Net banking' };
  }
  if (/\bCHRGS?\b|\bCHARGES?\b|\bAMC\b|\bSMS CHG|\bGST\b.*CHG|DEBIT CARD FEE|MIN BAL|NON[- ]MAINT/.test(D) && raw.direction === 'debit') {
    return { ...base, type: 'expense', subtype: 'bank-charge', payee: 'Bank', item: 'Bank charges', categoryId: 'c-misc', paymentMode: 'Other' };
  }
  if (/\bAPBS\b|SCHOLARSHIP|POST MATRIC|PRE MATRIC|\bNSP\b|\bDBT\b/.test(D) && raw.direction === 'credit') {
    return { ...base, type: 'income', subtype: 'scholarship', payee: 'Scholarship', item: 'Scholarship', paymentMode: 'Net banking' };
  }
  const by = /^\s*BY\s+(?:CASH\s*-?\s*)?(.+)$/i.exec(d);
  if (by && raw.direction === 'credit' && !upi) {
    const name = cleanPayee(by[1]);
    return { ...base, type: 'income', subtype: 'family', payee: name, item: 'From family', paymentMode: /CASH/i.test(d) ? 'Cash' : 'Net banking' };
  }
  if (/\bREFUND\b|\bREVERSAL\b|\bREV\b/.test(D) && raw.direction === 'credit') {
    return { ...base, type: 'income', subtype: 'refund', item: 'Refund', paymentMode: upi ? 'UPI' : 'Other' };
  }
  if (/\bSALARY\b|\bSAL\b/.test(D) && raw.direction === 'credit') {
    return { ...base, type: 'income', subtype: 'salary', item: 'Salary', paymentMode: 'Net banking' };
  }

  const mode = upi || /\bUPI\b/.test(D) ? 'UPI' : /\bPOS\b|\bECOM\b|CARD/.test(D) ? 'Card' : /NEFT|IMPS|RTGS|NET ?BANKING|\bIB\b/.test(D) ? 'Net banking' : 'Other';
  if (raw.direction === 'debit') return { ...base, type: 'expense', paymentMode: mode };
  // Person-to-person credit: small ones are friends paying back, large ones are money from home.
  if (looksLikePerson(payee)) {
    return raw.amountPaise >= LARGE_PERSONAL_CREDIT
      ? { ...base, type: 'income', subtype: 'family', item: 'Money from home', paymentMode: mode }
      : { ...base, type: 'income', subtype: 'payback', paymentMode: mode };
  }
  return { ...base, type: 'income', subtype: 'pocket-money', paymentMode: mode };
}

/**
 * Pair tiny mandate debits with their matching credit (bank account verification)
 * so both are ignored, even when only one side says MANDATE.
 */
export function pairVerifications<T extends { raw: RawTransaction; cls: Classified }>(rows: T[]): void {
  const tiny = rows.filter((r) => r.raw.amountPaise <= 500);
  for (const a of tiny) {
    if (a.raw.direction !== 'debit' || !/MANDATE|VERIF|PENNY/i.test(a.raw.description)) continue;
    const b = tiny.find(
      (x) => x !== a && x.raw.direction === 'credit' && x.raw.amountPaise === a.raw.amountPaise && Math.abs(Date.parse(x.raw.date) - Date.parse(a.raw.date)) <= 3 * 86_400_000,
    );
    a.cls = { ...a.cls, excluded: true, subtype: 'verification', item: 'Bank verification' };
    if (b) b.cls = { ...b.cls, excluded: true, subtype: 'verification', item: 'Bank verification (refund)' };
  }
}

/** Direction from the narration alone, for pasted text and SMS with no debit/credit column. */
export function inferDirection(description: string): RawTransaction['direction'] | undefined {
  const upi = parseUpiNarration(description);
  if (upi?.direction) return upi.direction;
  const D = description.toUpperCase();
  if (/^\s*BY\s|\bAPBS\b|SCHOLARSHIP|\bINT\.?\s?PD\b|\bREFUND\b|\bREVERSAL\b|\bCREDITED\b|\bSALARY\b/.test(D)) return 'credit';
  if (/\bATM\b|\bCHRGS?\b|\bAMC\b|\bDEBITED\b|^\s*TO\s/.test(D)) return 'debit';
  return undefined;
}

/** One narration in, everything we can tell about it out. */
export function analyseNarration(description: string, amountPaise = 0, ctx: ClassifyContext = {}) {
  const direction = inferDirection(description) ?? 'debit';
  const parsed = parseNarration(description);
  const cls = classify({ description, direction, payee: parsed?.payee ?? '', amountPaise, note: parsed?.note, upiRef: parsed?.upiRef }, ctx);
  return { direction, ...cls };
}
