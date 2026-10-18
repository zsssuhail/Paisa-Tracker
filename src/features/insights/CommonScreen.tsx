import { clsx } from 'clsx';
import { ArrowLeft, Repeat2, Target } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { addDays, addMonths, daysElapsed, periodFor, shiftPeriod } from '@/data/dates';
import { formatMoney, roundRupee } from '@/data/money';
import { useCategoryMap, useToday, categoryColour } from '@/data/selectors';
import { Button, EmptyState } from '@/design/ui';
import { Icon } from '@/design/icons';
import { roundNice, spentByCategory } from '@/features/budget/math';
import { setCategoryLimitNow } from '@/features/budget/actions';
import { createRecurring } from '@/features/recurring/run';
import { buildsTo } from '@/features/goals/math';
import { normalisePlace } from '@/features/rules/engine';
import { byCategory, pct, repeatingPayments, topPlaces, totalOf, type Cadence } from './aggregate';

const CADENCE: Record<Cadence, string> = { daily: 'Almost daily', weekly: 'Weekly', monthly: 'Monthly' };

/** "Where my money usually goes": regular categories, places and repeating payments, each one tap from a limit or a recurring item. */
export default function CommonScreen() {
  const txs = useData((s) => s.transactions);
  const recurring = useData((s) => s.recurring);
  const budgets = useData((s) => s.budgets);
  const startDay = useData((s) => s.settings.monthStartDay);
  const cats = useCategoryMap();
  const today = useToday();
  const showToast = useUI((s) => s.showToast);

  const current = periodFor(today, startDay);
  const range = { from: shiftPeriod(current, -3, startDay).start, to: today };
  const months = 3 + daysElapsed(current, today) / current.days;

  const categories = useMemo(() => byCategory(txs, range).filter((c) => c.categoryId !== 'uncategorised').slice(0, 10), [txs, range.from, range.to]);
  const places = useMemo(() => topPlaces(txs, range, 10), [txs, range.from, range.to]);
  const all = useMemo(() => totalOf(byCategory(txs, range)), [txs, range.from, range.to]);
  const patterns = useMemo(() => repeatingPayments(txs, { from: addDays(today, -90), to: today }).slice(0, 8), [txs, today]);
  const tracked = new Set(recurring.map((r) => normalisePlace(r.place || r.name)));
  const budget = budgets.find((b) => b.id === current.start);
  const limited = new Set(budget?.allocations.filter((a) => a.targetType === 'category').map((a) => a.targetId));

  // Savings opportunities: this month on pace vs the 3-month average.
  const opportunities = useMemo(() => {
    const now = spentByCategory(txs, current, today);
    const elapsed = Math.max(1, daysElapsed(current, today));
    const prev = [1, 2, 3].map((i) => spentByCategory(txs, shiftPeriod(current, -i, startDay)));
    return [...now.entries()]
      .filter(([id]) => id !== 'uncategorised')
      .map(([id, spent]) => {
        const avg = roundRupee(prev.reduce((s, m) => s + (m.get(id) ?? 0), 0) / 3);
        const projected = roundRupee((spent / elapsed) * current.days);
        return { id, spent, projected, avg, saving: roundNice(Math.max(0, projected - avg)) };
      })
      .filter((o) => o.avg > 0 && o.projected - o.avg >= 10_000 && !txs.some((t) => t.bigItem && t.categoryId === o.id && t.date >= current.start))
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 3);
  }, [txs, current, today, startDay]);

  const setLimit = async (categoryId: string, monthly: number) => {
    const amount = roundNice(monthly);
    await setCategoryLimitNow(categoryId, amount);
    showToast({ message: `${cats.get(categoryId)?.name}: limit ${formatMoney(amount)} this month` });
  };

  return (
    <div className="flex flex-col gap-10">
      <header className="flex items-start gap-2">
        <Link to="/insights" aria-label="Back to insights" className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-shelf">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-[28px] leading-tight">Where my money usually goes</h1>
          <p className="mt-1 text-sm text-ink-3">The last three months and this one so far.</p>
        </div>
      </header>

      {all === 0 ? (
        <EmptyState art="chart" title="Not enough history yet." body="Add or import a few weeks of payments and your regular spending shows up here." />
      ) : (
        <>
          {opportunities.length > 0 && (
            <section aria-labelledby="opps" className="flex flex-col gap-3">
              <h2 id="opps" className="text-[17px]">
                Realistic savings
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex flex-col gap-3 rounded-card bg-mist p-5">
                    <p className="text-[15px]">
                      <span className="font-medium">{cats.get(o.id)?.name}</span> is heading for <span className="num font-medium">{formatMoney(o.projected)}</span> this month, against a{' '}
                      <span className="num">{formatMoney(o.avg)}</span> 3-month average.
                    </p>
                    <p className="text-sm text-ink-2">
                      Keeping to the average saves about <span className="num font-medium text-ink">{formatMoney(o.saving)}</span> a month: <span className="num">{formatMoney(buildsTo(o.saving, 6))}</span> in 6 months,{' '}
                      <span className="num">{formatMoney(buildsTo(o.saving, 12))}</span> in a year.
                    </p>
                    <Button size="sm" variant="primary" className="self-start" onClick={() => setLimit(o.id, o.avg)} icon={<Target size={16} />}>
                      Set a {formatMoney(roundNice(o.avg))} limit
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="repeats" className="flex flex-col gap-3">
            <div>
              <h2 id="repeats" className="text-[17px]">
                Payments that repeat
              </h2>
              <p className="text-sm text-ink-3">Turn any of them into a recurring item or a budget line.</p>
            </div>
            {patterns.length === 0 ? (
              <p className="text-sm text-ink-3">No repeating payments spotted yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-sheet">
                {patterns.map((p) => {
                  const c = p.categoryId ? cats.get(p.categoryId) : undefined;
                  const isTracked = tracked.has(p.key);
                  return (
                    <li key={p.key} className="flex flex-wrap items-center gap-3 p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${categoryColour(c)} 15%, transparent)`, color: categoryColour(c) }}>
                        <Icon name={c?.icon ?? 'package'} size={18} />
                      </span>
                      <div className="min-w-[10rem] flex-1">
                        <p className="truncate text-[15px]">
                          {p.place}
                          <span className="ml-2 rounded bg-shelf px-1.5 py-0.5 text-[11px] text-ink-2">{CADENCE[p.cadence]}</span>
                        </p>
                        <p className="text-[13px] text-ink-3">
                          About <span className="num text-ink-2">{formatMoney(p.typicalPaise)}</span> each time, <span className="num text-ink-2">{formatMoney(p.perMonthPaise)}</span> a month
                        </p>
                      </div>
                      <div className="flex w-full justify-end gap-2 sm:w-auto">
                        {p.categoryId && !limited.has(p.categoryId) && (
                          <Button size="sm" variant="ghost" onClick={() => setLimit(p.categoryId!, p.perMonthPaise)}>
                            Set a limit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={isTracked}
                          icon={<Repeat2 size={15} />}
                          onClick={async () => {
                            await createRecurring({
                              name: p.item || p.place,
                              amountPaise: p.typicalPaise,
                              categoryId: p.categoryId,
                              place: p.place,
                              paymentMode: 'UPI',
                              frequency: p.cadence === 'monthly' ? 'monthly' : 'weekly',
                              nextDue: p.cadence === 'monthly' ? addMonths(p.lastDate, 1) : addDays(p.lastDate, 7),
                              mode: 'remind',
                            });
                            showToast({ message: `${p.place} is now recurring` });
                          }}
                        >
                          {isTracked ? 'Recurring' : 'Make recurring'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
            <section aria-labelledby="common-cats" className="lg:col-span-7">
              <h2 id="common-cats" className="mb-3 text-[17px]">
                Top 10 categories
              </h2>
              <Table
                rows={categories.map((c) => ({
                  key: c.categoryId,
                  name: cats.get(c.categoryId)?.name ?? 'Other',
                  icon: cats.get(c.categoryId)?.icon,
                  colour: categoryColour(cats.get(c.categoryId)),
                  perMonth: roundRupee(c.total / months),
                  visits: c.count / months,
                  avg: roundRupee(c.total / c.count),
                  share: pct(c.total, all),
                  action: !limited.has(c.categoryId) ? () => setLimit(c.categoryId, c.total / months) : undefined,
                }))}
              />
            </section>
            <section aria-labelledby="common-places" className="lg:col-span-5">
              <h2 id="common-places" className="mb-3 text-[17px]">
                Top 10 places
              </h2>
              <Table
                rows={places.map((p) => ({
                  key: p.key,
                  name: p.place,
                  icon: p.topCategoryId ? cats.get(p.topCategoryId)?.icon : undefined,
                  colour: categoryColour(p.topCategoryId ? cats.get(p.topCategoryId) : undefined),
                  perMonth: roundRupee(p.total / months),
                  visits: p.visits / months,
                  avg: p.average,
                  share: pct(p.total, all),
                }))}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Table({
  rows,
}: {
  rows: { key: string; name: string; icon?: string; colour: string; perMonth: number; visits: number; avg: number; share: number; action?: () => void }[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 py-3">
          <span style={{ color: r.colour }}>
            <Icon name={r.icon ?? 'package'} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px]">{r.name}</p>
            <p className="text-[13px] text-ink-3">
              {r.visits >= 1 ? `${Math.round(r.visits)}×` : 'Under once'} a month, <span className="num">{formatMoney(r.avg)}</span> per visit, {r.share}% of everything you spend
            </p>
          </div>
          <div className="text-right">
            <p className="num text-[15px]">{formatMoney(r.perMonth)}</p>
            <p className="text-[11px] text-ink-3">a month</p>
          </div>
          {r.action && (
            <button onClick={r.action} className={clsx('h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-accent hover:bg-mist')}>
              Limit
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
