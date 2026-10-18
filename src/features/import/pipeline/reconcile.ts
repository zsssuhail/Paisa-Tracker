import type { Paise } from '@/data/types';
import type { RawTransaction } from '../types';

export interface Reconciliation {
  checked: boolean;
  opening: Paise;
  closing: Paise;
  credits: Paise;
  debits: Paise;
  balanced: boolean;
  /** Rows after which the running balance jumps: something between them may be missing. */
  gaps: { after: RawTransaction; before: RawTransaction; differencePaise: Paise }[];
}

/**
 * For statements with a running balance: opening + credits − debits must equal closing,
 * and each row's balance must follow from the one before it. A jump means a missing row.
 */
export function reconcile(rows: RawTransaction[]): Reconciliation | null {
  const withBalance = rows.filter((r) => r.balancePaise != null);
  if (withBalance.length < 2 || withBalance.length < rows.length * 0.8) return null;
  const ordered = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const signed = (r: RawTransaction) => (r.direction === 'credit' ? r.amountPaise : -r.amountPaise);

  // Statements are printed oldest-first or newest-first; pick the order the balances agree with.
  const fits = (list: RawTransaction[]) => {
    let ok = 0;
    for (let i = 1; i < list.length; i++) if (list[i - 1].balancePaise! + signed(list[i]) === list[i].balancePaise) ok++;
    return ok;
  };
  const reversed = [...ordered].reverse();
  const seq = fits(reversed) > fits(ordered) ? reversed : ordered;

  const first = seq[0];
  const last = seq[seq.length - 1];
  const opening = first.balancePaise! - signed(first);
  let credits = 0;
  let debits = 0;
  for (const r of seq) {
    if (r.direction === 'credit') credits += r.amountPaise;
    else debits += r.amountPaise;
  }
  const gaps: Reconciliation['gaps'] = [];
  for (let i = 1; i < seq.length; i++) {
    const expected = seq[i - 1].balancePaise! + signed(seq[i]);
    if (seq[i].balancePaise != null && seq[i - 1].balancePaise != null && expected !== seq[i].balancePaise) {
      gaps.push({ after: seq[i - 1], before: seq[i], differencePaise: seq[i].balancePaise! - expected });
    }
  }
  const closing = last.balancePaise!;
  return { checked: true, opening, closing, credits, debits, balanced: opening + credits - debits === closing && gaps.length === 0, gaps };
}
