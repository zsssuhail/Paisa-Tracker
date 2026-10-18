import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
} from 'recharts';
import { diffDays, formatLong, formatShort, isoWeekStart, parts, WEEKDAYS } from '@/data/dates';
import { formatMoney, roundRupee } from '@/data/money';
import { sequentialAccent } from '@/design/chartPalette';
import {
  byCategory,
  byDay,
  monthCompare,
  pct,
  runningVsPace,
  sizeBands,
  topPlaces,
  topWithOther,
  totalOf,
  weekdayPattern,
} from '../aggregate';
import { categoryTakeaway } from '../engine';
import { axisProps, BAR_RADIUS, BAR_RADIUS_H, ChartCard, ChartTooltip, gridProps, Legend, LegendItem, moneyTick } from './kit';
import { catColour, catName, distinctColours, signedPct, type InsightCtx } from './context';
import type { Period } from '@/data/dates';

const ACCENT = 'rgb(var(--accent))';
const MUTED = 'rgb(var(--ink-3))';
const GHOST = 'rgb(var(--ink-3) / 0.35)';

export function CategoryDonut({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const totals = useMemo(() => byCategory(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const prev = useMemo(() => (ctx.prev ? new Map(byCategory(ctx.txs, ctx.prev).map((c) => [c.categoryId, c.total])) : null), [ctx.txs, ctx.prev]);
  const data = topWithOther(totals);
  const all = totalOf(totals);
  const colours = distinctColours(ctx, data.map((d) => d.categoryId));
  const [hover, setHover] = useState<string | null>(null);
  const focus = data.find((d) => d.categoryId === hover);
  return (
    <ChartCard
      className={className}
      id="by-category"
      title="Spending by category"
      takeaway={categoryTakeaway(totals, ctx.cats, ctx.txs, ctx.range)}
      rows={data}
      columns={[
        { key: 'c', label: 'Category', value: (r) => catName(ctx, r.categoryId) },
        { key: 't', label: 'Spent', numeric: true, value: (r) => formatMoney(r.total) },
        { key: 'p', label: 'Share', numeric: true, value: (r) => `${pct(r.total, all)}%` },
        ...(prev ? [{ key: 'v', label: 'vs last period', numeric: true, value: (r: (typeof data)[number]) => signedPct(r.total, prev.get(r.categoryId) ?? 0) }] : []),
      ]}
    >
      {all === 0 ? (
        <Empty />
      ) : (
        <div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="relative mx-auto h-[200px] w-[200px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="total"
                  nameKey="categoryId"
                  innerRadius={64}
                  outerRadius={96}
                  stroke="rgb(var(--sheet))"
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setHover(data[i].categoryId)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(_, i) => data[i].categoryId !== 'other' && ctx.onFilter({ categoryIds: [data[i].categoryId], range: ctx.range })}
                >
                  {data.map((d) => (
                    <Cell key={d.categoryId} fill={colours.get(d.categoryId)} opacity={hover && hover !== d.categoryId ? 0.45 : 1} className="cursor-pointer outline-none" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="num text-lg font-medium">{formatMoney(focus?.total ?? all)}</p>
                <p className="max-w-[110px] truncate text-xs text-ink-3">{focus ? catName(ctx, focus.categoryId) : 'Total spent'}</p>
              </div>
            </div>
          </div>
          <ul className="flex min-w-0 flex-col">
            {data.map((d) => (
              <li key={d.categoryId}>
                <button
                  type="button"
                  disabled={d.categoryId === 'other'}
                  onMouseEnter={() => setHover(d.categoryId)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => ctx.onFilter({ categoryIds: [d.categoryId], range: ctx.range })}
                  className={clsx('flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-shelf', hover === d.categoryId && 'bg-shelf')}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colours.get(d.categoryId) }} aria-hidden />
                  <span className="flex-1 truncate text-ink">{catName(ctx, d.categoryId)}</span>
                  <span className="num w-10 shrink-0 text-right text-ink-3">{pct(d.total, all)}%</span>
                  <span className="num shrink-0 text-right text-ink">{formatMoney(d.total)}</span>
                  {prev && <span className="num hidden w-14 text-right text-xs text-ink-3 sm:inline">{signedPct(d.total, prev.get(d.categoryId) ?? 0)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

export function DailyBars({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const days = useMemo(() => byDay(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const prevDays = useMemo(() => (ctx.prev ? byDay(ctx.txs, ctx.prev) : null), [ctx.txs, ctx.prev]);
  const counted = days.filter((d) => d.date <= ctx.today);
  const avg = counted.length ? roundRupee(totalOf(counted) / counted.length) : 0;
  const prevAvg = prevDays?.length ? roundRupee(totalOf(prevDays) / prevDays.length) : null;
  const peak = [...days].sort((a, b) => b.total - a.total)[0];
  const above = counted.filter((d) => d.total > avg).length;
  return (
    <ChartCard
      className={className}
      id="daily"
      title="Daily spending"
      takeaway={peak?.total ? `You spend about ${formatMoney(avg)} a day. ${above} of ${counted.length} days were above that; the biggest was ${formatShort(peak.date)}.` : 'No spending in this range yet.'}
      legend={
        <Legend>
          <LegendItem colour={ACCENT} label="Spent that day" />
          <LegendItem colour={MUTED} line label="Daily average" />
          {prevAvg != null && <LegendItem colour={GHOST} line label="Last period's average" />}
        </Legend>
      }
      rows={days}
      columns={[
        { key: 'd', label: 'Date', value: (r) => formatLong(r.date) },
        { key: 'n', label: 'Payments', numeric: true, value: (r) => r.count },
        { key: 't', label: 'Spent', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      <div className="h-[220px]">
        <ResponsiveContainer>
          <BarChart data={days} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={days.length > 40 ? 1 : 3}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => String(parts(d)[2])} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip labelFormatter={(l) => formatLong(String(l))} />} />
            <Bar dataKey="total" name="Spent" fill={ACCENT} radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false} onClick={(d) => { const date = (d as unknown as { payload: { date: string } }).payload.date; ctx.onFilter({ range: { from: date, to: date } }); }} className="cursor-pointer" />
            <ReferenceLine y={avg} stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 4" />
            {prevAvg != null && <ReferenceLine y={prevAvg} stroke={GHOST} strokeWidth={1.5} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function RunningVsBudget({ ctx, period, budget, className }: { ctx: InsightCtx; period: Period; budget: number; className?: string }) {
  const data = useMemo(() => runningVsPace(ctx.txs, period, budget, ctx.today), [ctx.txs, period, budget, ctx.today]);
  const end = data[data.length - 1]?.projected ?? data.filter((d) => d.actual != null).pop()?.actual ?? 0;
  const over = budget > 0 && end > budget;
  return (
    <ChartCard
      className={className}
      id="pace"
      title="Running total vs budget pace"
      takeaway={
        budget > 0
          ? over
            ? `Heading for about ${formatMoney(end)}, ${formatMoney(end - budget)} over your ${formatMoney(budget)} budget.`
            : `Heading for about ${formatMoney(end)} by month end, ${formatMoney(budget - end)} under budget.`
          : `Heading for about ${formatMoney(end)} by month end. Set a budget to see the pace line.`
      }
      legend={
        <Legend>
          <LegendItem colour={ACCENT} line label="Spent so far" />
          <LegendItem colour="rgb(var(--accent) / 0.45)" line label="Projected" />
          {budget > 0 && <LegendItem colour={MUTED} line label="Even pace to budget" />}
        </Legend>
      }
      rows={data}
      columns={[
        { key: 'd', label: 'Date', value: (r) => formatLong(r.date) },
        { key: 'a', label: 'Spent so far', numeric: true, value: (r) => (r.actual != null ? formatMoney(r.actual) : '—') },
        { key: 'p', label: 'Even pace', numeric: true, value: (r) => (r.pace != null ? formatMoney(r.pace) : '—') },
        { key: 'j', label: 'Projected', numeric: true, value: (r) => (r.projected != null ? formatMoney(r.projected) : '—') },
      ]}
    >
      <div className="h-[220px]">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => String(parts(d)[2])} interval="preserveStartEnd" minTickGap={20} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
            <Tooltip cursor={{ stroke: 'rgb(var(--ink-3))', strokeWidth: 1 }} content={<ChartTooltip labelFormatter={(l) => formatLong(String(l))} />} />
            {budget > 0 && <ReferenceLine y={budget} stroke="rgb(var(--line))" />}
            <Area dataKey="actual" name="Spent so far" stroke={ACCENT} fill={ACCENT} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} connectNulls={false} dot={false} />
            <Line dataKey="projected" name="Projected" stroke="rgb(var(--accent) / 0.45)" strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} />
            {budget > 0 && <Line dataKey="pace" name="Even pace" stroke={MUTED} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function MonthCompare({ ctx, period, className }: { ctx: InsightCtx; period: Period; className?: string }) {
  const rows = useMemo(() => monthCompare(ctx.txs, period, ctx.startDay).filter((r) => r.categoryId !== 'uncategorised').slice(0, 8), [ctx.txs, period, ctx.startDay]);
  const biggest = [...rows].sort((a, b) => b.current - b.avg3 - (a.current - a.avg3))[0];
  const data = rows.map((r) => ({ ...r, name: catName(ctx, r.categoryId) }));
  return (
    <ChartCard
      className={className}
      id="month-compare"
      title="This month vs before"
      takeaway={biggest && biggest.current > biggest.avg3 ? `${catName(ctx, biggest.categoryId)} is ${formatMoney(biggest.current - biggest.avg3)} above its 3-month average.` : 'Every category is at or below its 3-month average.'}
      legend={
        <Legend>
          <LegendItem colour={ACCENT} label="This month" />
          <LegendItem colour="var(--series-1)" label="Last month" />
          <LegendItem colour="rgb(var(--ink-3) / .55)" label="3-month average" />
        </Legend>
      }
      rows={data}
      columns={[
        { key: 'n', label: 'Category', value: (r) => r.name },
        { key: 'c', label: 'This month', numeric: true, value: (r) => formatMoney(r.current) },
        { key: 'l', label: 'Last month', numeric: true, value: (r) => formatMoney(r.last) },
        { key: 'a', label: '3-month avg', numeric: true, value: (r) => formatMoney(r.avg3) },
      ]}
    >
      <div style={{ height: Math.max(200, data.length * 52) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap={10}>
            <CartesianGrid {...gridProps} horizontal={false} vertical />
            <XAxis type="number" {...axisProps} tickFormatter={moneyTick} />
            <YAxis type="category" dataKey="name" {...axisProps} width={112} tick={{ ...axisProps.tick, fontFamily: '"Geist Variable", sans-serif', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip />} />
            <Bar dataKey="current" name="This month" fill={ACCENT} radius={BAR_RADIUS_H} maxBarSize={10} isAnimationActive={false} />
            <Bar dataKey="last" name="Last month" fill="var(--series-1)" radius={BAR_RADIUS_H} maxBarSize={10} isAnimationActive={false} />
            <Bar dataKey="avg3" name="3-month average" fill="rgb(var(--ink-3) / .55)" radius={BAR_RADIUS_H} maxBarSize={10} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function WeekdayChart({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const data = useMemo(() => weekdayPattern(ctx.txs, ctx.range).map((d) => ({ ...d, name: WEEKDAYS[d.weekday] })), [ctx.txs, ctx.range]);
  const prev = useMemo(() => (ctx.prev ? weekdayPattern(ctx.txs, ctx.prev) : null), [ctx.txs, ctx.prev]);
  const merged = data.map((d, i) => ({ ...d, prevAverage: prev?.[i].average ?? null }));
  const top = [...data].sort((a, b) => b.average - a.average)[0];
  const low = [...data].sort((a, b) => a.average - b.average)[0];
  return (
    <ChartCard
      className={className}
      id="weekday"
      title="By day of the week"
      takeaway={top?.average ? `${WEEKDAYS[top.weekday]}s cost the most, about ${formatMoney(top.average)} on average. ${WEEKDAYS[low.weekday]}s are the quietest.` : 'No spending in this range yet.'}
      legend={
        prev ? (
          <Legend>
            <LegendItem colour={ACCENT} label="Average this period" />
            <LegendItem colour={GHOST} label="Last period" />
          </Legend>
        ) : undefined
      }
      rows={merged}
      columns={[
        { key: 'd', label: 'Day', value: (r) => r.name },
        { key: 'a', label: 'Average', numeric: true, value: (r) => formatMoney(r.average) },
        { key: 't', label: 'Total', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      <div className="h-[200px]">
        <ResponsiveContainer>
          <BarChart data={merged} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip />} />
            {prev && <Bar dataKey="prevAverage" name="Last period" fill={GHOST} radius={BAR_RADIUS} maxBarSize={16} isAnimationActive={false} />}
            <Bar dataKey="average" name="Average" radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false}>
              {merged.map((d) => (
                <Cell key={d.weekday} fill={d.weekday === top?.weekday ? ACCENT : 'rgb(var(--accent) / 0.45)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function SizeBandsChart({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const bands = useMemo(() => sizeBands(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const all = totalOf(bands);
  const count = bands.reduce((s, b) => s + b.count, 0);
  const small = bands[0].count + bands[1].count;
  const smallTotal = bands[0].total + bands[1].total;
  const max = Math.max(1, ...bands.map((b) => b.total));
  return (
    <ChartCard
      className={className}
      id="size-bands"
      title="Small payments add up"
      takeaway={count ? `${small} of your ${count} payments were under ₹100, and together they add up to ${formatMoney(smallTotal)} (${pct(smallTotal, all)}% of spending).` : 'No spending in this range yet.'}
      rows={bands}
      columns={[
        { key: 'b', label: 'Size', value: (r) => r.label },
        { key: 'n', label: 'Payments', numeric: true, value: (r) => r.count },
        { key: 't', label: 'Adds up to', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      <ul className="flex flex-col gap-3">
        {bands.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="w-full rounded-lg p-1 text-left hover:bg-shelf"
              onClick={() => ctx.onFilter({ range: ctx.range, minPaise: b.min, maxPaise: Number.isFinite(b.max) ? b.max : undefined, types: ['expense'] })}
            >
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-ink">{b.label}</span>
                <span className="text-ink-3">
                  <span className="num">{b.count}</span> payments, <span className="num text-ink">{formatMoney(b.total)}</span>
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-shelf">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(b.total / max) * 100}%`, opacity: 0.55 + (bands.indexOf(b) / bands.length) * 0.45 }} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

export function TopPlacesChart({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const places = useMemo(() => topPlaces(ctx.txs, ctx.range, 8), [ctx.txs, ctx.range]);
  const prev = useMemo(() => (ctx.prev ? new Map(topPlaces(ctx.txs, ctx.prev, 50).map((p) => [p.key, p.total])) : null), [ctx.txs, ctx.prev]);
  const max = Math.max(1, ...places.map((p) => p.total));
  const top = places[0];
  return (
    <ChartCard
      className={className}
      id="places"
      title="Top places"
      takeaway={top ? `${top.place} takes the most: ${top.visits} ${top.visits === 1 ? 'visit' : 'visits'}, ${formatMoney(top.total)} in all.` : 'Add where you paid to see your top places.'}
      rows={places}
      columns={[
        { key: 'p', label: 'Place', value: (r) => r.place },
        { key: 'v', label: 'Visits', numeric: true, value: (r) => r.visits },
        { key: 'a', label: 'Per visit', numeric: true, value: (r) => formatMoney(r.average) },
        { key: 't', label: 'Total', numeric: true, value: (r) => formatMoney(r.total) },
        ...(prev ? [{ key: 'c', label: 'vs last period', numeric: true, value: (r: (typeof places)[number]) => signedPct(r.total, prev.get(r.key) ?? 0) }] : []),
      ]}
    >
      {places.length === 0 ? (
        <Empty />
      ) : (
        <ul className="flex flex-col gap-1">
          {places.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => ctx.onFilter({ place: p.place, range: ctx.range })} className="grid w-full grid-cols-[1fr_auto] gap-x-3 rounded-lg px-1 py-1.5 text-left hover:bg-shelf">
                <span className="truncate text-sm text-ink">{p.place}</span>
                <span className="num text-sm text-ink">{formatMoney(p.total)}</span>
                <span className="col-span-2 mt-1 flex items-center gap-2">
                  <span className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (p.total / max) * 100)}%`, background: p.topCategoryId ? catColour(ctx, p.topCategoryId) : MUTED }} />
                  <span className="shrink-0 text-xs text-ink-3">
                    {p.visits}×, {formatMoney(p.average)} avg
                    {prev && <>, {signedPct(p.total, prev.get(p.key) ?? 0)}</>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function CalendarHeatmap({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const days = useMemo(() => byDay(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const max = Math.max(1, ...days.map((d) => d.total));
  const zero = days.filter((d) => d.total === 0 && d.date <= ctx.today).length;
  const start = isoWeekStart(ctx.range.from);
  const lead = diffDays(ctx.range.from, start);
  const cells: ({ date: string; total: number; count: number } | null)[] = [...Array(lead).fill(null), ...days];
  const [hover, setHover] = useState<(typeof days)[number] | null>(null);
  const weeks = Math.ceil(cells.length / 7);
  const compact = weeks > 10;
  return (
    <ChartCard
      className={className}
      id="calendar"
      title="Spending calendar"
      takeaway={`${zero} no-spend ${zero === 1 ? 'day' : 'days'} in this range. Darker squares are bigger days.`}
      rows={days}
      columns={[
        { key: 'd', label: 'Date', value: (r) => formatLong(r.date) },
        { key: 't', label: 'Spent', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      <div className="flex flex-col gap-3">
        <div
          className="grid gap-1"
          style={compact ? { gridTemplateRows: 'repeat(7, minmax(0, 1fr))', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)' } : { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        >
          {!compact && ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="text-center text-[11px] text-ink-3">{d}</span>)}
          {cells.map((c, i) =>
            c ? (
              <button
                key={c.date}
                type="button"
                onMouseEnter={() => setHover(c)}
                onFocus={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                onClick={() => ctx.onFilter({ range: { from: c.date, to: c.date } })}
                aria-label={`${formatLong(c.date)}: ${formatMoney(c.total)}`}
                className={clsx('relative aspect-square rounded-[6px] outline-offset-1 hover:outline hover:outline-2 hover:outline-ink-3', c.date > ctx.today && 'opacity-40')}
                style={{ background: sequentialAccent(c.total ? Math.sqrt(c.total / max) : 0) }}
              >
                {!compact && <span className={clsx('absolute left-1 top-0.5 text-[10px]', c.total / max > 0.45 ? 'text-on-accent' : 'text-ink-3')}>{parts(c.date)[2]}</span>}
              </button>
            ) : (
              <span key={`b${i}`} />
            ),
          )}
        </div>
        <div className="flex min-h-[20px] items-center justify-between text-xs text-ink-3">
          <span>{hover ? <>{formatLong(hover.date)}, <span className="num text-ink">{formatMoney(hover.total)}</span></> : 'Tap a day to see its payments'}</span>
          <span className="flex items-center gap-1">
            Less
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span key={t} className="h-3 w-3 rounded-[3px]" style={{ background: sequentialAccent(t) }} />
            ))}
            More
          </span>
        </div>
      </div>
    </ChartCard>
  );
}

export function Empty() {
  return <p className="py-10 text-center text-sm text-ink-3">Nothing to show for this range yet.</p>;
}

