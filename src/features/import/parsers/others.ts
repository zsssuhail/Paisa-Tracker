import type { CustomSource, PaymentMode, TxSubtype } from '@/data/types';
import { parseMoney } from '@/data/money';
import { DATE_AT_START, inferDateOrder, parseLooseDate, parseLooseTime } from '../dates';
import { headerSignature, readTable } from '../table';
import type { Direction, Parser, ParseResult, RawTransaction, Unreadable } from '../types';
import { cleanPayee, parseUpiNarration, squash } from '../upi';
import { tableOf } from './bank';
import { inferDirection } from '../classify';

const ok = (r: RawTransaction | Unreadable): r is RawTransaction => 'amountPaise' in r;
function finish(list: (RawTransaction | Unreadable)[], bankName?: string, skipped = 0): ParseResult {
  return { rows: list.filter(ok), unreadable: list.filter((r): r is Unreadable => !ok(r)), skipped, bankName };
}

/** PhonePe statement PDF: "Oct 01, 2026 10:21 am Paid to X DEBIT ₹50 … UTR No. 629…". */
export const phonePeParser: Parser = {
  id: 'phonepe',
  label: 'PhonePe',
  source: 'bank',
  detect: (file) => (file.kind === 'pdf' && /PhonePe/i.test(file.text) && /(DEBIT|CREDIT)/.test(file.text) ? 0.9 : file.table?.[0]?.join('|').match(/phonepe/i) ? 0.7 : 0),
  parse(file) {
    const lines = (file.lines ?? []).map((l) => squash(l.text));
    const START = /^([A-Za-z]{3} \d{1,2}, \d{4})/;
    const out: (RawTransaction | Unreadable)[] = [];
    let block: string[] = [];
    const flush = () => {
      if (!block.length) return;
      const text = block.join(' ');
      const date = parseLooseDate(START.exec(block[0])?.[1] ?? '', 'MDY');
      const who = /(Paid to|Received from|Payment to|Sent to)\s+(.+?)(?=\s+(?:DEBIT|CREDIT)\b|\s+Transaction ID|\s+₹|$)/i.exec(text);
      const amount = /(?:₹|INR|Rs\.?)\s?([\d,]+(?:\.\d{1,2})?)/.exec(text);
      const dir: Direction = /\bCREDIT\b|Received from/i.test(text) ? 'credit' : 'debit';
      const utr = /UTR(?: No\.?)?\s*:?\s*(\d{9,})/i.exec(text)?.[1];
      if (!date || !who || !amount) out.push({ text, reason: "Couldn't read this entry" });
      else
        out.push({
          date,
          time: parseLooseTime(text),
          amountPaise: parseMoney(amount[1]) ?? 0,
          direction: dir,
          description: text,
          payee: cleanPayee(who[2]),
          rawPayee: who[2],
          upiRef: utr,
          reference: utr,
          status: /\bfailed\b|\bpending\b/i.test(text) ? 'failed' : 'success',
          rowIndex: out.length,
        });
      block = [];
    };
    for (const l of lines) {
      if (START.test(l)) flush();
      if (START.test(l) || block.length) block.push(l);
    }
    flush();
    const rows = out.filter(ok);
    const good = rows.filter((r) => r.status === 'success');
    return { rows: good, unreadable: out.filter((r): r is Unreadable => !ok(r)), skipped: rows.length - good.length, bankName: 'PhonePe' };
  },
};

