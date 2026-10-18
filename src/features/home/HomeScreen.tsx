import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Inbox, Lightbulb, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { addDays, formatDay, formatShort, periodLabel, shiftPeriod } from '@/data/dates';
import { formatMoney } from '@/data/money';
import { useBudgetSummary, useCategoryMap, useToday, categoryColour } from '@/data/selectors';
import { Amount, Button, EmptyState, Ring, StateTag, SPRING } from '@/design/ui';
import { Icon } from '@/design/icons';
import { paceNudges, totalSpent } from '@/features/budget/math';
import { computeInsights, type Insight } from '@/features/insights/engine';
import { runningVsPace } from '@/features/insights/aggregate';
import { projectGoal } from '@/features/goals/math';
import { addDueNow, skipDue } from '@/features/recurring/run';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { sortTx } from '@/features/transactions/filter';
import { useInsightAction } from '@/features/insights/useInsightAction';

// Home has one moment of motion: the figure counting up on today's page. Sections simply appear.
const container = {};
const item = {};

function greeting(name: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

export function HomeScreen() {
  const settings = useData((s) => s.settings);
  const txs = useData((s) => s.transactions);
  const recurring = useData((s) => s.recurring);
  const goals = useData((s) => s.goals);
  const contributions = useData((s) => s.contributions);
  const catMap = useCategoryMap();
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const summary = useBudgetSummary();
  const today = useToday();
  const { period } = summary;

  const lastPeriod = shiftPeriod(period, -1, settings.monthStartDay);
  const lastSameDay = addDays(lastPeriod.start, Math.min(summary.elapsed, lastPeriod.days) - 1);
  // One-off big items (a yearly subscription) would swamp the comparison; compare everyday spending.
  const everyday = useMemo(() => txs.filter((t) => !t.bigItem), [txs]);
  const lastSoFar = useMemo(() => totalSpent(everyday, lastPeriod, lastSameDay), [everyday, lastPeriod, lastSameDay]);
  const nowSoFar = useMemo(() => totalSpent(everyday, period, today), [everyday, period, today]);
  const bigThisMonth = summary.spentPaise - totalSpent(everyday, period);
  const diff = nowSoFar - lastSoFar;

  const insights = useMemo(
    () => computeInsights({ txs, period, today, startDay: settings.monthStartDay, cats: catMap, recurring }),
    [txs, period, today, settings.monthStartDay, catMap, recurring],
  );
  const nudges = useMemo(() => paceNudges(summary), [summary]);

  const top3 = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) if (t.type === 'expense' && !t.excluded && t.date >= period.start && t.date <= period.end) m.set(t.categoryId ?? 'uncategorised', (m.get(t.categoryId ?? 'uncategorised') ?? 0) + t.amountPaise);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [txs, period]);

  const upcoming = useMemo(() => recurring.filter((r) => r.active && r.nextDue <= addDays(today, 10)).sort((a, b) => a.nextDue.localeCompare(b.nextDue)).slice(0, 3), [recurring, today]);
  const inbox = useMemo(() => txs.filter((t) => t.type === 'expense' && !t.excluded && !t.categoryId).length, [txs]);
  const recent = useMemo(() => [...txs].sort(sortTx).slice(0, 5), [txs]);
  const spark = useMemo(() => runningVsPace(txs, period, summary.spendablePaise, today), [txs, period, summary.spendablePaise, today]);

  const hasMeasure = summary.spendablePaise > 0;
  const status = summary.state === 'none' ? (summary.projectedPaise > summary.spendablePaise ? 'close' : 'ok') : summary.state;
  const paceState = !hasMeasure ? 'none' : summary.spentPaise > summary.spendablePaise ? 'over' : summary.projectedPaise > summary.spendablePaise ? 'close' : status;

  if (txs.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <Greeting name={settings.name} label={periodLabel(period)} daysLeft={summary.daysLeft} />
        <EmptyState
          title="No payments yet."
          body="Tap + to add your first one, it takes 5 seconds. Your safe-to-spend number appears as soon as there's a budget or some income."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => openQuickAdd()} icon={<Plus size={18} />}>
                Add a payment
              </Button>
              <Link to="/import" className="press inline-flex h-12 items-center rounded-[14px] bg-shelf px-5 font-medium">
                Import a statement
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-8">
      <motion.div variants={item}>
        <Greeting name={settings.name} label={periodLabel(period)} daysLeft={summary.daysLeft} />
      </motion.div>

      {/* Hero: one oversized answer, supporting answers offset beside it */}
      <motion.section variants={item} className="grid gap-6 lg:grid-cols-12 lg:gap-10" aria-label="This month at a glance">
        <div className="lg:col-span-7">
          <NotebookPage today={today}>
            {hasMeasure ? (
              <>
                <p className="notebook-line text-[15px] text-ink-2">Safe to spend today</p>
                <p className="notebook-figure" aria-label={`Safe to spend today: ${formatMoney(summary.safeTodayPaise)}`}>
                  <span className="notebook-rupee" aria-hidden>
                    ₹
                  </span>
                  <Amount hero animate paise={summary.safeTodayPaise} className="notebook-amount" bare />
                </p>
                <p className="notebook-line text-[15px] text-ink-2">
                  {summary.leftPaise >= 0 ? (
                    <>
                      <span className="num font-medium text-ink">{formatMoney(summary.leftPaise)}</span> left for the next {summary.daysLeft} {summary.daysLeft === 1 ? 'day' : 'days'}
                    </>
                  ) : (
                    <>
                      <span className="num font-medium text-over">{formatMoney(-summary.leftPaise)}</span> past this month's budget. Tomorrow is a fresh page.
                    </>
                  )}
                </p>
                <p className="notebook-line text-sm text-ink-3">
                  <span className="num text-ink-2">{formatMoney(summary.spentPaise)}</span> spent of <span className="num">{formatMoney(summary.spendablePaise)}</span> {summary.hasBudget ? 'budget' : 'income'}
                </p>
              </>
            ) : (
              <>
                <p className="notebook-line text-[15px] text-ink-2">Spent this month</p>
                <p className="notebook-figure">
                  <span className="notebook-rupee" aria-hidden>
                    ₹
                  </span>
                  <Amount hero paise={summary.spentPaise} className="notebook-amount" bare />
                </p>
                <p className="notebook-line text-[15px] text-ink-2">Set a budget or add this month's income to see what's safe each day.</p>
                <p className="notebook-line">
                  <Link to="/budget" className="font-medium text-accent underline decoration-accent/40 underline-offset-4">
                    Set a budget
                  </Link>
                </p>
              </>
            )}
          </NotebookPage>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5 lg:pt-2">
          {hasMeasure && (
            <div className="border-t border-line pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-2">Am I on track?</p>
                <StateTag state={paceState} />
              </div>
              <p className="mt-2 text-[15px] text-ink">
                {paceState === 'over'
                  ? 'Over budget for the month.'
                  : paceState === 'close'
                    ? `At this pace you'll end near ${formatMoney(summary.projectedPaise)}, a little over.`
                    : `At this pace you'll end near ${formatMoney(summary.projectedPaise)}. Comfortably inside.`}
              </p>
              <PaceSpark data={spark} budget={summary.spendablePaise} />
            </div>
          )}
          <div className="border-t border-line pt-4">
            <p className="text-sm font-medium text-ink-2">Compared with last month</p>
            <div className="mt-2 flex items-start gap-3">
              <span className={clsx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', diff > 0 ? 'bg-warn/10 text-warn' : 'bg-mist text-accent')}>
                {diff > 0 ? <ArrowUpRight size={17} aria-hidden /> : <ArrowDownRight size={17} aria-hidden />}
              </span>
              <p className="text-[15px]">
                {Math.abs(diff) < 5_000 ? (
                  <>About the same as by {formatShort(lastSameDay)} last month.</>
                ) : (
                  <>
                    <span className="num font-medium">{formatMoney(Math.abs(diff))}</span> {diff > 0 ? 'more' : 'less'} on everyday things than by {formatShort(lastSameDay)} last month.
                  </>
                )}
                {bigThisMonth > 0 && <span className="text-ink-3"> Plus {formatMoney(bigThisMonth)} in big one-off items.</span>}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {inbox > 0 && (
        <motion.div variants={item}>
          <Link to="/transactions?view=inbox" className="press flex min-h-[56px] items-center gap-3 rounded-2xl border border-warn/30 bg-warn/5 px-4 py-3">
            <Inbox size={20} className="shrink-0 text-warn" aria-hidden />
            <span className="flex-1 text-[15px]">
              <span className="font-medium">{inbox} {inbox === 1 ? 'payment needs' : 'payments need'} a category.</span>{' '}
              <span className="text-ink-2">Sorting them keeps your budget lines accurate.</span>
            </span>
          </Link>
        </motion.div>
      )}

      {/* What's changing */}
      {(insights[0] || nudges[0]) && (
        <motion.div variants={item}>
          <InsightCard insight={insights[0]} nudge={nudges[0] ? { name: catMap.get(nudges[0].categoryId)?.name ?? '', over: nudges[0].overByPaise } : undefined} more={insights.length > 1} />
        </motion.div>
      )}

      <motion.div variants={item} className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <section className="lg:col-span-7" aria-labelledby="top-cats">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="top-cats" className="text-[17px]">
              Where it went
            </h2>
            <Link to="/insights" className="inline-flex h-11 items-center gap-1 text-sm font-medium text-accent">
              See all charts
            </Link>
          </div>
          {top3.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing spent yet this month.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {top3.map(([id, total], i) => {
                const c = catMap.get(id);
                const line = summary.lines.find((l) => l.categoryId === id);
                return (
                  <li key={id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
                    <span className="num w-5 text-sm text-ink-3">{i + 1}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span style={{ color: categoryColour(c) }}>
                        <Icon name={c?.icon ?? 'package'} size={18} />
                      </span>
                      <span className="truncate text-[15px]">{c?.name ?? 'Needs a category'}</span>
                      {line && <StateTag state={line.state} className="ml-1" />}
                    </span>
                    <span className="num text-[15px]">{formatMoney(total)}</span>
                    <span />
                    <div className="col-span-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-shelf">
                        <motion.div
                          className="h-full origin-left rounded-full"
                          style={{ background: categoryColour(c), width: '100%' }}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: summary.spentPaise ? total / summary.spentPaise : 0 }}
                          transition={SPRING}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-3">
                        {Math.round((total / Math.max(1, summary.spentPaise)) * 100)}% of spending
                        {line && line.availablePaise > 0 && <>, <span className="num">{formatMoney(Math.max(0, line.leftPaise))}</span> left of <span className="num">{formatMoney(line.availablePaise)}</span></>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="flex flex-col gap-8 lg:col-span-5">
          {settings.focus === 'save' || goals.some((g) => !g.archived) ? <GoalsStrip goals={goals.filter((g) => !g.archived).slice(0, 2)} contributions={contributions} today={today} /> : null}

          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="mb-3 text-[17px]">
              Coming up
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-3">
                No bills in the next 10 days.{' '}
                <Link to="/recurring" className="font-medium text-accent">
                  Add a recurring item
                </Link>
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex min-h-[60px] items-center gap-3 py-2">
                    <CalendarClock size={18} className="shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{r.name}</span>
                      <span className={clsx('block text-[13px]', r.nextDue <= today ? 'text-warn' : 'text-ink-3')}>
                        <span className="num">{formatMoney(r.amountPaise)}</span>, {r.nextDue < today ? `was due ${formatDay(r.nextDue).toLowerCase()}` : r.nextDue === today ? 'due today' : `due ${formatDay(r.nextDue)}`}
                      </span>
                    </span>
                    {r.nextDue <= today && (
                      <>
                        <button className="h-11 rounded-lg px-2 text-sm text-ink-3 hover:text-ink" onClick={() => skipDue(r)}>
                          Skip
                        </button>
                        <Button size="sm" onClick={() => addDueNow(r)}>
                          Add
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </motion.div>

      <motion.section variants={item} aria-labelledby="recent">
        <div className="mb-2 flex items-end justify-between">
          <h2 id="recent" className="text-[17px]">
            Latest
          </h2>
          <Link to="/transactions" className="inline-flex h-11 items-center gap-1 text-sm font-medium text-accent">
            See all payments
          </Link>
        </div>
        <div className="-mx-2">
          {recent.map((t) => (
            <TransactionRow key={t.id} t={t} cat={t.categoryId ? catMap.get(t.categoryId) : undefined} catMap={catMap} onOpen={(tx) => openQuickAdd({ editing: tx })} />
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
}

/**
 * The one bold element: today's page of a school notebook. Blue rules, a red margin with the date in it,
 * and the safe-to-spend figure written across two rules. Everything else on Home stays quiet.
 */
function NotebookPage({ today, children }: { today: string; children: React.ReactNode }) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(date);
  const month = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date);
  return (
    <section className="notebook" aria-label="Today">
      <div className="notebook-margin" aria-hidden>
        <span className="notebook-day">{d}</span>
        <span className="notebook-date">{month}</span>
        <span className="notebook-date">{weekday}</span>
      </div>
      <div className="notebook-body">{children}</div>
    </section>
  );
}

function Greeting({ name, label, daysLeft }: { name: string; label: string; daysLeft: number }) {
  return (
    <div>
      <p className="text-sm text-ink-3">
        {label}, {daysLeft} {daysLeft === 1 ? 'day' : 'days'} to go
      </p>
      <h1 className="mt-0.5 text-[22px] leading-tight">{greeting(name)}</h1>
    </div>
  );
}

function PaceSpark({ data, budget }: { data: ReturnType<typeof runningVsPace>; budget: number }) {
  const w = 280;
  const h = 56;
  const max = Math.max(budget, ...data.map((d) => Math.max(d.actual ?? 0, d.projected ?? 0)), 1);
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * w;
  const y = (v: number) => h - 4 - (v / max) * (h - 8);
  const actual = data.map((d, i) => (d.actual != null ? `${x(i)},${y(d.actual)}` : null)).filter(Boolean).join(' ');
  const projected = data.map((d, i) => (d.projected != null ? `${x(i)},${y(d.projected)}` : null)).filter(Boolean).join(' ');
  const lastActual = [...data].reverse().find((d) => d.actual != null);
  const end = data[data.length - 1]?.projected ?? 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-14 w-full" role="img" aria-label={`Spending pace: ${formatMoney(lastActual?.actual ?? 0)} so far, heading toward ${formatMoney(end)} against a budget of ${formatMoney(budget)}.`} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={y(budget)} y2={y(budget)} stroke="rgb(var(--line))" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <line x1={0} y1={y(0)} x2={w} y2={y(budget)} stroke="rgb(var(--ink-3))" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {projected && <polyline points={projected} fill="none" stroke="rgb(var(--accent))" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      {actual && <polyline points={actual} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function InsightCard({ insight, nudge, more }: { insight?: Insight; nudge?: { name: string; over: number }; more: boolean }) {
  const run = useInsightAction();
  const navigate = useNavigate();
  return (
    <section className="grid gap-4 rounded-card bg-mist p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center" aria-label="What's changing">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-sheet text-accent">
        <Lightbulb size={20} aria-hidden />
      </span>
      <div>
        {insight ? (
          <>
            <p className="text-[15px] font-medium text-ink">{insight.title}</p>
            <p className="mt-0.5 text-sm text-ink-2">{insight.body}</p>
          </>
        ) : null}
        {nudge && (
          <p className={clsx('text-sm text-ink-2', insight && 'mt-2')}>
            At this pace you'll overspend <span className="font-medium text-ink">{nudge.name}</span> by about <span className="num font-medium text-ink">{formatMoney(nudge.over)}</span>.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {insight?.action && (
          <Button size="sm" variant="primary" onClick={() => run(insight.action!)}>
            {insight.action.label}
          </Button>
        )}
        {more && (
          <Button size="sm" variant="ghost" onClick={() => navigate('/insights#insights')}>
            More
          </Button>
        )}
      </div>
    </section>
  );
}

function GoalsStrip({ goals, contributions, today }: { goals: ReturnType<typeof useData.getState>['goals']; contributions: ReturnType<typeof useData.getState>['contributions']; today: string }) {
  if (!goals.length) {
    return (
      <section>
        <h2 className="mb-3 text-[17px]">Saving for</h2>
        <Link to="/goals" className="text-sm font-medium text-accent">
          Create your first goal
        </Link>
      </section>
    );
  }
  return (
    <section aria-labelledby="goals-strip">
      <div className="mb-3 flex items-end justify-between">
        <h2 id="goals-strip" className="text-[17px]">
          Saving for
        </h2>
        <Link to="/goals" className="inline-flex h-11 items-center gap-1 text-sm font-medium text-accent">
          See goals
        </Link>
      </div>
      <ul className="flex flex-col gap-3">
        {goals.map((g) => {
          const p = projectGoal(g, contributions, today);
          return (
            <li key={g.id} className="flex items-center gap-4">
              <Ring value={p.progress} size={52} stroke={5} label={`${g.name} ${Math.round(p.progress * 100)}% saved`}>
                <Icon name={g.icon} size={18} className="text-accent" />
              </Ring>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{g.name}</p>
                <p className="text-[13px] text-ink-3">
                  <span className="num">{formatMoney(p.saved)}</span> of <span className="num">{formatMoney(g.targetPaise)}</span>
                  {p.monthlyNeeded != null && p.remaining > 0 && <>, <span className="num">{formatMoney(p.monthlyNeeded)}</span> a month to get there</>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
