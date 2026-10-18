import type { Direction } from './types';

/** Bank / PSP codes that appear as their own segment in UPI narrations. */
const BANK_CODES = new Set([
  'YES', 'SBI', 'SBIN', 'IOB', 'IOBA', 'HDFC', 'HDFCBANK', 'ICICI', 'ICIC', 'AXIS', 'UTIB', 'KOTAK', 'KKBK', 'CNRB', 'CANARA', 'PNB', 'PUNB',
  'BOB', 'BARB', 'UBI', 'UBIN', 'IDFC', 'IDFB', 'INDB', 'INDUSIND', 'FDRL', 'FED', 'PAYTM', 'PYTM', 'AIRTEL', 'AIRP', 'IPOS', 'KVB', 'KVBL', 'TMB',
  'TMBL', 'CUB', 'CIUB', 'IDIB', 'INDIAN', 'BKID', 'MAHB', 'CBIN', 'UCBA', 'JIOP', 'AUBL', 'ESFB', 'RATN', 'DBSS', 'SIBL', 'CSBK', 'NSDL',
  'CNR', 'FDR', 'HDF', 'UTI', 'BAR', 'IDI', 'IPO', 'ICI', 'PUN', 'KKB', 'AXI', 'IDF', 'IND', 'KAR', 'KVG', 'CIU', 'SIB', 'AUB', 'RAT', 'DBS', 'JIO', 'AIR', 'PYT', 'BKI', 'MAH', 'CBI', 'UCB', 'ESF', 'CSB', 'NSD', 'SCB', 'HSB', 'CIT', 'IPPB', 'YBL', 'OKAXIS', 'OKSBI', 'OKHDFC', 'OKICICI', 'IBL', 'AXL',
]);

/**
 * Bank text is usually SHOUTED: then every word is title-cased ("ANNATCHI FAMOU" → "Annatchi Famou",
 * single initials stay: "SRINIVAS S" → "Srinivas S"). When the name already has mixed case,
 * its short all-caps words are acronyms and are kept ("CSA Automobile").
 */