/** Paytm passbook CSV/XLSX: Date, Time, Transaction Details, Other Transaction Details, Your Account, Amount, UPI Ref No., … */
export const paytmParser: Parser = {
  id: 'paytm',
  label: 'Paytm',
  source: 'bank',
  detect(file) {
    const h = (file.table?.[0] ?? []).join('|').toLowerCase();
    return /transaction details/.test(h) && /upi ref/.test(h) && /amount/.test(h) ? 0.9 : 0;
  },
  parse(file) {
    const table = file.table ?? [];
    const header = table[0].map((h) => h.toLowerCase().trim());
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const [di, ti, desc, other, amt, ref, status, remarks] = [col(/^date/), col(/^time/), col(/^transaction details/), col(/other transaction details/), col(/^amount/), col(/upi ref/), col(/status/), col(/remarks|comment/)];
    const out: (RawTransaction | Unreadable)[] = table.slice(1).map((r, i) => {
      const date = parseLooseDate(r[di] ?? '');
      const raw = r[amt] ?? '';
      const amount = parseMoney(raw);
      if (!date || amount == null) return { text: r.join(' | '), reason: 'Missing date or amount' };
      const text = r[desc] ?? '';
      const payee = text.replace(/^(?:paid to|money sent to|received from|money received from|sent to)\s+/i, '');
      return {
        date,
        time: parseLooseTime(r[ti] ?? ''),
        amountPaise: Math.abs(amount),
        direction: amount < 0 || /paid|sent/i.test(text) ? 'debit' : 'credit',
        description: squash(`${text} ${r[other] ?? ''}`),
        payee: cleanPayee(payee),
        rawPayee: payee,
        upiRef: /^\d{9,}$/.test(r[ref] ?? '') ? r[ref] : undefined,
        reference: r[ref],
        note: remarks >= 0 ? r[remarks] : undefined,
        status: status >= 0 && /fail|pending/i.test(r[status] ?? '') ? 'failed' : 'success',
        rowIndex: i + 1,
      };
    });
    const rows = out.filter(ok);
    const good = rows.filter((r) => r.status === 'success');
    return { rows: good, unreadable: out.filter((r): r is Unreadable => !ok(r)), skipped: rows.length - good.length, bankName: 'Paytm' };
  },
};

const MODES: Record<string, PaymentMode> = { upi: 'UPI', gpay: 'UPI', phonepe: 'UPI', paytm: 'UPI', cash: 'Cash', card: 'Card', 'debit card': 'Card', 'credit card': 'Card', 'net banking': 'Net banking', netbanking: 'Net banking', neft: 'Net banking', imps: 'Net banking' };

/** The original spreadsheet: Date, Category, Item / Description, Where, Payment Mode, Amount (₹), Notes. */
export const legacySheetParser: Parser = {
  id: 'legacy-sheet',
  label: 'My old spreadsheet',
  source: 'csv',
  detect(file) {
    const t = tableOf(file);
    if (!t) return 0;
    for (const row of t.slice(0, 5)) {
      const h = row.join('|').toLowerCase();
      if (/date/.test(h) && /category/.test(h) && /(item|description)/.test(h) && /where/.test(h) && /amount/.test(h)) return 0.97;
    }
    return 0;
  },
  parse(file) {
    const t = tableOf(file) ?? [];
    const headerRow = t.findIndex((row) => /category/i.test(row.join('|')) && /amount/i.test(row.join('|')));
    const header = t[headerRow].map((h) => h.toLowerCase().trim());
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const c = { date: col(/^date/), cat: col(/category/), item: col(/item|description/), where: col(/where|place|shop/), mode: col(/payment|mode/), amount: col(/amount/), notes: col(/note/), type: col(/^type/) };
    const out: (RawTransaction | Unreadable)[] = [];
    const order = inferDateOrder(t.slice(headerRow + 1).map((r) => r[c.date] ?? ''));
    t.slice(headerRow + 1).forEach((r, i) => {
      if (r.every((x) => !String(x ?? '').trim())) return;
      const date = parseLooseDate(r[c.date] ?? '', order);
      const amount = parseMoney(r[c.amount] ?? '');
      // Summary rows ("Total") have no date: skip quietly.
      if (!date && /total|summary/i.test(r.join(' '))) return;
      if (!date || amount == null || amount === 0) {
        out.push({ text: r.join(' | '), reason: !date ? "Couldn't read the date" : 'No amount' });
        return;
      }
      const type = (r[c.type] ?? '').toLowerCase();
      const where = squash(r[c.where] ?? '');
      out.push({
        date,
        amountPaise: Math.abs(amount),
        direction: /income|credit|in$/.test(type) || amount < 0 ? 'credit' : 'debit',
        description: squash(`${r[c.item] ?? ''} ${where}`),
        payee: where,
        rawPayee: where,
        item: squash(r[c.item] ?? ''),
        categoryName: squash(r[c.cat] ?? '') || undefined,
        paymentMode: MODES[(r[c.mode] ?? '').toLowerCase().trim()] ?? (r[c.mode] ? 'Other' : 'UPI'),
        note: c.notes >= 0 ? squash(r[c.notes] ?? '') || undefined : undefined,
        rowIndex: headerRow + 1 + i,
      });
    });
    // Workbooks often keep money received on its own sheet ("Money In": Date, From, Type, Amount, Notes).
    for (const sheet of file.sheets ?? []) {
      if (sheet.table === t) continue;
      out.push(...readMoneyIn(sheet.table, out.length));
    }
    return finish(out, 'Spreadsheet');
  },
};

