import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, Image } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/data/store';
import { periodLabel } from '@/data/dates';
import { formatMoney } from '@/data/money';
import { useBudgetSummary, useCategoryMap, useCurrentPeriod, useToday, categoryColour } from '@/data/selectors';
import { Button, IconButton, StateTag } from '@/design/ui';
import { Icon } from '@/design/icons';
import { totalIncome } from '@/features/budget/math';
import { projectGoal } from '@/features/goals/math';
import { applyFilter } from '@/features/transactions/filter';
import { downloadCSV, downloadNodeAsImage } from '@/features/settings/exporters';
import { byCategory, pct, topPlaces, totalOf } from './aggregate';
import { computeInsights } from './engine';

/** A one-page monthly report, shareable as an image or PDF (via the print dialog). */
export default function ReportScreen() {
  const [offset, setOffset] = useState(0);
  const period = useCurrentPeriod(offset);
  const summary = useBudgetSummary(offset);
  const txs = useData((s) => s.transactions);
  const goals = useData((s) => s.goals);
  const contributions = useData((s) => s.contributions);
  const recurring = useData((s) => s.recurring);
  const settings = useData((s) => s.settings);
  const cats = useCategoryMap();
  const today = useToday();
  const ref = useRef<HTMLDivElement>(null);

  const range = { from: period.start, to: period.end };
  const totals = useMemo(() => byCategory(txs, range), [txs, period.start]);
  const places = useMemo(() => topPlaces(txs, range, 5), [txs, period.start]);
  const income = useMemo(() => totalIncome(txs, period), [txs, period]);
  const spent = totalOf(totals);
  const kept = income - spent;
  const insights = useMemo(() => computeInsights({ txs, period, today: today > period.end ? period.end : today, startDay: settings.monthStartDay, cats, recurring }).slice(0, 3), [txs, period, today, settings.monthStartDay, cats, recurring]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-1">
          <Link to="/insights" aria-label="Back to insights" className="-ml-2 grid h-11 w-11 place-items-center rounded-xl hover:bg-shelf">
            <ArrowLeft size={20} />
          </Link>
          <IconButton label="Previous month" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="min-w-[8rem] text-center text-sm font-medium">{periodLabel(period)}</span>
          <IconButton label="Next month" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Image size={16} />} onClick={() => ref.current && downloadNodeAsImage(ref.current, `paisa-report-${period.start}.png`)}>
            Image
          </Button>
          <Button size="sm" icon={<FileText size={16} />} onClick={() => window.print()}>
            PDF
          </Button>
          <Button size="sm" variant="ghost" icon={<Download size={16} />} onClick={() => downloadCSV(applyFilter(txs, { range }, cats), cats, `paisa-${period.start}`)}>
            CSV
          </Button>
        </div>
      </header>

      <article ref={ref} className="report card mx-auto w-full max-w-3xl p-6 sm:p-10">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="label-quiet">Monthly report</p>
            <h1 className="mt-1 text-[32px] leading-tight">{periodLabel(period)}</h1>
            {settings.name && <p className="text-sm text-ink-3">{settings.name}</p>}
          </div>
          <span className="text-lg font-semibold text-accent">Paisa</span>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-line py-6 sm:grid-cols-4" aria-label="Totals">
          <Figure label="Money in" value={formatMoney(income)} />
          <Figure label="Spent" value={formatMoney(spent)} />
          <Figure label="Kept" value={formatMoney(kept)} />
          <Figure label="Savings rate" value={income ? `${Math.round((kept / income) * 100)}%` : '—'} />
        </section>

        {summary.hasBudget && (
          <section className="border-b border-line py-6">
            <h2 className="mb-2 text-[15px] font-medium">Budget</h2>
            <p className="text-[15px] text-ink-2">
              Spent <span className="num text-ink">{formatMoney(summary.spentPaise)}</span> of <span className="num text-ink">{formatMoney(summary.spendablePaise)}</span>.{' '}
              <StateTag state={summary.state === 'none' ? 'ok' : summary.state} />
            </p>
          </section>
        )}

        <section className="border-b border-line py-6">
          <h2 className="mb-3 text-[15px] font-medium">Where it went</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="pb-2 font-normal">Category</th>
                <th className="pb-2 text-right font-normal">Spent</th>
                <th className="pb-2 text-right font-normal">Share</th>
                <th className="hidden pb-2 text-right font-normal sm:table-cell">Limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {totals.map((t) => {
                const c = cats.get(t.categoryId);
                const line = summary.lines.find((l) => l.categoryId === t.categoryId);
                return (
                  <tr key={t.categoryId}>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2">
                        <span style={{ color: categoryColour(c) }}>
                          <Icon name={c?.icon ?? 'package'} size={15} />
                        </span>
                        {c?.name ?? 'Needs a category'}
                      </span>
                    </td>
                    <td className="num py-2 text-right">{formatMoney(t.total)}</td>
                    <td className="num py-2 text-right text-ink-3">{pct(t.total, spent)}%</td>
                    <td className="num hidden py-2 text-right text-ink-3 sm:table-cell">{line ? formatMoney(line.availablePaise) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-3 text-[15px] font-medium">Top places</h2>
            <ol className="flex flex-col gap-1.5 text-sm">
              {places.map((p) => (
                <li key={p.key} className="flex justify-between gap-3">
                  <span className="truncate">{p.place}</span>
                  <span className="num shrink-0 text-ink-2">
                    {p.visits}×, {formatMoney(p.total)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="mb-3 text-[15px] font-medium">Goals</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {goals
                .filter((g) => !g.archived)
                .map((g) => {
                  const p = projectGoal(g, contributions, today);
                  return (
                    <li key={g.id} className="flex justify-between gap-3">
                      <span className="truncate">{g.name}</span>
                      <span className="num shrink-0 text-ink-2">
                        {formatMoney(p.saved)}, {Math.round(p.progress * 100)}%
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </section>

        {insights.length > 0 && (
          <section className="border-t border-line pt-6">
            <h2 className="mb-3 text-[15px] font-medium">Worth knowing</h2>
            <ul className="flex flex-col gap-2 text-sm text-ink-2">
              {insights.map((i) => (
                <li key={i.id}>
                  <span className="font-medium text-ink">{i.title}.</span> {i.body}
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-ink-3">{label}</p>
      <p className="num mt-1 text-xl font-medium">{value}</p>
    </div>
  );
}
