import { clsx } from 'clsx';
import { Check, Link2, Plus, Undo2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { formatDay, todayISO } from '@/data/dates';
import { formatMoney } from '@/data/money';
import type { Transaction } from '@/data/types';
import { Button, EmptyState, Input } from '@/design/ui';
import { friendBalances, matchPayback, personMatches } from './math';
import { addPerson, settleShare, unsettleShare } from './actions';
import { saveTransaction } from '@/features/transactions/actions';

export default function FriendsScreen() {
  const people = useData((s) => s.people);
  const splits = useData((s) => s.splits);
  const txs = useData((s) => s.transactions);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const showToast = useUI((s) => s.showToast);
  const [name, setName] = useState('');

  const balances = useMemo(() => friendBalances(splits, people).sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise)), [splits, people]);
  const txById = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs]);
  const owedToMe = balances.reduce((s, b) => s + Math.max(0, b.netPaise), 0);
  const iOwe = balances.reduce((s, b) => s + Math.max(0, -b.netPaise), 0);

  // Incoming payments that look like paybacks and aren't linked to a bill yet.
  const linked = useMemo(() => new Set(splits.flatMap((s) => s.shares.map((sh) => sh.settledByTransactionId).filter(Boolean))), [splits]);
  const suggestions = useMemo(() => {
    const out: { tx: Transaction; splitId: string; personId: string; sharePaise: number }[] = [];
    for (const t of txs) {
      if (t.type !== 'income' || linked.has(t.id)) continue;
      const m = matchPayback(t, splits, people).find((x) => x.exact);
      if (m) out.push({ tx: t, splitId: m.splitId, personId: m.personId, sharePaise: m.sharePaise });
    }
    return out.slice(0, 5);
  }, [txs, splits, people, linked]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">Money with friends</h1>
          <p className="mt-1 text-sm text-ink-3">Split bills count only your share. Friends stay here until they pay you back.</p>
        </div>
        <Button variant="primary" onClick={() => openQuickAdd({ preset: { type: 'expense' } })} icon={<Plus size={18} />}>
          Split a bill
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:max-w-md" aria-label="Totals">
        <div className="rounded-2xl bg-mist p-4">
          <p className="text-sm text-ink-2">Friends owe you</p>
          <p className="num mt-1 text-2xl font-medium text-accent">{formatMoney(owedToMe)}</p>
        </div>
        <div className="rounded-2xl bg-shelf p-4">
          <p className="text-sm text-ink-2">You owe</p>
          <p className="num mt-1 text-2xl font-medium">{formatMoney(iOwe)}</p>
        </div>
      </section>

      {suggestions.length > 0 && (
        <section aria-labelledby="matches">
          <h2 id="matches" className="mb-3 text-[17px]">
            Looks like a payback
          </h2>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => {
              const bill = txById.get(splits.find((x) => x.id === s.splitId)?.transactionId ?? '');
              const person = people.find((p) => p.id === s.personId);
              return (
                <li key={s.tx.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-sheet p-4">
                  <Link2 size={18} className="text-accent" aria-hidden />
                  <p className="min-w-0 flex-1 text-[15px]">
                    <span className="num font-medium">{formatMoney(s.tx.amountPaise)}</span> from {s.tx.place} on {formatDay(s.tx.date)} matches {person?.name}'s share of <span className="font-medium">{bill?.item ?? 'a bill'}</span>.
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check size={16} />}
                    onClick={async () => {
                      await settleShare(s.splitId, s.personId, s.tx.id, s.tx.date);
                      showToast({ message: `${person?.name} is settled`, actionLabel: 'Undo', onAction: () => void unsettleShare(s.splitId, s.personId) });
                    }}
                  >
                    Settle
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="people">
        <h2 id="people" className="mb-3 text-[17px]">
          Friends
        </h2>
        {people.length === 0 ? (
          <EmptyState title="No friends added yet." body={'When you pay for a group, turn on "Split with friends" in the add sheet. Only your share counts as spending.'} />
        ) : (
          <ul className="flex flex-col gap-3">
            {balances.map((b) => {
              const person = people.find((p) => p.id === b.personId)!;
              const credits = txs.filter((t) => t.type === 'income' && !linked.has(t.id) && personMatches(person, t.place)).slice(0, 3);
              return (
                <li key={b.personId} className="card p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-shelf text-sm font-medium" aria-hidden>
                      {person.name
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <p className="flex-1 text-[15px] font-medium">{person.name}</p>
                    <p className={clsx('text-right text-sm', b.netPaise > 0 ? 'text-accent' : b.netPaise < 0 ? 'text-ink' : 'text-ink-3')}>
                      {b.netPaise > 0 ? (
                        <>
                          owes you <span className="num font-medium">{formatMoney(b.netPaise)}</span>
                        </>
                      ) : b.netPaise < 0 ? (
                        <>
                          you owe <span className="num font-medium">{formatMoney(-b.netPaise)}</span>
                        </>
                      ) : (
                        'all settled'
                      )}
                    </p>
                  </div>
                  {b.openShares.length > 0 && (
                    <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
                      {b.openShares.map((sh) => {
                        const bill = txById.get(sh.transactionId);
                        return (
                          <li key={sh.splitId} className="flex flex-wrap items-center gap-2 py-2.5">
                            <span className="min-w-0 flex-1 text-sm">
                              {bill?.item || 'Shared bill'} <span className="text-ink-3">· {bill ? formatDay(bill.date) : ''}</span>
                            </span>
                            <span className="num text-sm">{formatMoney(sh.sharePaise)}</span>
                            {sh.iOwe ? (
                              <Button
                                size="sm"
                                onClick={async () => {
                                  const t = await saveTransaction({
                                    date: todayISO(),
                                    type: 'transfer',
                                    subtype: 'settlement',
                                    amountPaise: sh.sharePaise,
                                    categoryId: null,
                                    item: `Paid ${person.name} back`,
                                    place: person.name,
                                    paymentMode: 'UPI',
                                    note: bill?.item ?? '',
                                  });
                                  await settleShare(sh.splitId, person.id, t.id);
                                  showToast({ message: `Recorded. You and ${person.name} are square.` });
                                }}
                              >
                                I paid
                              </Button>
                            ) : (
                              <>
                                {credits.map((c) => (
                                  <Button key={c.id} size="sm" variant="ghost" onClick={() => settleShare(sh.splitId, person.id, c.id, c.date)} icon={<Link2 size={14} />}>
                                    {formatMoney(c.amountPaise)} on {formatDay(c.date)}
                                  </Button>
                                ))}
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    await settleShare(sh.splitId, person.id);
                                    showToast({ message: 'Marked as paid', actionLabel: 'Undo', onAction: () => void unsettleShare(sh.splitId, person.id) });
                                  }}
                                >
                                  Paid in cash
                                </Button>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="mt-4 flex max-w-md gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await addPerson(name.trim());
            setName('');
          }}
        >
          <Input aria-label="Friend's name" placeholder="Add a friend" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" icon={<UserPlus size={16} />}>
            Add
          </Button>
        </form>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          <Undo2 size={12} aria-hidden /> Linking a UPI payback teaches me that friend's UPI name, so the next one matches by itself.
        </p>
      </section>
    </div>
  );
}
