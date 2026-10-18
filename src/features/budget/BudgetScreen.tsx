import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, CornerDownRight, Info, Plus, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { formatMoney, paiseToInput, parseMoney } from '@/data/money';
import { periodLabel, shiftPeriod } from '@/data/dates';
import type { Allocation, Budget, BudgetMode, Category } from '@/data/types';
import { useActiveCategories, useCategoryMap, useCurrentPeriod, useToday, categoryColour } from '@/data/selectors';
import { Amount, Button, EmptyState, Field, IconButton, Input, ProgressBar, Segmented, Sheet, StateTag, Toggle } from '@/design/ui';
import { Icon } from '@/design/icons';
import { paceNudges, summariseBudget, templateAllocations, type CategoryLine, type TemplateId } from './math';
import { saveBudget } from './actions';
import { repo } from '@/data/repo';
import { potBalance } from '@/features/goals/math';

const TEMPLATES: { id: TemplateId; title: string; body: string }[] = [
  { id: 'student', title: 'Student essentials', body: 'Sensible limits for food, travel and study.' },
  { id: '503020', title: '50 / 30 / 20', body: 'Half on needs, 30% on wants, 20% saved.' },
  { id: 'history', title: 'My last 3 months', body: 'Limits from what you actually spent.' },
];

export default function BudgetScreen() {
  const [offset, setOffset] = useState(0);
  const period = useCurrentPeriod(offset);
  const txs = useData((s) => s.transactions);
  const budgets = useData((s) => s.budgets);
  const goals = useData((s) => s.goals);
  const buckets = useData((s) => s.buckets);
  const contributions = useData((s) => s.contributions);
  const settings = useData((s) => s.settings);
  const catMap = useCategoryMap();
  const cats = useActiveCategories();
  const groups = useData((s) => s.groups);
  const today = useToday();
  const showToast = useUI((s) => s.showToast);

  const budget = budgets.find((b) => b.id === period.start);
  const summary = useMemo(
    () => summariseBudget({ budget, budgets, txs, today: today > period.end ? period.end : today, startDay: settings.monthStartDay, period }),
    [budget, budgets, txs, today, period, settings.monthStartDay],
  );
  const nudges = useMemo(() => (offset === 0 ? paceNudges(summary) : []), [summary, offset]);
  const [editing, setEditing] = useState<{ type: Allocation['targetType']; id: string } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [totalOpen, setTotalOpen] = useState(false);

  const mode: BudgetMode = budget?.mode ?? settings.budgetMode;
  const prevBudget = budgets.find((b) => b.id === shiftPeriod(period, -1, settings.monthStartDay).start);

  const update = async (next: Budget) => {
    await saveBudget(next);
  };

  const applyTemplate = async (template: TemplateId) => {
    const income = budget?.incomePaise || summary.incomePaise || 1_000_000;
    const allocations = templateAllocations({
      template,
      incomePaise: income,
      categories: cats,
      txs,
      today,
      startDay: settings.monthStartDay,
      savingsTargets: [
        ...goals.filter((g) => !g.archived).map((g) => ({ targetType: 'goal' as const, targetId: g.id })),
        ...buckets.filter((b) => !b.archived).map((b) => ({ targetType: 'bucket' as const, targetId: b.id })),
      ],
      rollover: settings.defaultRollover,
    });
    if (!allocations.length) {
      showToast({ message: 'Not enough history yet. Try Student essentials.' });
      return;
    }
    const total = allocations.filter((a) => a.targetType === 'category').reduce((s, a) => s + a.amountPaise, 0);
    await update({ id: period.start, mode, incomePaise: budget?.incomePaise ?? 0, totalLimitPaise: mode === 'simple' ? total : 0, allocations });
    setTemplatesOpen(false);
    showToast({ message: 'Budget ready. Tweak any line by tapping it.' });
  };

  const linesByGroup = useMemo(() => {
    const byId = new Map(summary.lines.map((l) => [l.categoryId, l]));
    return [...groups]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ group: g, lines: cats.filter((c) => c.groupId === g.id && byId.has(c.id)).map((c) => byId.get(c.id)!) }))
      .filter((g) => g.lines.length);
  }, [summary.lines, groups, cats]);

  const unbudgeted = useMemo(() => {
    const has = new Set(summary.lines.map((l) => l.categoryId));
    const spent = new Map<string, number>();
    for (const t of txs) if (t.type === 'expense' && !t.excluded && t.categoryId && t.date >= period.start && t.date <= period.end) spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amountPaise);
    return cats.filter((c) => !has.has(c.id)).map((c) => ({ c, spent: spent.get(c.id) ?? 0 })).sort((a, b) => b.spent - a.spent);
  }, [summary.lines, cats, txs, period]);

  const savingsAllocs = (budget?.allocations ?? []).filter((a) => a.targetType !== 'category');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">Budget</h1>
          <div className="mt-1 flex items-center gap-1">
            <IconButton label="Previous month" onClick={() => setOffset((o) => o - 1)} className="-ml-3">
              <ChevronLeft size={18} />
            </IconButton>
            <span className="min-w-[9rem] text-center text-sm font-medium text-ink-2">{periodLabel(period)}</span>
            <IconButton label="Next month" onClick={() => setOffset((o) => o + 1)}>
              <ChevronRight size={18} />
            </IconButton>
            {offset !== 0 && (
              <button className="h-11 px-2 text-sm font-medium text-accent" onClick={() => setOffset(0)}>
                This month
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Budget style"
            value={mode}
            onChange={async (m) => {
              await repo.settings.patch({ budgetMode: m });
              if (budget) await update({ ...budget, mode: m, totalLimitPaise: m === 'simple' ? budget.totalLimitPaise || summary.lines.reduce((s, l) => s + l.limitPaise, 0) : budget.totalLimitPaise });
            }}
            options={[
              { value: 'simple', label: 'Simple' },
              { value: 'zero', label: 'Every rupee a job' },
            ]}
          />
          {budget && (
            <Button size="sm" variant="ghost" onClick={() => setTemplatesOpen(true)} icon={<Wand2 size={16} />}>
              Templates
            </Button>
          )}
        </div>
      </header>

      {!budget ? (
        <div className="flex flex-col gap-4">
          <EmptyState
            art="target"
            title={`No budget for ${periodLabel(period)} yet.`}
            body={mode === 'zero' ? 'Give every rupee of this month\'s money a job: spending categories, goals and savings, until nothing is left to assign.' : 'Pick a starting point. You can change every number afterwards.'}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {prevBudget && (
              <TemplateButton title="Copy last month" body="Same limits as before, fresh spending." onClick={() => update({ ...prevBudget, id: period.start })} icon={<CornerDownRight size={18} />} />
            )}
            {TEMPLATES.map((t) => (
              <TemplateButton key={t.id} title={t.title} body={t.body} onClick={() => applyTemplate(t.id)} icon={<Sparkles size={18} />} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Summary: asymmetric — main figure left, mode-specific detail right */}
          <section className="grid gap-6 lg:grid-cols-12 lg:gap-10" aria-label="Budget summary">
            <div className="lg:col-span-7">
              {mode === 'zero' ? (
                <ZeroHeader leftToAssign={summary.leftToAssignPaise} income={summary.incomePaise} onEditIncome={() => setTotalOpen(true)} />
              ) : (
                <>
                  <p className="text-[15px] text-ink-2">Left to spend this month</p>
                  <Amount hero paise={summary.leftPaise} className={clsx('mt-1 block text-[clamp(2.5rem,8vw,4rem)] font-semibold leading-none tracking-[-0.035em]', summary.leftPaise < 0 && 'text-over')} />
                  <button onClick={() => setTotalOpen(true)} className="mt-3 inline-flex h-11 items-center gap-1 text-[15px] text-ink-2 hover:text-ink">
                    of <span className="num font-medium text-ink underline decoration-line underline-offset-4">{formatMoney(summary.spendablePaise)}</span> for the month
                  </button>
                </>
              )}
              <div className="mt-4 max-w-md">
                <ProgressBar value={summary.spendablePaise ? summary.spentPaise / summary.spendablePaise : 0} state={summary.state === 'none' ? 'ok' : summary.state} label="Spent of budget" />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 self-end lg:col-span-5">
              <div className="rounded-2xl bg-shelf/70 p-4">
                <dt className="text-sm text-ink-2">Safe to spend today</dt>
                <dd className="num mt-1 text-xl font-medium">{offset === 0 ? formatMoney(summary.safeTodayPaise) : '—'}</dd>
              </div>
              <div className="rounded-2xl bg-shelf/70 p-4">
                <dt className="text-sm text-ink-2">Spent so far</dt>
                <dd className="num mt-1 text-xl font-medium">{formatMoney(summary.spentPaise)}</dd>
              </div>
            </dl>
          </section>

          {nudges.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Heads-up">
              {nudges.slice(0, 3).map((n) => (
                <li key={n.categoryId} className="flex items-start gap-3 rounded-2xl border border-warn/25 bg-warn/5 px-4 py-3 text-[15px]">
                  <Info size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <span>
                    At this pace you'll overspend <span className="font-medium">{catMap.get(n.categoryId)?.name}</span> by about <span className="num font-medium">{formatMoney(n.overByPaise)}</span>.
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
            <section className="lg:col-span-7" aria-labelledby="spend-title">
              <div className="mb-3 flex items-end justify-between">
                <h2 id="spend-title" className="text-[17px]">
                  Spending
                </h2>
                <span className="text-sm text-ink-3">Tap a line to change it</span>
              </div>
              {linesByGroup.length === 0 && <p className="text-sm text-ink-3">No category limits yet. Add one below.</p>}
              <div className="flex flex-col gap-6">
                {linesByGroup.map(({ group, lines }) => (
                  <div key={group.id}>
                    <p className="label-quiet mb-2">{group.name}</p>
                    <ul className="flex flex-col gap-1">
                      {lines.map((l) => (
                        <BudgetLine key={l.categoryId} line={l} cat={catMap.get(l.categoryId)} onEdit={() => setEditing({ type: 'category', id: l.categoryId })} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {unbudgeted.length > 0 && (
                <details className="group mt-6">
                  <summary className="flex h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-accent">
                    <Plus size={16} aria-hidden /> Add a limit for another category ({unbudgeted.length})
                  </summary>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {unbudgeted.map(({ c, spent }) => (
                      <li key={c.id}>
                        <button onClick={() => setEditing({ type: 'category', id: c.id })} className="press flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-shelf">
                          <span style={{ color: categoryColour(c) }}>
                            <Icon name={c.icon} size={18} />
                          </span>
                          <span className="flex-1 truncate text-sm">{c.name}</span>
                          {spent > 0 && <span className="num text-xs text-ink-3">{formatMoney(spent)} spent</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="lg:col-span-5" aria-labelledby="save-title">
              <div className="mb-3 flex items-end justify-between">
                <h2 id="save-title" className="text-[17px]">
                  Saving
                </h2>
                <span className="num text-sm text-ink-3">{formatMoney(summary.savingsAllocatedPaise)} this month</span>
              </div>
              {goals.filter((g) => !g.archived).length + buckets.filter((b) => !b.archived).length === 0 ? (
                <p className="text-sm text-ink-3">Create a goal or savings bucket to give money a job here.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {[...goals.filter((g) => !g.archived).map((g) => ({ type: 'goal' as const, id: g.id, name: g.name, icon: g.icon })), ...buckets.filter((b) => !b.archived).map((b) => ({ type: 'bucket' as const, id: b.id, name: b.name, icon: b.icon }))].map((p) => {
                    const a = savingsAllocs.find((x) => x.targetType === p.type && x.targetId === p.id);
                    const bal = potBalance(contributions, p.type, p.id);
                    return (
                      <li key={p.id}>
                        <button onClick={() => setEditing({ type: p.type, id: p.id })} className="press flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2 text-left hover:bg-shelf">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-accent">
                            <Icon name={p.icon} size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px]">{p.name}</span>
                            <span className="block text-[13px] text-ink-3">
                              <span className="num">{formatMoney(bal)}</span> saved so far
                            </span>
                          </span>
                          <span className={clsx('num text-[15px]', a ? 'text-ink' : 'text-ink-3')}>{a ? formatMoney(a.amountPaise) : 'Set'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {budget && editing && (
        <AllocationSheet
          budget={budget}
          target={editing}
          line={summary.lines.find((l) => l.categoryId === editing.id)}
          name={editing.type === 'category' ? catMap.get(editing.id)?.name ?? '' : editing.type === 'goal' ? goals.find((g) => g.id === editing.id)?.name ?? '' : buckets.find((b) => b.id === editing.id)?.name ?? ''}
          onClose={() => setEditing(null)}
          onSave={update}
        />
      )}
      {budget && <TotalSheet open={totalOpen} onClose={() => setTotalOpen(false)} budget={budget} mode={mode} onSave={update} />}
      <Sheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="Start from a template">
        <p className="mb-4 text-sm text-ink-2">This replaces this month's limits. Spending stays as it is.</p>
        <div className="grid gap-2">
          {TEMPLATES.map((t) => (
            <TemplateButton key={t.id} title={t.title} body={t.body} onClick={() => applyTemplate(t.id)} icon={<Sparkles size={18} />} />
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function ZeroHeader({ leftToAssign, income, onEditIncome }: { leftToAssign: number; income: number; onEditIncome: () => void }) {
  const done = leftToAssign === 0;
  const over = leftToAssign < 0;
  return (
    <>
      <p className="text-[15px] text-ink-2">Left to assign</p>
      <Amount hero paise={leftToAssign} className={clsx('mt-1 block text-[clamp(2.5rem,8vw,4rem)] font-semibold leading-none tracking-[-0.035em]', over && 'text-over', done && 'text-accent')} />
      <p className="mt-3 text-[15px] text-ink-2">
        {done ? 'Every rupee has a job. ' : over ? "You've assigned more than you have. Lower a line or two. " : 'Give the rest a job: a category, a goal or a bucket. '}
        <button onClick={onEditIncome} className="inline-flex h-11 items-center">
          Income this month: <span className="num ml-1 font-medium text-ink underline decoration-line underline-offset-4">{formatMoney(income)}</span>
        </button>
      </p>
    </>
  );
}

function BudgetLine({ line, cat, onEdit }: { line: CategoryLine; cat?: Category; onEdit: () => void }) {
  const over = line.leftPaise < 0;
  return (
    <li>
      <button onClick={onEdit} className="press w-full rounded-2xl px-2 py-3 text-left hover:bg-shelf/70">
        <div className="flex items-center gap-3">
          <span style={{ color: categoryColour(cat) }}>
            <Icon name={cat?.icon ?? 'package'} size={18} />
          </span>
          <span className="flex-1 truncate text-[15px]">{cat?.name}</span>
          <StateTag state={line.state} />
          <span className="num text-[15px]">{formatMoney(line.spentPaise)}</span>
        </div>
        <div className="mt-2 pl-[30px]">
          <ProgressBar value={line.availablePaise ? line.spentPaise / line.availablePaise : 0} state={line.state} label={`${cat?.name} spent of limit`} />
          <p className="mt-1.5 flex justify-between text-[13px] text-ink-3">
            <span>
              {over ? (
                <>
                  <span className="num">{formatMoney(-line.leftPaise)}</span> over
                </>
              ) : (
                <>
                  <span className="num">{formatMoney(line.leftPaise)}</span> left
                </>
              )}
              {line.carriedPaise > 0 && (
                <>
                  ,{' '}
                 includes <span className="num">{formatMoney(line.carriedPaise)}</span> carried over
                </>
              )}
            </span>
            <span>
              of <span className="num">{formatMoney(line.availablePaise)}</span>
            </span>
          </p>
        </div>
      </button>
    </li>
  );
}

function AllocationSheet({
  budget,
  target,
  name,
  line,
  onClose,
  onSave,
}: {
  budget: Budget;
  target: { type: Allocation['targetType']; id: string };
  name: string;
  line?: CategoryLine;
  onClose: () => void;
  onSave: (b: Budget) => Promise<void>;
}) {
  const existing = budget.allocations.find((a) => a.targetType === target.type && a.targetId === target.id);
  const defaultRollover = useData((s) => s.settings.defaultRollover);
  const [amount, setAmount] = useState(existing ? paiseToInput(existing.amountPaise) : '');
  const [rollover, setRollover] = useState(existing?.rollover ?? defaultRollover);

  const save = async () => {
    const p = parseMoney(amount) ?? 0;
    const others = budget.allocations.filter((a) => !(a.targetType === target.type && a.targetId === target.id));
    const allocations = p > 0 ? [...others, { targetType: target.type, targetId: target.id, amountPaise: p, rollover }] : others;
    const categoryTotal = allocations.filter((a) => a.targetType === 'category').reduce((s, a) => s + a.amountPaise, 0);
    // In simple mode the monthly total grows to fit category limits but never shrinks silently.
    const totalLimitPaise = budget.mode === 'simple' ? Math.max(budget.totalLimitPaise, categoryTotal) : budget.totalLimitPaise;
    await onSave({ ...budget, allocations, totalLimitPaise });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={name}
      footer={
        <div className="flex gap-2">
          {existing && (
            <Button
              variant="ghost"
              onClick={async () => {
                await onSave({ ...budget, allocations: budget.allocations.filter((a) => a !== existing) });
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button variant="primary" className="flex-1" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={target.type === 'category' ? 'Limit for this month' : 'Put aside this month'} htmlFor="alloc-amount" helper={line ? `Spent so far: ${formatMoney(line.spentPaise)}` : undefined}>
          <Input id="alloc-amount" autoFocus inputMode="decimal" className="num text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        {target.type === 'category' && (
          <Toggle checked={rollover} onChange={setRollover} label="Carry unspent money to next month" description="Overspending never carries; only what's left over." />
        )}
      </form>
    </Sheet>
  );
}

function TotalSheet({ open, onClose, budget, mode, onSave }: { open: boolean; onClose: () => void; budget: Budget; mode: BudgetMode; onSave: (b: Budget) => Promise<void> }) {
  const [value, setValue] = useState('');
  const isZero = mode === 'zero';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isZero ? 'Income this month' : 'Monthly total'}
      footer={
        <Button
          variant="primary"
          className="w-full"
          onClick={async () => {
            const p = parseMoney(value);
            if (p != null) await onSave(isZero ? { ...budget, incomePaise: p } : { ...budget, totalLimitPaise: p });
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <Field
        label={isZero ? 'Money to give a job' : 'Spend no more than'}
        htmlFor="total-amount"
        helper={isZero ? 'Leave empty to use the income you have logged this month.' : 'Category limits sit inside this total.'}
      >
        <Input
          id="total-amount"
          autoFocus
          inputMode="decimal"
          className="num text-lg"
          defaultValue={paiseToInput(isZero ? budget.incomePaise : budget.totalLimitPaise)}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}

function TemplateButton({ title, body, onClick, icon }: { title: string; body: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className="press flex items-start gap-3 rounded-2xl border border-line bg-sheet p-4 text-left hover:border-accent/50">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span>
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{body}</span>
      </span>
    </button>
  );
}