const INCOME_TYPES: [RegExp, TxSubtype][] = [
  [/paid back|payback|repaid|returned|settle/i, 'payback'],
  [/refund/i, 'refund'],
  [/scholar/i, 'scholarship'],
  [/salary|stipend|wage/i, 'salary'],
  [/interest/i, 'interest'],
  [/father|mother|dad|mom|amma|appa|parent|family|home|pocket/i, 'family'],
];

/** A "money in" sheet: a date, who it came from and an amount, with no spending category. */
function readMoneyIn(table: string[][], offset: number): (RawTransaction | Unreadable)[] {
  const headerRow = table.findIndex((r) => {
    const h = r.join('|').toLowerCase();
    return /date/.test(h) && /amount/.test(h) && /\b(from|source|received|sender|payer)\b/.test(h) && !/category/.test(h);
  });
  if (headerRow < 0) return [];
  const header = table[headerRow].map((h) => h.toLowerCase().trim());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = { date: col(/^date/), from: col(/from|source|received|sender|payer/), type: col(/type|kind/), amount: col(/amount/), notes: col(/note/) };
  const out: (RawTransaction | Unreadable)[] = [];
  const order = inferDateOrder(table.slice(headerRow + 1).map((r) => r[c.date] ?? ''));
  table.slice(headerRow + 1).forEach((r, i) => {
    if (r.every((x) => !String(x ?? '').trim())) return;
    const date = parseLooseDate(r[c.date] ?? '', order);
    const amount = parseMoney(r[c.amount] ?? '');
    if (!date && /total|summary/i.test(r.join(' '))) return;
    if (!date || !amount) {
      out.push({ text: r.join(' | '), reason: !date ? "Couldn't read the date" : 'No amount' });
      return;
    }
    const from = squash(r[c.from] ?? '');
    const type = c.type >= 0 ? squash(r[c.type] ?? '') : '';
    out.push({
      date,
      amountPaise: Math.abs(amount),
      direction: 'credit',
      description: squash(`${type} ${from}`),
      payee: from,
      rawPayee: from,
      item: type || undefined,
      subtypeHint: INCOME_TYPES.find(([re]) => re.test(type))?.[1],
      note: c.notes >= 0 ? squash(r[c.notes] ?? '') || undefined : undefined,
      rowIndex: offset + headerRow + 1 + i,
    });
  });
  return out;
}

/**
 * Pasted text: bank SMS alerts ("Rs.50.00 debited from A/c XX1234 on 01-10-26 to VPA csa@ybl
 * (UPI Ref No 629032644176)") or copied statement rows that start with a date.
 */
