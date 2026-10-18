import { motion } from 'framer-motion';
import { FileText, Lightbulb, Repeat2, TrendingDown, TrendingUp, AlertCircle, PiggyBank, Footprints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { addDays, periodFor } from '@/data/dates';
import type { TxFilter } from '@/data/types';
import { useCategoryMap, useToday } from '@/data/selectors';
import { Button, Toggle, SPRING } from '@/design/ui';
import { summariseBudget, totalIncome } from '@/features/budget/math';
import { RangeChips } from '@/features/transactions/FilterBar';
import { previousRange, rangeFor, type RangePreset } from '@/features/transactions/filter';
import { lastNPeriods } from './aggregate';
import { computeInsights, type Insight } from './engine';
import { useInsightAction } from './useInsightAction';
import type { InsightCtx } from './charts/context';
import { CalendarHeatmap, CategoryDonut, DailyBars, MonthCompare, RunningVsBudget, SizeBandsChart, TopPlacesChart, WeekdayChart } from './charts/spending';
import { CategoryTreemap, FlowSankey, IncomeVsSpending, NeedsWantsSavings, NetWorthChart, SavingsProgress, StackedMonths, WeeklyCashflow } from './charts/trends';

const OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3', label: '3 months' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

const ICONS: Record<Insight['kind'], typeof Lightbulb> = {
  increase: TrendingUp,
  decrease: TrendingDown,
  trend: TrendingUp,
  habit: Footprints,
  unusual: AlertCircle,
  saving: PiggyBank,
  subscription: Repeat2,
};

export default function InsightsScreen() {
  const s = useData();
  const cats = useCategoryMap();
  const today = useToday();
  const navigate = useNavigate();
  const setPendingFilter = useUI((x) => x.setPendingFilter);
  const runAction = useInsightAction();
  const [preset, setPreset] = useState<RangePreset>('this-month');
  const [custom, setCustom] = useState({ from: addDays(today, -60), to: today });
  const [compare, setCompare] = useState(false);
  const startDay = s.settings.monthStartDay;

  const range = rangeFor(preset, startDay, custom) ?? { from: '2000-01-01', to: today };
  const period = periodFor(range.from, startDay);
  const ctx: InsightCtx = useMemo(
    () => ({
      txs: s.transactions,
      range,
      prev: compare ? previousRange(range, startDay) : null,
      cats,
      groups: s.groups,
      startDay,
      today,
      onFilter: (f: TxFilter) => {
        setPendingFilter(f);
        navigate('/transactions');
      },
    }),
    [s.transactions, range.from, range.to, compare, cats, s.groups, startDay, today],
  );

  const periods = useMemo(() => lastNPeriods(range.to > today ? today : range.to, startDay, 6), [range.to, today, startDay]);
  const budget = useMemo(() => {
    const b = s.budgets.find((x) => x.id === period.start);
    return summariseBudget({ budget: b, budgets: s.budgets, txs: s.transactions, today: today > period.end ? period.end : today, startDay, period });
  }, [s.budgets, s.transactions, period, today, startDay]);
  const income = useMemo(() => totalIncome(s.transactions, { start: range.from, end: range.to, days: 0 }), [s.transactions, range.from, range.to]);

  const insights = useMemo(
    () => computeInsights({ txs: s.transactions, period: periodFor(today, startDay), today, startDay, cats, recurring: s.recurring }),
    [s.transactions, today, startDay, cats, s.recurring],
  );

  const singleMonth = preset === 'this-month' || preset === 'last-month';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">Insights</h1>
          <p className="mt-1 text-sm text-ink-3">Tap any bar, slice or day to see the payments behind it.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/insights/common" className="press inline-flex h-11 items-center gap-2 rounded-xl bg-shelf px-3.5 text-sm font-medium">
            <Repeat2 size={16} aria-hidden /> Common expenses
          </Link>
          <Link to="/report" className="press inline-flex h-11 items-center gap-2 rounded-xl bg-shelf px-3.5 text-sm font-medium">
            <FileText size={16} aria-hidden /> Monthly report
          </Link>
        </div>
      </header>

      {/* One filter row scopes everything below. */}
      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur-md lg:top-0 lg:-mx-10 lg:px-10 sm:flex-row sm:items-center sm:justify-between">
        <RangeChips value={preset} onChange={setPreset} custom={custom} onCustom={setCustom} options={OPTIONS} />
        <div className="shrink-0 sm:w-64">
          <Toggle checked={compare} onChange={setCompare} label="Compare to last period" />
        </div>
      </div>

      {insights.length > 0 && (
        <section id="insights" aria-labelledby="insights-title">
          <h2 id="insights-title" className="mb-3 text-[17px]">
            What I noticed this month
          </h2>
          <motion.ul className="grid gap-3 lg:grid-cols-2" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
            {insights.map((i) => {
              const I = ICONS[i.kind];
              return (
                <motion.li key={i.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: SPRING } }} className="flex gap-3 rounded-2xl border border-line bg-sheet p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mist text-accent">
                    <I size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{i.title}</p>
                    <p className="mt-0.5 text-sm text-ink-2">{i.body}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {i.action && (
                        <Button size="sm" variant="primary" onClick={() => runAction(i.action!)}>
                          {i.action.label}
                        </Button>
                      )}
                      {(i.categoryId || i.place) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => ctx.onFilter({ categoryIds: i.categoryId ? [i.categoryId] : undefined, place: i.place, range: { from: periodFor(today, startDay).start, to: today } })}
                        >
                          See payments
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        </section>
      )}

      {/* Asymmetric 7/5 rhythm, alternating sides; never three equal cards. */}
      <section aria-label="Spending charts" className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <CategoryDonut ctx={ctx} className="lg:col-span-7" />
        <TopPlacesChart ctx={ctx} className="lg:col-span-5" />
        {singleMonth && <RunningVsBudget ctx={ctx} period={period} budget={budget.spendablePaise} className="lg:col-span-12" />}
        <DailyBars ctx={ctx} className="lg:col-span-12" />
        <SizeBandsChart ctx={ctx} className="lg:col-span-5" />
        <CalendarHeatmap ctx={ctx} className="lg:col-span-7" />
        <MonthCompare ctx={ctx} period={periodFor(today > range.to ? range.to : today, startDay)} className="lg:col-span-7" />
        <WeekdayChart ctx={ctx} className="lg:col-span-5" />
      </section>

      <section aria-labelledby="trends-title" className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <h2 id="trends-title" className="text-[17px] lg:col-span-12">
          Bigger picture
        </h2>
        <NeedsWantsSavings ctx={ctx} contributions={s.contributions} incomePaise={income} className="lg:col-span-5" />
        <IncomeVsSpending ctx={ctx} periods={periods} className="lg:col-span-7" />
        <FlowSankey ctx={ctx} incomePaise={income} className="lg:col-span-12" />
        <StackedMonths ctx={ctx} periods={periods} className="lg:col-span-7" />
        <CategoryTreemap ctx={ctx} className="lg:col-span-5" />
        <WeeklyCashflow ctx={ctx} className="lg:col-span-12" />
        <NetWorthChart ctx={ctx} periods={periods} accounts={s.accounts} splits={s.splits} debts={s.debts} className="lg:col-span-7" />
        <SavingsProgress goals={s.goals} buckets={s.buckets} contributions={s.contributions} className="lg:col-span-5" />
      </section>
    </div>
  );
}
