import { parseMoney } from '@/data/money';
import { parseLooseDate, parseLooseTime } from '../dates';
import type { Direction, ImportFile, Parser, ParseResult, RawTransaction, Unreadable } from '../types';
import { cleanPayee, squash } from '../upi';

/**
 * Google Pay, from every place it can be exported:
 *  - Google Takeout "My Activity.html" / "My Activity.json" (Google Pay activity)
 *  - Takeout "Google transactions" CSV
 *  - the statement PDF from the app (Paid to / Received from, UPI Transaction ID)
 * Failed, cancelled and pending items are skipped.
 */

const ACTIVITY = /(Paid|Sent|Received)\s+(?:₹|INR|Rs\.?)\s?([\d,]+(?:\.\d{1,2})?)\s+(?:to|from)\s+(.+?)(?:\s+using\s+(.+?))?$/i;
const STATUS_BAD = /\b(?:failed|declined|cancelled|canceled|pending|expired|processing|refunded|reversed|rejected)\b/i;

function status(text: string): RawTransaction['status'] {
  if (/\bpending|processing\b/i.test(text)) return 'pending';
  if (STATUS_BAD.test(text)) return 'failed';
  return 'success';
}

function fromActivity(title: string, when: string, details: string, rowIndex: number): RawTransaction | Unreadable {
  const m = ACTIVITY.exec(squash(title));
  if (!m) return { text: title, reason: 'Not a payment' };
  const date = parseLooseDate(when.replace(/^\w+day,?\s*/i, ''), 'MDY') ?? parseLooseDate(when);
  if (!date) return { text: `${title} ${when}`, reason: "Couldn't read the date" };
  const direction: Direction = /received/i.test(m[1]) ? 'credit' : 'debit';
  const ref = /(?:UPI transaction ID|Transaction ID|UPI Ref(?:erence)?(?: No\.?)?)\s*:?\s*(\d{9,}|[A-Z0-9]{8,}\b)/i.exec(details)?.[1];
  return {
    date,
    time: parseLooseTime(when),
    amountPaise: parseMoney(m[2]) ?? 0,
    direction,
    description: squash(title),
    payee: cleanPayee(m[3]),
    rawPayee: m[3],
    upiRef: ref && /^\d{12}$/.test(ref) ? ref : undefined,
    reference: ref,
    account: m[4],
    status: status(details),
    rowIndex,
  };
}

function finish(rows: (RawTransaction | Unreadable)[]): ParseResult {
  const ok = rows.filter((r): r is RawTransaction => 'amountPaise' in r);
  const good = ok.filter((r) => r.status === 'success' && r.amountPaise > 0);
  return {
    rows: good,
    unreadable: rows.filter((r): r is Unreadable => 'reason' in r && r.reason !== 'Not a payment'),
    skipped: ok.length - good.length,
    bankName: 'Google Pay',
  };
}

function parseHtml(text: string): ParseResult {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const cells = [...doc.querySelectorAll('.outer-cell')];
  const out: (RawTransaction | Unreadable)[] = [];
  cells.forEach((cell, i) => {
    const content = [...cell.querySelectorAll('.content-cell')];
    const main = content[0];
    if (!main) return;
    const parts = (main.innerHTML.split(/<br\s*\/?>/i) ?? []).map((h) => squash(new DOMParser().parseFromString(h, 'text/html').body.textContent ?? ''));
    const title = parts[0] ?? '';
    const when = parts.find((p, j) => j > 0 && /\d{4}/.test(p) && /\d:\d{2}/.test(p)) ?? parts[1] ?? '';
    const details = content.map((c) => c.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).join(' ');
    out.push(fromActivity(title, when, details, i));
  });
  return finish(out);
}

function parseJson(text: string): ParseResult {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : [];
  const out: (RawTransaction | Unreadable)[] = list.map((e: { title?: string; time?: string; details?: { name?: string }[]; header?: string }, i: number) => {
    const iso = e.time ? new Date(e.time) : null;
    const when = iso
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(iso)
      : '';
    return fromActivity(e.title ?? '', when, (e.details ?? []).map((d) => d.name ?? '').join(' '), i);
  });
  return finish(out);
}

/**
 * Takeout "Google transactions" CSV: Time, Transaction ID, Description, Product, Payment method, Status, Amount.
 * These are purchases from Google itself (Google One, Play Store, YouTube), paid through GPay, so the
 * product is the payee and the description is what was bought.
 */
