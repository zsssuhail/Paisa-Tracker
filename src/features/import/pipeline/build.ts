import type { Category, Person, Rule, SourceKind, Transaction } from '@/data/types';
import { diffDays } from '@/data/dates';
import { normalisePlace, suggestCategory, type Confidence } from '@/features/rules/engine';
import { personMatches } from '@/features/friends/math';
import { classify, pairVerifications, type Classified } from '../classify';
import { canonicalPayee } from '../payees';
import { parseMoney } from '@/data/money';
import type { RawTransaction } from '../types';

export type CandidateStatus = 'new' | 'duplicate' | 'merge';

export interface Candidate {
  key: string;
  raw: RawTransaction;
  cls: Classified;
  /** Stable identity of this row in this source. */
  importRef: string;
  status: CandidateStatus;
  /** Existing transaction this row is the same payment as. */
  mergeWithId?: string;
  categoryId: string | null;
  item: string;
  confidence: Confidence;
  reason: string;
  /** Included in the save. Unchecking leaves a row out on purpose. */
  approved: boolean;
  needsReview: boolean;
  /** Paid for a group: friends' ids; only my equal share is recorded. */
  splitWith?: string[];
}

/** Small, fast, deterministic string hash (FNV-1a) for import references. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function tokens(s: string) {
  return new Set(normalisePlace(s).split(' ').filter((w) => w.length > 1));
}

/** Token overlap of two payee names, 0..1. Truncated bank names still overlap well. */
export function payeeSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w) || [...B].some((x) => (x.length >= 4 && w.startsWith(x)) || (w.length >= 4 && x.startsWith(w)))) common++;
  return common / Math.min(A.size, B.size);
}

/** Money out matches expenses, money in matches income; transfers can go either way. */
function sameDirection(dir: RawTransaction['direction'], t: Pick<Transaction, 'type'>) {
  if (t.type === 'expense') return dir === 'debit';
  if (t.type === 'income') return dir === 'credit';
  return true;
}

/** Rupee amounts written in a note: "Paid ₹1,100 for the table; Srinivas ₹235…" → [110000, 23500]. */
export function amountsIn(note?: string): number[] {
  if (!note) return [];
  return [...note.matchAll(/(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:\.\d{1,2})?)/gi)].map((m) => parseMoney(m[1]) ?? 0).filter((n) => n > 0);
}

const fromNotebook = (t: Pick<Transaction, 'sources'>) => t.sources.some((s) => s.kind === 'manual' || s.parser === 'legacy-sheet');

/**
 * Is `raw` the same payment as an existing transaction from another source?
 * - Same amount, date within ±1 day, and the UPI reference matches — or, without a reference, the payee looks the same.
 * - A notebook entry (spreadsheet or typed in) that records only my share of a bill links to the bank's full
 *   payment when its note mentions that amount ("Paid ₹1,100 for the table").
 * Never merges two rows from the same source (two ₹20 teas are two teas).
 */
export function findSamePayment(
  c: { raw: RawTransaction; upiRef?: string; payee: string; note?: string },
  existing: Transaction[],
  sourceKind: SourceKind,
  parserId: string,
): Transaction | undefined {
  let best: { t: Transaction; score: number } | undefined;
  const candidateIsNotebook = parserId === 'legacy-sheet';
  for (const t of existing) {
    if (!sameDirection(c.raw.direction, t)) continue;
    if (Math.abs(diffDays(t.date, c.raw.date)) > 1) continue;
    if (t.sources.some((s) => s.kind === sourceKind && s.parser === parserId)) continue;
    const sim = Math.max(payeeSimilarity(c.payee, t.place), payeeSimilarity(c.payee, t.rawPayee ?? ''));
    const sameDay = t.date === c.raw.date ? 0.2 : 0;
    if (t.amountPaise === c.raw.amountPaise) {
      if (c.upiRef && t.upiRef) {
        if (c.upiRef === t.upiRef) return t;
        continue;
      }
      if (sim >= 0.5 && (!best || sim + sameDay + 1 > best.score)) best = { t, score: sim + sameDay + 1 };
      continue;
    }
    // My share in the notebook ↔ the full amount at the bank.
    const shareLink =
      (candidateIsNotebook && !fromNotebook(t) && amountsIn(c.note).includes(t.amountPaise)) ||
      (!candidateIsNotebook && fromNotebook(t) && amountsIn(t.note).includes(c.raw.amountPaise));
    if (shareLink && sim >= 0.34 && (!best || sim + sameDay > best.score)) best = { t, score: sim + sameDay };
  }
  return best?.t;
}

export interface BuildContext {
  existing: Transaction[];
  rules: Rule[];
  people: Person[];
  categories: Category[];
  sourceKind: SourceKind;
  parserId: string;
  /** Statement holder: payments to this name are my own money moving. */
  holderName?: string;
}

/** Stable identity of a row: the UPI or bank reference when there is one, so overlapping statements dedupe. */
export function rowIdentity(parserId: string, raw: RawTransaction, n: number): string {
  const ref = raw.upiRef ?? (raw.reference && /^[A-Z0-9]{6,}$/i.test(raw.reference) ? raw.reference : undefined);
  if (ref) return hash(`${parserId}|ref:${ref}|${raw.amountPaise}|${raw.direction}`);
  return hash(`${parserId}|${raw.date}|${raw.amountPaise}|${raw.direction}|${normalisePlace(raw.description)}|${n}`);
}