export function parsePastedText(text: string): ParseResult {
  const out: (RawTransaction | Unreadable)[] = [];
  const chunks = text
    .split(/\n\s*\n|\n(?=\s*(?:dear|rs\.?|inr|₹|a\/c|acct|your a\/c|\d{1,2}[-/ ][A-Za-z0-9]{2,3}[-/ ]))/i)
    .map((c) => squash(c))
    .filter(Boolean);
  chunks.forEach((chunk, i) => {
    const sms = parseSms(chunk, i);
    if (sms) {
      out.push(sms);
      return;
    }
    // Statement row: <date> <description> <amount> [Dr/Cr] [balance]
    const dm = DATE_AT_START.exec(chunk);
    if (dm) {
      const rest = chunk.slice(dm[0].length).trim();
      const nums = [...rest.matchAll(/(?:₹\s?)?(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})|\d+\.\d{2})\s*(Cr|Dr)?\b/gi)];
      const date = parseLooseDate(dm[1]);
      if (date && nums.length) {
        const amountMatch = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
        const balanceMatch = nums.length >= 2 ? nums[nums.length - 1] : undefined;
        const desc = squash(rest.slice(0, nums[0].index));
        const upi = parseUpiNarration(desc);
        const marker = amountMatch[2]?.toLowerCase();
        const dir: Direction = marker === 'cr' ? 'credit' : marker === 'dr' ? 'debit' : inferDirection(desc) ?? 'debit';
        out.push({
          date,
          amountPaise: parseMoney(amountMatch[1]) ?? 0,
          direction: dir,
          description: desc,
          payee: upi?.payee || cleanPayee(desc),
          rawPayee: upi?.rawPayee ?? desc,
          upiRef: upi?.upiRef,
          note: upi?.note,
          balancePaise: balanceMatch ? parseMoney(balanceMatch[1]) ?? undefined : undefined,
          rowIndex: i,
        });
        return;
      }
    }
    if (/\d/.test(chunk)) out.push({ text: chunk, reason: "Couldn't recognise this line" });
  });
  return finish(out, 'Pasted text');
}

function parseSms(text: string, rowIndex: number): RawTransaction | null {
  const amount = /(?:rs\.?|inr|₹)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const verb = /\b(debited|credited|spent|sent|paid|received|withdrawn)\b/i.exec(text);
  if (!amount || !verb) return null;
  const direction: Direction = /credited|received/i.test(verb[1]) ? 'credit' : 'debit';
  const date =
    parseLooseDate(/\bon\s+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i.exec(text)?.[1] ?? '') ??
    parseLooseDate(/(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/.exec(text)?.[1] ?? '') ??
    parseLooseDate(/(\d{1,2} [A-Za-z]{3} \d{2,4})/.exec(text)?.[1] ?? '');
  if (!date) return null;
  const who =
    /\b(?:to|at|towards)\s+(?:VPA\s+)?([A-Za-z0-9@._ &'-]+?)(?=\s+(?:on|ref|upi|via|\(|avl|avail|\.|from)\b|[.(]|$)/i.exec(text)?.[1] ??
    /\b(?:from|by)\s+(?:VPA\s+)?([A-Za-z0-9@._ &'-]+?)(?=\s+(?:on|ref|upi|via|\(|avl|\.)\b|[.(]|$)/i.exec(text)?.[1] ??
    '';
  const ref = /(?:UPI(?: Ref)?(?: No\.?)?|Ref(?: No\.?)?|UTR)\s*[:.]?\s*(\d{9,})/i.exec(text)?.[1];
  return {
    date,
    amountPaise: parseMoney(amount[1]) ?? 0,
    direction,
    description: text,
    payee: cleanPayee(who.replace(/@.*/, '')),
    rawPayee: who,
    upiRef: ref,
    reference: ref,
    account: /(?:a\/c|acct)\s*(?:no\.?)?\s*[X*]*(\d{3,4})/i.exec(text)?.[1],
    rowIndex,
  };
}

export const pasteParser: Parser = {
  id: 'paste',
  label: 'Pasted text or SMS',
  source: 'paste',
  detect: (file) => (file.kind === 'text' ? 0.6 : 0),
  parse: (file) => parsePastedText(file.text),
};

/** A layout the user mapped once and named; recognised by its header row next time. */
export function customParser(source: CustomSource): Parser {
  return {
    id: `custom-${source.id}`,
    label: source.name,
    source: 'csv',
    detect(file) {
      const t = tableOf(file);
      if (!t) return 0;
      return headerSignature(t, source.mapping.headerRow) === source.headerSignature ? 0.99 : 0;
    },
    parse(file) {
      const t = tableOf(file) ?? [];
      return { ...readTable(t, source.mapping), bankName: source.name };
    },
  };
}
