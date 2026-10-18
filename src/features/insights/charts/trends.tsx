import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLong, formatShort, monthShort, type Period } from '@/data/dates';
import { formatMoney, roundRupee } from '@/data/money';
import type { Account, Bucket, Contribution, Debt, Goal, Split } from '@/data/types';
import { OTHER_COLOUR } from '@/design/chartPalette';
import { byCategory, byGroup, incomeVsSpending, needsWants, netWorthSeries, pct, stackedByMonth, topWithOther, weeklyCashflow, totalOf } from '../aggregate';
import { potBalance } from '@/features/goals/math';
import { savedInPeriod } from '@/features/budget/math';
import { axisProps, BAR_RADIUS, ChartCard, ChartTooltip, gridProps, Legend, LegendItem, moneyTick } from './kit';
import { catName, distinctColours, type InsightCtx } from './context';
import { Empty } from './spending';

const ACCENT = 'rgb(var(--accent))';
const MUTED = 'rgb(var(--ink-3))';

const periodLabel = (p: Period) => `${monthShort(p.start)} ${p.start.slice(2, 4)}`;

export function IncomeVsSpending({ ctx, periods, className }: { ctx: InsightCtx; periods: Period[]; className?: string }) {
  const rows = useMemo(() => incomeVsSpending(ctx.txs, periods).map((r) => ({ ...r, name: periodLabel(r.period) })), [ctx.txs, periods]);
  const withIncome = rows.filter((r) => r.rate != null);
  const avgRate = withIncome.length ? withIncome.reduce((s, r) => s + (r.rate ?? 0), 0) / withIncome.length : null;
  const last = rows[rows.length - 1];
  return (
    <ChartCard
      className={className}
      id="income-spending"
      title="Money in vs money out"
      takeaway={avgRate != null ? `On average you keep ${Math.round(avgRate * 100)}% of what comes in.${last?.rate != null ? ` This month so far: ${Math.round(last.rate * 100)}%.` : ''}` : 'Add income to see your savings rate.'}
      legend={
        <Legend>
          <LegendItem colour={ACCENT} label="Money in" />
          <LegendItem colour="var(--series-2)" label="Money out" />
        </Legend>
      }
      rows={rows}
      columns={[
        { key: 'm', label: 'Month', value: (r) => r.name },
        { key: 'i', label: 'Money in', numeric: true, value: (r) => formatMoney(r.income) },
        { key: 'o', label: 'Money out', numeric: true, value: (r) => formatMoney(r.spent) },
        { key: 's', label: 'Kept', numeric: true, value: (r) => formatMoney(r.saved) },
        { key: 'r', label: 'Savings rate', numeric: true, value: (r) => (r.rate != null ? `${Math.round(r.rate * 100)}%` : '—') },
      ]}
    >
      <div className="h-[220px]">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={56} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip />} />
            <Bar dataKey="income" name="Money in" fill={ACCENT} radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="spent" name="Money out" fill="var(--series-2)" radius={BAR_RADIUS} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Savings rate is a percentage: shown as its own row, never on a second axis. */}
      <div className="mt-3 grid text-center text-xs text-ink-3" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}>
        {rows.map((r) => (
          <span key={r.name} className="num">
            {r.rate != null ? `${Math.round(r.rate * 100)}% kept` : '—'}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

export function NeedsWantsSavings({ ctx, contributions, incomePaise, className }: { ctx: InsightCtx; contributions: Contribution[]; incomePaise: number; className?: string }) {
  const saved = useMemo(() => savedInPeriod(contributions, { start: ctx.range.from, end: ctx.range.to, days: 0 }), [contributions, ctx.range]);
  const nw = useMemo(() => needsWants(ctx.txs, ctx.range, ctx.cats, saved, incomePaise), [ctx.txs, ctx.range, ctx.cats, saved, incomePaise]);
  const segs = [
    { key: 'need', label: 'Needs', value: nw.need, target: 50, colour: 'var(--series-1)' },
    { key: 'want', label: 'Wants', value: nw.want, target: 30, colour: 'var(--series-2)' },
    { key: 'saved', label: 'Saved', value: nw.saved, target: 20, colour: 'var(--series-3)' },
    ...(nw.unknown ? [{ key: 'unknown', label: 'Not tagged', value: nw.unknown, target: 0, colour: OTHER_COLOUR }] : []),
  ];
  const base = Math.max(1, nw.base);
  const wantPct = pct(nw.want, base);
  return (
    <ChartCard
      className={className}
      id="needs-wants"
      title="Needs, wants and savings"
      takeaway={`Wants are ${wantPct}% of your money${wantPct > 30 ? ', above the 30% guide' : ', inside the 30% guide'}. Needs ${pct(nw.need, base)}%, saved ${pct(nw.saved, base)}%.`}
      legend={
        <Legend>
          {segs.map((s) => (
            <LegendItem key={s.key} colour={s.colour} label={s.label} value={`${pct(s.value, base)}%`} />
          ))}
        </Legend>
      }
      rows={segs}
      columns={[
        { key: 'l', label: 'Bucket', value: (r) => r.label },
        { key: 'v', label: 'Amount', numeric: true, value: (r) => formatMoney(r.value) },
        { key: 'p', label: 'Share', numeric: true, value: (r) => `${pct(r.value, base)}%` },
        { key: 't', label: '50/30/20 guide', numeric: true, value: (r) => (r.target ? `${r.target}%` : '—') },
      ]}
    >
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-lg">
        {segs.map((s) => (s.value > 0 ? <div key={s.key} title={`${s.label}: ${formatMoney(s.value)}`} style={{ flexGrow: s.value, background: s.colour }} /> : null))}
        <div style={{ flexGrow: Math.max(0, base - segs.reduce((x, s) => x + s.value, 0)) }} className="bg-shelf" title="Not yet used" />
      </div>
      <div className="relative mt-1 h-5 text-[11px] text-ink-3">
        <span className="absolute -translate-x-1/2" style={{ left: '50%' }}>
          50%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: '80%' }}>
          80%
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-3">The share of {incomePaise ? 'income' : 'money'} in this range. Mark each category as a need or a want under Categories.</p>
    </ChartCard>
  );
}

export function StackedMonths({ ctx, periods, className }: { ctx: InsightCtx; periods: Period[]; className?: string }) {
  const all = useMemo(() => byCategory(ctx.txs, { from: periods[0].start, to: periods[periods.length - 1].end }), [ctx.txs, periods]);
  const top = useMemo(
    () =>
      topWithOther(all, 6)
        .filter((c) => !('other' in c && c.other))
        .map((c) => c.categoryId),
    [all],
  );
  const rows = useMemo(() => stackedByMonth(ctx.txs, periods, top).map((r) => ({ ...r, name: periodLabel(r.period) }) as Record<string, unknown> & { name: string }), [ctx.txs, periods, top]);
  const keys = [...top, 'other'];
  const colours = distinctColours(ctx, keys);
  return (
    <ChartCard
      className={className}
      id="stacked-months"
      title="Six months by category"
      takeaway={top[0] ? `${catName(ctx, top[0])} is your biggest category across the last six months.` : 'Not enough history yet.'}
      legend={
        <Legend>
          {keys.map((k) => (
            <LegendItem key={k} colour={colours.get(k)!} label={catName(ctx, k)} />
          ))}
        </Legend>
      }
      rows={rows}
      columns={[{ key: 'm', label: 'Month', value: (r) => r.name }, ...keys.map((k) => ({ key: k, label: catName(ctx, k), numeric: true, value: (r: (typeof rows)[number]) => formatMoney(Number(r[k] ?? 0)) }))]}
    >
      <div className="h-[240px]">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip />} />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                name={catName(ctx, k)}
                stackId="a"
                fill={colours.get(k)}
                stroke="rgb(var(--sheet))"
                strokeWidth={1}
                maxBarSize={28}
                radius={i === keys.length - 1 ? BAR_RADIUS : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function CategoryTreemap({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const totals = useMemo(() => byCategory(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const groups = byGroup(totals, ctx.cats, ctx.groups);
  const all = totalOf(totals);
  const W = 640;
  const H = 300;
  const leaves = useMemo(() => {
    if (!all) return [];
    const root = hierarchy<{ name: string; value?: number; id?: string; children?: unknown[] }>({
      name: 'root',
      children: groups.map((g) => ({ name: g.name, children: g.children.map((c) => ({ name: catName(ctx, c.categoryId), id: c.categoryId, value: c.total })) })),
    } as never)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<typeof root.data>().size([W, H]).paddingInner(2).paddingTop(18).paddingOuter(0).round(true).tile(treemapSquarify)(root);
    return root.descendants().filter((d) => d.depth > 0) as unknown as { depth: number; x0: number; x1: number; y0: number; y1: number; value: number; data: { name: string; id?: string }; parent: { data: { name: string } } }[];
  }, [groups, all, ctx]);
  const top = groups[0];
  // Colour by the first level (group): four distinct hues, categories labelled inside.
  const groupColour = new Map(groups.map((g, i) => [g.name, g.groupId === 'none' ? OTHER_COLOUR : `var(--series-${(i % 8) + 1})`]));
  return (
    <ChartCard
      className={className}
      id="treemap"
      title="Groups and categories"
      takeaway={top ? `${top.name} is ${pct(top.total, all)}% of spending, led by ${catName(ctx, top.children[0].categoryId)}.` : 'No spending in this range yet.'}
      legend={
        <Legend>
          {groups.map((g) => (
            <LegendItem key={g.groupId} colour={groupColour.get(g.name)!} label={g.name} />
          ))}
        </Legend>
      }
      rows={groups.flatMap((g) => g.children.map((c) => ({ group: g.name, ...c })))}
      columns={[
        { key: 'g', label: 'Group', value: (r) => r.group },
        { key: 'c', label: 'Category', value: (r) => catName(ctx, r.categoryId) },
        { key: 't', label: 'Spent', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      {!all ? (
        <Empty />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
          {leaves.map((n, i) =>
            n.depth === 1 ? (
              <text key={`g${i}`} x={n.x0 + 2} y={n.y0 + 12} className="fill-ink-2 text-[11px] font-medium">
                {n.data.name}
              </text>
            ) : (
              <g key={`c${i}`} className="cursor-pointer" onClick={() => n.data.id && ctx.onFilter({ categoryIds: [n.data.id], range: ctx.range })}>
                <title>{`${n.data.name}: ${formatMoney(n.value)}`}</title>
                <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={n.y1 - n.y0} rx={6} fill={groupColour.get(n.parent.data.name) ?? OTHER_COLOUR} />
                {n.x1 - n.x0 > 70 && n.y1 - n.y0 > 34 && (
                  <>
                    <text x={n.x0 + 8} y={n.y0 + 18} className="text-[12px] font-medium" fill="white">
                      {n.data.name.length * 6.5 > n.x1 - n.x0 - 12 ? `${n.data.name.slice(0, Math.floor((n.x1 - n.x0 - 16) / 6.5))}…` : n.data.name}
                    </text>
                    <text x={n.x0 + 8} y={n.y0 + 33} className="text-[11px]" fill="white" fillOpacity={0.85}>
                      {formatMoney(n.value)}
                    </text>
                  </>
                )}
              </g>
            ),
          )}
        </svg>
      )}
    </ChartCard>
  );
}

interface FlowNode {
  id: string;
  name: string;
  colour: string;
}

export function FlowSankey({ ctx, incomePaise, className }: { ctx: InsightCtx; incomePaise: number; className?: string }) {
  const totals = useMemo(() => byCategory(ctx.txs, ctx.range), [ctx.txs, ctx.range]);
  const groups = byGroup(totals, ctx.cats, ctx.groups);
  const spent = totalOf(totals);
  const W = 640;
  const H = 300;
  const graph = useMemo(() => {
    if (!incomePaise && !spent) return null;
    const source = Math.max(incomePaise, spent);
    const kept = Math.max(0, incomePaise - spent);
    const nodes: FlowNode[] = [{ id: 'in', name: incomePaise >= spent ? 'Money in' : 'Money in + savings', colour: ACCENT }];
    const links: { source: number; target: number; value: number }[] = [];
    groups.forEach((g) => {
      nodes.push({ id: g.groupId, name: g.name, colour: MUTED });
      links.push({ source: 0, target: nodes.length - 1, value: g.total });
    });
    if (kept > 0) {
      nodes.push({ id: 'kept', name: 'Kept', colour: 'var(--series-3)' });
      links.push({ source: 0, target: nodes.length - 1, value: kept });
    }
    const shown = groups.flatMap((g) => topWithOther(g.children, 3).map((c) => c.categoryId));
    const colours = distinctColours(ctx, shown);
    groups.forEach((g, gi) => {
      for (const c of topWithOther(g.children, 3)) {
        nodes.push({ id: `c-${g.groupId}-${c.categoryId}`, name: catName(ctx, c.categoryId), colour: colours.get(c.categoryId) ?? OTHER_COLOUR });
        links.push({ source: gi + 1, target: nodes.length - 1, value: c.total });
      }
    });
    const layout = sankey<FlowNode, object>()
      .nodeWidth(10)
      .nodePadding(10)
      .extent([
        [0, 4],
        [W, H - 4],
      ]);
    const g = layout({ nodes: nodes.map((n) => ({ ...n })), links: links.filter((l) => l.value > 0).map((l) => ({ ...l })) });
    return { ...g, source };
  }, [groups, incomePaise, spent, ctx]);
  const kept = Math.max(0, incomePaise - spent);
  return (
    <ChartCard
      className={className}
      id="flow"
      title="Where this month's money flowed"
      takeaway={incomePaise ? `Of ${formatMoney(incomePaise)} in, ${formatMoney(spent)} went to spending and ${formatMoney(kept)} stayed with you.` : `You've spent ${formatMoney(spent)}. Add income to see the full flow.`}
      rows={groups.flatMap((g) => g.children.map((c) => ({ group: g.name, ...c })))}
      columns={[
        { key: 'g', label: 'Group', value: (r) => r.group },
        { key: 'c', label: 'Category', value: (r) => catName(ctx, r.categoryId) },
        { key: 't', label: 'Amount', numeric: true, value: (r) => formatMoney(r.total) },
      ]}
    >
      {!graph ? (
        <Empty />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
          <g fill="none">
            {graph.links.map((l: SankeyLink<FlowNode, object>, i: number) => (
              <path key={i} d={sankeyLinkHorizontal()(l) ?? undefined} stroke={(l.target as SankeyNode<FlowNode, object>).colour} strokeOpacity={0.25} strokeWidth={Math.max(1, l.width ?? 1)}>
                <title>{`${(l.source as FlowNode).name} → ${(l.target as FlowNode).name}: ${formatMoney(l.value)}`}</title>
              </path>
            ))}
          </g>
          {graph.nodes.map((n: SankeyNode<FlowNode, object>) => {
            const right = (n.x0 ?? 0) > W / 2;
            const h = (n.y1 ?? 0) - (n.y0 ?? 0);
            return (
              <g key={n.id}>
                <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(1, h)} rx={2} fill={n.colour} />
                {h > 9 && (
                  <text x={right ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2} dy="0.35em" textAnchor={right ? 'end' : 'start'} className="fill-ink-2 text-[11px]">
                    {n.name}, {formatMoney(n.value ?? 0)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </ChartCard>
  );
}

export function NetWorthChart({ ctx, periods, accounts, splits, debts, className }: { ctx: InsightCtx; periods: Period[]; accounts: Account[]; splits: Split[]; debts: Debt[]; className?: string }) {
  const rows = useMemo(() => netWorthSeries({ txs: ctx.txs, periods, accounts, splits, debts }).map((r) => ({ ...r, name: periodLabel(r.period) })), [ctx.txs, periods, accounts, splits, debts]);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const change = last && first ? last.net - first.net : 0;
  return (
    <ChartCard
      className={className}
      id="net-worth"
      title="Net worth over time"
      takeaway={last ? `You're worth about ${formatMoney(last.net)} today, ${change >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(change))} over ${rows.length} months.` : 'Not enough history yet.'}
      legend={
        <Legend>
          <LegendItem colour={ACCENT} line label="Net worth" />
        </Legend>
      }
      rows={rows}
      columns={[
        { key: 'm', label: 'Month end', value: (r) => r.name },
        { key: 'c', label: 'Cash & accounts', numeric: true, value: (r) => formatMoney(r.cash) },
        { key: 'o', label: 'Owed to me', numeric: true, value: (r) => formatMoney(r.owedToMe) },
        { key: 'i', label: 'I owe', numeric: true, value: (r) => formatMoney(r.iOwe) },
        { key: 'n', label: 'Net worth', numeric: true, value: (r) => formatMoney(r.net) },
      ]}
    >
      <div className="h-[200px]">
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={60} />
            <Tooltip cursor={{ stroke: MUTED, strokeWidth: 1 }} content={<ChartTooltip />} />
            <Area dataKey="net" name="Net worth" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.1} dot={{ r: 4, fill: ACCENT, stroke: 'rgb(var(--sheet))', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-ink-3">Accounts + cash + savings pots + money owed to you − money you owe.</p>
    </ChartCard>
  );
}

export function WeeklyCashflow({ ctx, className }: { ctx: InsightCtx; className?: string }) {
  const rows = useMemo(() => weeklyCashflow(ctx.txs, ctx.range).map((r) => ({ ...r, net: r.moneyIn - r.moneyOut })), [ctx.txs, ctx.range]);
  const outWeeks = rows.filter((r) => r.moneyOut > 0);
  const avgOut = outWeeks.length ? roundRupee(outWeeks.reduce((s, r) => s + r.moneyOut, 0) / outWeeks.length) : 0;
  // Income arrives in one big week; cap the axis so spending weeks stay readable and label the clipped bars.
  const maxOut = Math.max(0, ...rows.map((r) => r.moneyOut));
  const maxIn = Math.max(0, ...rows.map((r) => r.moneyIn));
  const cap = maxOut > 0 && maxIn > maxOut * 3 ? Math.ceil((maxOut * 2.5) / 10_000) * 10_000 : undefined;
  return (
    <ChartCard
      className={className}
      id="cashflow"
      title="Weekly cash flow"
      takeaway={avgOut ? `A typical week costs about ${formatMoney(avgOut)}.` : 'No spending in this range yet.'}
      legend={
        <Legend>
          <LegendItem colour={ACCENT} label="Money in" />
          <LegendItem colour="var(--series-2)" label="Money out" />
        </Legend>
      }
      rows={rows}
      columns={[
        { key: 'w', label: 'Week of', value: (r) => formatLong(r.week) },
        { key: 'i', label: 'Money in', numeric: true, value: (r) => formatMoney(r.moneyIn) },
        { key: 'o', label: 'Money out', numeric: true, value: (r) => formatMoney(r.moneyOut) },
      ]}
    >
      <div className="h-[200px]">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="week" {...axisProps} tickFormatter={(w: string) => formatShort(w)} minTickGap={12} />
            <YAxis {...axisProps} tickFormatter={moneyTick} width={56} domain={cap ? [0, cap] : [0, 'auto']} allowDataOverflow={Boolean(cap)} />
            <Tooltip cursor={{ fill: 'rgb(var(--shelf))' }} content={<ChartTooltip labelFormatter={(l) => `Week of ${formatShort(String(l))}`} />} />
            <Bar dataKey="moneyIn" name="Money in" fill={ACCENT} radius={BAR_RADIUS} maxBarSize={18} isAnimationActive={false}>
              {cap && (
                <LabelList
                  dataKey="moneyIn"
                  content={(p: { x?: number | string; width?: number | string; value?: number | string }) =>
                    Number(p.value) > cap ? (
                      <text x={Number(p.x) + Number(p.width) / 2} y={18} textAnchor="middle" className="fill-ink-2 text-[10px]">
                        {formatMoney(Number(p.value), { compact: true })} ↑
                      </text>
                    ) : null
                  }
                />
              )}
            </Bar>
            <Bar dataKey="moneyOut" name="Money out" fill="var(--series-2)" radius={BAR_RADIUS} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {cap && <p className="mt-2 text-xs text-ink-3">Income weeks run off the top of the chart (marked ↑) so everyday weeks stay readable.</p>}
    </ChartCard>
  );
}

export function SavingsProgress({ goals, buckets, contributions, className }: { goals: Goal[]; buckets: Bucket[]; contributions: Contribution[]; className?: string }) {
  const items = [
    ...goals.filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name, kind: 'Goal', balance: potBalance(contributions, 'goal', g.id), target: g.targetPaise })),
    ...buckets.filter((b) => !b.archived).map((b) => ({ id: b.id, name: b.name, kind: 'Bucket', balance: potBalance(contributions, 'bucket', b.id), target: b.targetPaise ?? 0 })),
  ];
  const total = items.reduce((s, i) => s + i.balance, 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ChartCard
      className={className}
      id="savings"
      title="Savings pots"
      takeaway={items.length ? `${formatMoney(total)} set aside across ${items.length} ${items.length === 1 ? 'pot' : 'pots'}.` : 'Create a goal or savings bucket to see it here.'}
      rows={items}
      columns={[
        { key: 'n', label: 'Pot', value: (r) => r.name },
        { key: 'k', label: 'Type', value: (r) => r.kind },
        { key: 'b', label: 'Saved', numeric: true, value: (r) => formatMoney(r.balance) },
        { key: 't', label: 'Target', numeric: true, value: (r) => (r.target ? formatMoney(r.target) : '—') },
      ]}
    >
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id} onMouseEnter={() => setHover(i.id)} onMouseLeave={() => setHover(null)}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-ink">{i.name}</span>
              <span className="text-ink-3">
                <span className="num text-ink">{formatMoney(i.balance)}</span>
                {i.target ? <> of <span className="num">{formatMoney(i.target)}</span></> : null}
              </span>
            </div>
            <div className="h-2 rounded-full bg-mist">
              <div className="h-full rounded-full bg-accent" style={{ width: `${i.target ? Math.min(100, (i.balance / i.target) * 100) : 100}%`, opacity: hover && hover !== i.id ? 0.5 : 1 }} />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