/** Raw rows → reviewable candidates with type, category guess, and duplicate/merge status. */
export function buildCandidates(rows: RawTransaction[], ctx: BuildContext): Candidate[] {
  // Every reference a saved transaction carries, including ones merged into it from other files.
  const byRef = new Set(ctx.existing.flatMap((t) => [t.importRef, ...t.sources.map((s) => s.ref)]).filter((r): r is string => Boolean(r)));
  const byId = new Map(ctx.existing.map((t) => [t.id, t]));
  const occurrences = new Map<string, number>();
  const catByName = new Map(ctx.categories.map((c) => [c.name.toLowerCase(), c.id]));

  // Places the notebook already knows, best first: names the person typed beat bank text.
  const knownPlaces = [...new Set([...ctx.existing].sort((a, b) => Number(fromNotebook(b)) - Number(fromNotebook(a))).map((t) => t.place).filter(Boolean))];
  const staged = rows.map((raw) => {
    const cls = classify(raw, { holderName: ctx.holderName });
    // Friend paybacks: a credit from someone already in Money with friends.
    if (cls.type === 'income' && ctx.people.some((p) => personMatches(p, cls.payee))) cls.subtype = 'payback';
    if (raw.subtypeHint && cls.type === 'income') cls.subtype = raw.subtypeHint;
    if (cls.type === 'expense' || (cls.type === 'income' && cls.subtype !== 'interest' && cls.subtype !== 'scholarship')) cls.payee = canonicalPayee(cls.payee, knownPlaces);
    return { raw, cls };
  });
  pairVerifications(staged);

  // Pass 1: identity, duplicates and merges.
  const seen = new Set<string>();
  const matched = staged.map(({ raw, cls }) => {
    // Identity ignores row position so a re-exported file with extra rows still dedupes.
    const base = `${ctx.parserId}|${raw.date}|${raw.amountPaise}|${raw.direction}|${normalisePlace(raw.description)}|${raw.upiRef ?? ''}`;
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    const importRef = rowIdentity(ctx.parserId, raw, n);
    // Rows saved before references were used for identity.
    const legacyRef = hash(`${base}|${n}`);
    let status: CandidateStatus = 'new';
    let mergeWithId: string | undefined;
    if (byRef.has(importRef) || byRef.has(legacyRef) || seen.has(importRef)) status = 'duplicate';
    else {
      const same = findSamePayment({ raw, upiRef: cls.upiRef, payee: cls.payee, note: raw.note }, ctx.existing, ctx.sourceKind, ctx.parserId);
      if (same) {
        status = 'merge';
        mergeWithId = same.id;
      }
    }
    if (status !== 'duplicate') seen.add(importRef);
    return { raw, cls, importRef, status, mergeWithId };
  });

  // What merges teach: the bank calls it "Shri Ramana", the notebook calls it Ramana canteen / Tea & Vada.
  const aliases = new Map<string, { categoryId: string; item: string }>();
  for (const m of matched) {
    const t = m.mergeWithId ? byId.get(m.mergeWithId) : undefined;
    if (t?.categoryId && m.cls.type === 'expense') aliases.set(normalisePlace(m.cls.payee), { categoryId: t.categoryId, item: t.item });
  }

  // Pass 2: categories.
  const accepted: Transaction[] = [];
  return matched.map(({ raw, cls, importRef, status, mergeWithId }, i) => {
    let categoryId: string | null = null;
    let item = raw.item ?? cls.item ?? '';
    let confidence: Confidence = 'high';
    let reason = '';
    let needsReview = false;
    const target = mergeWithId ? byId.get(mergeWithId) : undefined;
    if (cls.type === 'expense' && !cls.excluded) {
      const alias = aliases.get(normalisePlace(cls.payee));
      if (raw.categoryName) {
        categoryId = catByName.get(raw.categoryName.toLowerCase()) ?? null;
        reason = categoryId ? 'From your spreadsheet' : `New category “${raw.categoryName}”`;
      } else if (cls.categoryId) {
        categoryId = cls.categoryId;
        reason = 'Bank charge';
      } else if (target?.categoryId) {
        categoryId = target.categoryId;
        item = item || target.item;
        reason = `Already in your notebook as ${target.place}`;
      } else if (alias) {
        categoryId = alias.categoryId;
        item = item || alias.item;
        reason = 'Same place as an entry in your notebook';
      } else {
        const s = suggestCategory({ place: cls.payee, item, amountPaise: raw.amountPaise }, ctx.rules, [...ctx.existing, ...accepted]);
        categoryId = s.categoryId;
        item = item || s.item || '';
        confidence = s.confidence;
        reason = s.reason;
        needsReview = s.needsReview;
      }
    } else {
      reason = cls.excluded ? 'Bank check, ignored' : cls.type === 'transfer' ? 'Not spending' : 'Money in';
    }

    const candidate: Candidate = {
      key: `${i}-${importRef}`,
      raw,
      cls,
      importRef,
      status,
      mergeWithId,
      categoryId,
      item,
      confidence,
      reason,
      // Everything new is saved; uncertain rows are highlighted and land in the Needs-a-category inbox.
      approved: status !== 'duplicate',
      needsReview,
    };
    // Let later rows in the same file learn from earlier confident ones.
    if (categoryId && confidence === 'high') accepted.push({ place: cls.payee, categoryId, type: 'expense', item } as Transaction);
    return candidate;
  });
}

export function summarise(cands: Candidate[], unreadable: number, skipped: number) {
  const fresh = cands.filter((c) => c.status === 'new');
  return {
    found: cands.length,
    added: fresh.length,
    duplicates: cands.filter((c) => c.status === 'duplicate').length,
    merged: cands.filter((c) => c.status === 'merge').length,
    needCategory: fresh.filter((c) => c.cls.type === 'expense' && !c.cls.excluded && !c.categoryId).length,
    unreadable,
    skipped,
  };
}