function parseTransactionsCsv(table: string[][]): ParseResult {
  const headerRow = Math.max(0, table.findIndex((r) => /transaction id/i.test(r.join('|')) && /amount/i.test(r.join('|'))));
  const header = table[headerRow].map((h) => h.toLowerCase().trim());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const [ti, ii, di, prod, si, ai, pi] = [col(/^time|^date/), col(/transaction id/), col(/description/), col(/^product/), col(/status/), col(/amount/), col(/payment method/)];
  const out: (RawTransaction | Unreadable)[] = table.slice(headerRow + 1).map((r, i) => {
    const desc = squash(r[di] ?? '');
    const amountText = r[ai] ?? '';
    const amount = parseMoney(amountText.replace(/[A-Z]{3}\s?/, ''));
    const date = parseLooseDate(r[ti] ?? '', 'MDY') ?? parseLooseDate(r[ti] ?? '');
    if (!date || amount == null) return { text: r.join(' | '), reason: 'Missing date or amount' };
    const product = squash(prod >= 0 ? r[prod] ?? '' : '');
    const credit = /^received|refund/i.test(desc) || (amount > 0 && /^\+/.test(amountText.trim()));
    const person = desc.replace(/^(?:paid|sent|payment)\s+(?:to\s+)?|^received\s+(?:from\s+)?/i, '');
    const payee = product && !/^(?:google pay|gpay|upi)$/i.test(product) ? product : cleanPayee(person);
    return {
      date,
      time: parseLooseTime(r[ti] ?? ''),
      amountPaise: Math.abs(amount),
      direction: credit ? 'credit' : 'debit',
      description: desc,
      payee,
      rawPayee: product || person,
      item: product && desc !== product ? desc.replace(new RegExp(String.raw`\s*\(${product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\)\s*$`), '') : undefined,
      reference: r[ii],
      upiRef: /^\d{12}$/.test(r[ii] ?? '') ? r[ii] : undefined,
      account: r[pi],
      status: status(r[si] ?? 'completed'),
      rowIndex: headerRow + i + 1,
    };
  });
  return finish(out);
}

/** The statement PDF from the Google Pay app: one entry spans several lines. */
function parsePdf(file: ImportFile): ParseResult {
  const lines = (file.lines ?? []).map((l) => squash(l.text));
  const out: (RawTransaction | Unreadable)[] = [];
  const START = /^(\d{1,2} [A-Za-z]{3},? \d{4})/;
  let block: string[] = [];
  const flush = () => {
    if (!block.length) return;
    const text = block.join(' ');
    const date = parseLooseDate(START.exec(block[0])?.[1] ?? '');
    const m = /(Paid to|Received from|Sent to)\s+(.+?)(?=\s+UPI Transaction ID|\s+(?:Paid|Received|Credited|Debited) (?:by|to|from)|\s+₹|$)/i.exec(text);
    const amount = /₹\s?([\d,]+(?:\.\d{1,2})?)/.exec(text);
    const ref = /UPI Transaction ID\s*:?\s*(\d{9,})/i.exec(text)?.[1];
    if (!date || !m || !amount) out.push({ text, reason: "Couldn't read this entry" });
    else
      out.push({
        date,
        time: parseLooseTime(text),
        amountPaise: parseMoney(amount[1]) ?? 0,
        direction: /received/i.test(m[1]) ? 'credit' : 'debit',
        description: text,
        payee: cleanPayee(m[2]),
        rawPayee: m[2],
        upiRef: ref,
        reference: ref,
        account: /(?:Paid|Credited|Debited) (?:by|to)\s+(.+?\d{4})/i.exec(text)?.[1],
        status: status(text),
        rowIndex: out.length,
      });
    block = [];
  };
  for (const line of lines) {
    if (START.test(line)) flush();
    if (START.test(line) || block.length) block.push(line);
  }
  flush();
  return finish(out);
}

export const googlePayParser: Parser = {
  id: 'googlepay',
  label: 'Google Pay',
  source: 'googlepay',
  detect(file) {
    if (file.kind === 'html') return /Google Pay/.test(file.text) && /outer-cell/.test(file.text) ? 0.95 : 0;
    if (file.kind === 'json') return /"header"\s*:\s*"Google Pay"/.test(file.text) || /"title"\s*:\s*"(?:Paid|Received|Sent) ₹/.test(file.text) ? 0.95 : 0;
    if (file.kind === 'pdf') return /UPI Transaction ID/i.test(file.text) && /(Paid to|Received from)/i.test(file.text) && !/PhonePe/i.test(file.text) ? 0.9 : 0;
    if (file.table?.[0]) {
      const h = file.table[0].join('|').toLowerCase();
      return /transaction id/.test(h) && /description/.test(h) && /status/.test(h) && /amount/.test(h) ? 0.85 : 0;
    }
    return 0;
  },
  parse(file) {
    if (file.kind === 'html') return parseHtml(file.text);
    if (file.kind === 'json') return parseJson(file.text);
    if (file.kind === 'pdf') return parsePdf(file);
    return parseTransactionsCsv(file.table ?? []);
  },
};
