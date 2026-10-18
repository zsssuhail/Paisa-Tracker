import type { Paise, Person, Split, Transaction } from '@/data/types';
import { normalisePlace } from '@/features/rules/engine';

/** Split a total into n shares that add back up exactly; leftover paise go to the first shares. */
export function equalShares(totalPaise: Paise, n: number): Paise[] {
  if (n <= 0) return [];
  const base = Math.floor(totalPaise / n);
  const rem = totalPaise - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export interface FriendBalance {
  personId: string;
  /** Positive: they owe me. Negative: I owe them. */
  netPaise: Paise;
  openShares: { splitId: string; transactionId: string; sharePaise: Paise; iOwe: boolean }[];
}

export function friendBalances(splits: Split[], people: Person[]): FriendBalance[] {
  const map = new Map<string, FriendBalance>(people.map((p) => [p.id, { personId: p.id, netPaise: 0, openShares: [] }]));
  for (const s of splits) {
    if (s.paidBy === 'me') {
      for (const sh of s.shares) {
        if (sh.settledByTransactionId || sh.settledAt) continue;
        const b = map.get(sh.personId);
        if (!b) continue;
        b.netPaise += sh.sharePaise;
        b.openShares.push({ splitId: s.id, transactionId: s.transactionId, sharePaise: sh.sharePaise, iOwe: false });
      }
    } else {
      // A friend paid: I owe them my share, tracked on the payer's share row with personId = payer.
      const mine = s.shares.find((sh) => sh.personId === s.paidBy);
      const b = map.get(s.paidBy);
      if (!b || !mine || mine.settledByTransactionId || mine.settledAt) continue;
      b.netPaise -= s.myShareP;
      b.openShares.push({ splitId: s.id, transactionId: s.transactionId, sharePaise: s.myShareP, iOwe: true });
    }
  }
  return [...map.values()];
}

export function personMatches(person: Person, payee: string): boolean {
  const n = normalisePlace(payee);
  if (!n) return false;
  const names = [normalisePlace(person.name), ...person.aliases];
  return names.some((a) => a && (a === n || n.includes(a) || a.includes(n)));
}

export interface PaybackMatch {
  splitId: string;
  personId: string;
  sharePaise: Paise;
  exact: boolean;
}

/**
 * Which open share does an incoming UPI credit settle? Prefers the same person and
 * the exact amount; falls back to the same person's oldest open share.
 */
export function matchPayback(credit: Pick<Transaction, 'place' | 'amountPaise' | 'type'>, splits: Split[], people: Person[]): PaybackMatch[] {
  if (credit.type !== 'income') return [];
  const out: PaybackMatch[] = [];
  for (const person of people) {
    if (!personMatches(person, credit.place)) continue;
    for (const s of splits) {
      if (s.paidBy !== 'me') continue;
      for (const sh of s.shares) {
        if (sh.personId !== person.id || sh.settledByTransactionId || sh.settledAt) continue;
        out.push({ splitId: s.id, personId: person.id, sharePaise: sh.sharePaise, exact: sh.sharePaise === credit.amountPaise });
      }
    }
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact));
}