export function titleCase(s: string): string {
  const shouted = s === s.toUpperCase();
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      if (/^[A-Z]\.?$/.test(w)) return w;
      if (!shouted && /^[A-Z&]{2,3}$/.test(w)) return w;
      // Mixed case ("McDonald") is the owner's own spelling; IDs with digits or dots stay as they are.
      if (!shouted && w !== w.toUpperCase() && w !== w.toLowerCase()) return w;
      if (!/^[\p{L}'&-]+$/u.test(w)) return w;
      return w.toLowerCase().replace(/(^|[-'(&.])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
    })
    .join(' ');
}

export function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Bank identifiers that are never part of a person's or shop's name (IFSC prefixes and full bank names).
 * Short codes like BAR, IND or AIRTEL are only treated as banks by their position in a narration.
 */
const STRIP_FROM_NAMES = new Set(['SBI', 'IOB', 'YES', 'AXIS', 'KOTAK', 'CANARA', 'PNB', 'IDFC', 'INDUSIND', 'FEDERAL', 'KVB', 'TMB', 'CUB', 'SBIN', 'IOBA', 'HDFC', 'HDFCBANK', 'ICIC', 'ICICI', 'UTIB', 'KKBK', 'CNRB', 'PUNB', 'BARB', 'UBIN', 'IDFB', 'INDB', 'FDRL', 'YESB', 'KVBL', 'TMBL', 'CIUB', 'IDIB', 'BKID', 'MAHB', 'CBIN', 'UCBA', 'AUBL', 'ESFB', 'RATN', 'DBSS', 'SIBL', 'CSBK', 'IPOS', 'OKAXIS', 'OKSBI', 'OKHDFC', 'OKICICI', 'YBL', 'IBL', 'AXL']);

/** Strip transfer-mode prefixes and bank codes from a free-text payee. */
export function cleanPayee(s: string): string {
  let t = squash(s)
    .replace(/^(?:UPI|IMPS|NEFT|RTGS|MMT|BIL|POS|ECOM|ACH|NACH)[-/ ]+/i, '')
    .replace(/^(?:paid to|received from|sent to|payment to|payment from|to|from|by)\s+/i, '')
    .replace(/@[\w.]+/g, '') // VPA handles
    .replace(/\b\d{9,}\b/g, '') // reference numbers
    .replace(/\s*\/\s*/g, ' ');
  t = t
    .split(' ')
    .filter((w) => !STRIP_FROM_NAMES.has(w.toUpperCase()) && !/^(?:DR|CR|UPI|P2A|P2M|P2P)$/i.test(w))
    .join(' ');
  t = squash(t.replace(/[^\p{L}\p{N}&.' -]+/gu, ' '));
  return titleCase(t);
}

export interface UpiParts {
  upiRef?: string;
  direction?: Direction;
  payee: string;
  rawPayee: string;
  bank?: string;
  note?: string;
  /** IMPS/NEFT reference (UPI refs go in upiRef). */
  transferRef?: string;
  /** Top-up of UPI Lite: money moved to my own wallet. */
  lite?: boolean;
}

/**
 * Words apps append to a narration that say nothing about the payment: the UPI app's own tags
 * ("UPIIntent", "collect-p", "StaticQR", "LiteEnable"), truncated boilerplate ("Payment f…",
 * "Sent using Paytm…") and placeholders ("na", "UPI").
 */
const NOISE_NOTE =
  /^(?:upi|upi ?intent|intent|na|n\/a|nil|null|none|ok|test|collect(?:[- ]?p(?:ay)?(?:ment)?)?|static ?qr|dynamic ?qr|qr(?: ?code)?|lite ?enable|upi ?lite|p2[pma]|pay(?:ment)?(?: (?:f|fr|fro|from|to|via|for|request|done)\b.*)?|payment f.*|sent (?:using|from|via|by).*|paid (?:via|using|by|from).*|req(?:uest)?(?: money)?|mandate.*|autopay.*|bill ?pay(?:ment)?|recharge|transfer|imps|neft|rtgs|fund transfer|ib|mb|mobile banking|net banking)$/i;

/** App tags as they appear when the bank cuts them short ("UPI Inten", "Payment fr", "Sent using Pay"). */
const NOISE_PHRASES = ['upiintent', 'upi intent', 'payment from phonepe', 'payment from paytm', 'sent using paytm upi', 'collect pay', 'collect request', 'staticqr', 'static qr', 'liteenable', 'paid via cred', 'pay to merchant'];

/** A user's own words worth keeping ("dinner", "fruit"), never app noise, IDs or a repeat of the payee. */
export function meaningfulNote(note: string | undefined, payee = ''): string | undefined {
  const n = squash(note ?? '');
  const lower = n.toLowerCase();
  if (n.length < 2 || NOISE_NOTE.test(n)) return undefined;
  if (lower.length >= 4 && NOISE_PHRASES.some((p) => p.startsWith(lower) || p.replace(/ /g, '').startsWith(lower.replace(/ /g, '')))) return undefined;
  if (/^[\dX*#-]+$/i.test(n) || (/\d{4,}/.test(n) && !/\s/.test(n))) return undefined;
  const first = n.toLowerCase().split(' ')[0];
  if (first.length >= 3 && payee.toLowerCase().split(' ').some((w) => w.startsWith(first) || (w.length >= 3 && first.startsWith(w)))) return undefined;
  return n;
}

const looksLikeBankCode = (s = '') => /^[A-Za-z]{2,6}\d{0,2}$/.test(s.trim()) && !/\s/.test(s.trim());

/**
 * Parse an Indian bank UPI narration. The slots are fixed: UPI / reference / DR|CR / payee / bank / note.
 *   UPI/629032644176/DR/CSA Automobile/YES/UPI   → payee "CSA Automobile", debit
 *   UPI/628982348642/CR/ SRINIVAS S/IOB/dinner    → payee "Srinivas S", credit, note "dinner"
 * Also handles the hyphen style (UPI-NAME-vpa@bank-IFSC-REF-NOTE) used by HDFC/SBI.
 */
export function parseUpiNarration(input: string): UpiParts | null {
  const s = squash(input);
  if (!/^\s*UPI\b/i.test(s) && !/\bUPI\//i.test(s)) return null;

  const slash = s.slice(s.search(/UPI/i)).split('/').map((p) => p.trim());
  if (slash.length >= 4 && /^UPI$/i.test(slash[0])) {
    const [, ref, dir, payeeRaw = '', bank, ...rest] = slash;
    const direction: Direction | undefined = /^DR$/i.test(dir) ? 'debit' : /^CR$/i.test(dir) ? 'credit' : undefined;
    const bankCode = bank && (BANK_CODES.has(bank.toUpperCase()) || looksLikeBankCode(bank)) ? bank.toUpperCase() : undefined;
    // Without a recognisable bank slot the payee may contain a "/" of its own.
    const payeeText = bankCode || !bank ? payeeRaw : `${payeeRaw}/${bank}`;
    const noteRaw = rest.join('/').trim();
    const payee = cleanPayee(payeeText);
    return {
      upiRef: /^\d{6,}$/.test(ref) ? ref : undefined,
      direction,
      rawPayee: payeeText,
      payee,
      bank: bankCode,
      note: meaningfulNote(noteRaw, payee),
      lite: /lite/i.test(noteRaw),
    };
  }

  // UPI-CSA AUTOMOBILE-csa@okaxis-UTIB0001234-629032644176-Petrol
  const dash = s.split('-').map((p) => p.trim());
  if (dash.length >= 3 && /^UPI$/i.test(dash[0])) {
    const refIdx = dash.findIndex((p) => /^\d{9,}$/.test(p));
    const payeeRaw = dash[1];
    const payee = cleanPayee(payeeRaw);
    const note = refIdx >= 0 && dash[refIdx + 1] ? meaningfulNote(dash.slice(refIdx + 1).join('-'), payee) : undefined;
    return { upiRef: refIdx >= 0 ? dash[refIdx] : undefined, rawPayee: payeeRaw, payee, note };
  }
  return null;
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;

/**
 * IMPS / NEFT / RTGS narrations: IMPS/619917580047/SHAHUL /SBIN/XXXXXX5972/Bill,
 * NEFT/SBIN426123456789/RAMESH KUMAR/…, NEFT-UTIBR52026…-NAME-…
 * The reference, bank codes, IFSC and masked account numbers are dropped; the name and any real note stay.
 */
export function parseTransferNarration(input: string): UpiParts | null {
  const s = squash(input);
  const m = /^(IMPS|NEFT|RTGS|MMT|INB|IFT)\b[\s/:-]*(.*)$/i.exec(s);
  if (!m) return null;
  const parts = m[2].split(/\s*[/-]\s*/).map((p) => p.trim()).filter(Boolean);
  const isRef = (p: string) => /\d{6,}/.test(p) && !/\s/.test(p) && !/^X+\d+$/i.test(p);
  const isNoise = (p: string) => isRef(p) || IFSC.test(p) || /^X{2,}\d*$/i.test(p) || /^\d+$/.test(p) || BANK_CODES.has(p.toUpperCase()) || /^(?:P2A|P2P|DR|CR|INW|OUTW|IMPS|NEFT|RTGS)$/i.test(p);
  const ref = parts.find(isRef);
  const nameIdx = parts.findIndex((p) => !isNoise(p) && /[A-Za-z]{2,}/.test(p));
  const rawPayee = nameIdx >= 0 ? parts[nameIdx] : '';
  const payee = cleanPayee(rawPayee);
  const tail = parts.slice(nameIdx + 1).filter((p) => !isNoise(p));
  return { upiRef: undefined, transferRef: ref, rawPayee, payee, note: meaningfulNote(tail[tail.length - 1], payee) };
}

/** Any recognisable narration: UPI first, then bank transfers. */
export function parseNarration(input: string): UpiParts | null {
  return parseUpiNarration(input) ?? parseTransferNarration(input);
}

/**
 * PDFs wrap long narrations onto a second line ("SHRI RAMANA" + "ME/YES/UPI").
 * Rejoin continuation text onto the description it belongs to.
 */
export function joinWrapped(first: string, next: string): string {
  const a = first.trimEnd();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith('/') || a.endsWith('-') || b.startsWith('/') || b.startsWith('-')) return a + b;
  return `${a} ${b}`;
}
