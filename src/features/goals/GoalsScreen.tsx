import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { ArrowLeftRight, Minus, Pencil, Plus, Shield, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '@/data/store';
import { repo } from '@/data/repo';
import { useUI } from '@/app/ui';
import { formatLong, todayISO } from '@/data/dates';
import { formatMoney, paiseToInput, parseMoney, rupees } from '@/data/money';
import type { Bucket, BucketRule, Contribution, Debt, Goal } from '@/data/types';
import { useToday } from '@/data/selectors';
import { Button, Chip, EmptyState, Field, Input, ProgressBar, Ring, Segmented, Select, Sheet, Toggle, SPRING } from '@/design/ui';
import { Icon, ICON_NAMES } from '@/design/icons';
import { buildsTo, potBalance, projectGoal, savingRate } from './math';
import { addDebt, contribute, movePot, payDebt, saveBucket, saveGoal } from './actions';

type PotRef = { type: Contribution['potType']; id: string; name: string };

export default function GoalsScreen() {
  const goals = useData((s) => s.goals);
  const buckets = useData((s) => s.buckets);
  const contributions = useData((s) => s.contributions);
  const debts = useData((s) => s.debts);
  const settings = useData((s) => s.settings);
  const today = useToday();
  const [goalSheet, setGoalSheet] = useState<Partial<Goal> | null>(null);
  const [bucketSheet, setBucketSheet] = useState<Partial<Bucket> | null>(null);
  const [money, setMoney] = useState<{ pot: PotRef; mode: 'add' | 'take' | 'move' } | null>(null);
  const [debtSheet, setDebtSheet] = useState(false);
  const [celebrate, setCelebrate] = useState<{ goal: Goal; milestone: number } | null>(null);

  const activeGoals = goals.filter((g) => !g.archived);
  const activeBuckets = buckets.filter((b) => !b.archived).sort((a, b) => a.order - b.order);
  const hasEmergency = activeGoals.some((g) => g.isEmergency);
  const pots: PotRef[] = [...activeGoals.map((g) => ({ type: 'goal' as const, id: g.id, name: g.name })), ...activeBuckets.map((b) => ({ type: 'bucket' as const, id: b.id, name: b.name }))];

  // Milestones: celebrate once per 25% step, quietly.
  useEffect(() => {
    for (const g of activeGoals) {
      const p = projectGoal(g, contributions, today);
      if (p.milestone > g.celebrated) {
        setCelebrate({ goal: g, milestone: p.milestone });
        void repo.goals.update(g.id, { celebrated: p.milestone });
        break;
      }
    }
  }, [activeGoals, contributions, today]);

  const totalSaved = useMemo(() => pots.reduce((s, p) => s + potBalance(contributions, p.type, p.id), 0), [pots, contributions]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">Goals & savings</h1>
          <p className="mt-1 text-sm text-ink-3">
            <span className="num text-ink-2">{formatMoney(totalSaved)}</span> set aside in all
          </p>
        </div>
        <Button variant="primary" onClick={() => setGoalSheet({})} icon={<Plus size={18} />}>
          New goal
        </Button>
      </header>

      {!hasEmergency && (
        <section className="grid gap-4 rounded-card bg-mist p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-sheet text-accent">
            <Shield size={20} aria-hidden />
          </span>
          <div>
            <p className="text-[15px] font-medium">Start with an emergency fund</p>
            <p className="text-sm text-ink-2">A small cushion for surprises, like a phone repair or a trip home. One month of spending is a good first target.</p>
          </div>
          <Button variant="primary" onClick={() => setGoalSheet({ name: 'Emergency fund', icon: 'shield', isEmergency: true, targetPaise: rupees(20_000) })}>
            Set it up
          </Button>
        </section>
      )}

      <section aria-labelledby="goals-title">
        <h2 id="goals-title" className="mb-4 text-[17px]">
          Goals
        </h2>
        {activeGoals.length === 0 ? (
          <EmptyState art="target" title="No goals yet." body="Name something you want, set a target, and I'll tell you how much to put aside each month." action={<Button variant="primary" onClick={() => setGoalSheet({})}>Create a goal</Button>} />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {activeGoals.map((g) => (
              <GoalCard key={g.id} goal={g} contributions={contributions} today={today} onEdit={() => setGoalSheet(g)} onMoney={(mode) => setMoney({ pot: { type: 'goal', id: g.id, name: g.name }, mode })} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="buckets-title">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 id="buckets-title" className="text-[17px]">
              Savings buckets
            </h2>
            <p className="text-sm text-ink-3">Money you keep, not spend. Filled automatically each month.</p>
          </div>
          <Button size="sm" onClick={() => setBucketSheet({ rule: 'fixed', icon: 'piggy' })} icon={<Plus size={16} />}>
            Bucket
          </Button>
        </div>
        {activeBuckets.length === 0 ? (
          <p className="text-sm text-ink-3">No buckets yet. Try "Festival gifts" with ₹500 a month, or "Rainy day" filled with whatever's left at month end.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-sheet">
            {activeBuckets.map((b) => (
              <BucketRow key={b.id} bucket={b} contributions={contributions} today={today} onEdit={() => setBucketSheet(b)} onMoney={(mode) => setMoney({ pot: { type: 'bucket', id: b.id, name: b.name }, mode })} />
            ))}
          </ul>
        )}
        <div className="mt-4 rounded-2xl border border-line p-4">
          <Toggle
            checked={settings.roundUp.enabled}
            onChange={(enabled) => repo.settings.patch({ roundUp: { enabled, bucketId: settings.roundUp.bucketId ?? activeBuckets[0]?.id } })}
            label="Round up each payment"
            description="Every payment is rounded up to the next ₹10 and the difference is counted into a bucket. No real money moves."
          />
          {settings.roundUp.enabled && (
            <div className="mt-3">
              <Field label="Into" htmlFor="ru-bucket">
                <Select id="ru-bucket" value={settings.roundUp.bucketId ?? ''} onChange={(e) => repo.settings.patch({ roundUp: { enabled: true, bucketId: e.target.value } })}>
                  {activeBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="debts-title">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="debts-title" className="text-[17px]">
            Debts and money owed
          </h2>
          <Button size="sm" onClick={() => setDebtSheet(true)} icon={<Plus size={16} />}>
            Add
          </Button>
        </div>
        {debts.length === 0 ? (
          <p className="text-sm text-ink-3">Borrowed from family, or lent someone money? Track it here. Bills split with friends live in Money with friends.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {debts.map((d) => (
              <DebtRow key={d.id} debt={d} />
            ))}
          </ul>
        )}
      </section>

      {goalSheet && <GoalSheet initial={goalSheet} onClose={() => setGoalSheet(null)} />}
      {bucketSheet && <BucketSheet initial={bucketSheet} onClose={() => setBucketSheet(null)} />}
      {money && <MoneySheet {...money} pots={pots} contributions={contributions} onClose={() => setMoney(null)} />}
      <DebtSheet open={debtSheet} onClose={() => setDebtSheet(false)} />
      <Celebration value={celebrate} onClose={() => setCelebrate(null)} />
    </div>
  );
}

function GoalCard({ goal, contributions, today, onEdit, onMoney }: { goal: Goal; contributions: Contribution[]; today: string; onEdit: () => void; onMoney: (m: 'add' | 'take' | 'move') => void }) {
  const p = projectGoal(goal, contributions, today);
  const done = p.remaining === 0;
  return (
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-4">
        <Ring value={p.progress} size={76} stroke={7} label={`${goal.name}: ${Math.round(p.progress * 100)}% saved`}>
          <span className="num text-sm font-medium">{Math.round(p.progress * 100)}%</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon name={goal.icon} size={18} className="text-accent" />
            <h3 className="truncate text-[17px]">{goal.name}</h3>
          </div>
          <p className="mt-1 text-[15px]">
            <span className="num font-medium">{formatMoney(p.saved)}</span> <span className="text-ink-3">of</span> <span className="num">{formatMoney(goal.targetPaise)}</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {done
              ? 'Done. Well saved.'
              : goal.deadline && p.monthlyNeeded != null
                ? `Need ${formatMoney(p.monthlyNeeded)} a month to reach it by ${formatLong(goal.deadline)}.`
                : `${formatMoney(p.remaining)} to go.`}
          </p>
          {!done && (
            <p className={clsx('mt-0.5 text-sm', p.onTrack === false ? 'text-warn' : 'text-ink-3')}>
              {p.estimatedFinish ? `At ${formatMoney(p.monthlyRate)} a month you'll get there around ${formatLong(p.estimatedFinish)}.` : 'Add money or set a monthly amount to see a finish date.'}
            </p>
          )}
        </div>
        <button onClick={onEdit} aria-label={`Edit ${goal.name}`} className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 hover:bg-shelf hover:text-ink">
          <Pencil size={17} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => onMoney('add')} icon={<Plus size={16} />}>
          Add money
        </Button>
        <Button size="sm" onClick={() => onMoney('take')} icon={<Minus size={16} />}>
          Take out
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onMoney('move')} icon={<ArrowLeftRight size={16} />}>
          Move
        </Button>
      </div>
    </li>
  );
}

const RULE_LABEL: Record<BucketRule, string> = { fixed: 'Fixed amount each month', percent: 'Share of income', leftover: "Whatever's left at month end" };

function BucketRow({ bucket, contributions, today, onEdit, onMoney }: { bucket: Bucket; contributions: Contribution[]; today: string; onEdit: () => void; onMoney: (m: 'add' | 'take' | 'move') => void }) {
  const balance = potBalance(contributions, 'bucket', bucket.id);
  const rate = savingRate(contributions, 'bucket', bucket.id, today);
  const monthly = bucket.rule === 'fixed' ? bucket.ruleValue : rate;
  const left = bucket.targetPaise ? Math.max(0, bucket.targetPaise - balance) : 0;
  const months = monthly > 0 && left > 0 ? Math.ceil(left / monthly) : null;
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-accent">
          <Icon name={bucket.icon} size={18} />
        </span>
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[15px] font-medium">{bucket.name}</span>
          <span className="block text-[13px] text-ink-3">
            {bucket.rule === 'fixed' ? `${formatMoney(bucket.ruleValue)} a month` : bucket.rule === 'percent' ? `${bucket.ruleValue / 100}% of income` : RULE_LABEL.leftover}
            {bucket.targetPaise ? (months ? `, about ${months} ${months === 1 ? 'month' : 'months'} to go` : left === 0 ? ', target reached' : '') : ''}
          </span>
        </button>
        <span className="num text-[15px] font-medium">{formatMoney(balance)}</span>
      </div>
      {bucket.targetPaise ? <ProgressBar value={balance / bucket.targetPaise} label={`${bucket.name} towards target`} /> : null}
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => onMoney('add')}>
          <Plus size={14} aria-hidden /> Add
        </Chip>
        <Chip onClick={() => onMoney('take')}>
          <Minus size={14} aria-hidden /> Take out
        </Chip>
        <Chip onClick={() => onMoney('move')}>
          <ArrowLeftRight size={14} aria-hidden /> Move to…
        </Chip>
      </div>
    </li>
  );
}

function DebtRow({ debt }: { debt: Debt }) {
  const paid = debt.payments.reduce((s, p) => s + p.amountPaise, 0);
  const left = Math.max(0, debt.totalPaise - paid);
  const [amount, setAmount] = useState('');
  return (
    <li className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium">{debt.name}</p>
        <p className="text-sm text-ink-3">{debt.direction === 'i-owe' ? 'I owe' : 'Owed to me'}</p>
      </div>
      <div className="mt-2">
        <ProgressBar value={debt.totalPaise ? paid / debt.totalPaise : 0} label={`${debt.name} paid off`} />
      </div>
      <p className="mt-1.5 text-sm text-ink-2">
        <span className="num">{formatMoney(paid)}</span> paid, <span className="num font-medium text-ink">{formatMoney(left)}</span> left
      </p>
      {left > 0 && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = parseMoney(amount);
            if (p && p > 0) await payDebt(debt.id, Math.min(p, left));
            setAmount('');
          }}
        >
          <Input inputMode="decimal" aria-label="Payment amount" placeholder="Amount paid" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
          <Button type="submit">Record</Button>
        </form>
      )}
    </li>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
      {ICON_NAMES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={n}
          onClick={() => onChange(n)}
          className={clsx('grid h-11 w-11 place-items-center rounded-xl', value === n ? 'bg-accent text-on-accent' : 'bg-shelf text-ink-2 hover:text-ink')}
        >
          <Icon name={n} size={18} />
        </button>
      ))}
    </div>
  );
}

function GoalSheet({ initial, onClose }: { initial: Partial<Goal>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? 'sparkles');
  const [target, setTarget] = useState(initial.targetPaise ? paiseToInput(initial.targetPaise) : '');
  const [deadline, setDeadline] = useState(initial.deadline ?? '');
  const [monthly, setMonthly] = useState(initial.monthlyAllocationPaise ? paiseToInput(initial.monthlyAllocationPaise) : '');
  const [error, setError] = useState('');
  const save = async () => {
    const t = parseMoney(target);
    if (!name.trim()) return setError('Give it a name');
    if (!t || t <= 0) return setError('Set a target amount');
    await saveGoal({ ...initial, name: name.trim(), icon, targetPaise: t, deadline: deadline || undefined, monthlyAllocationPaise: parseMoney(monthly) ?? 0 } as Goal);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial.id ? 'Edit goal' : 'New goal'}
      footer={
        <div className="flex gap-2">
          {initial.id && (
            <Button
              variant="ghost"
              onClick={async () => {
                await repo.goals.update(initial.id!, { archived: true });
                onClose();
              }}
            >
              Archive
            </Button>
          )}
          <Button variant="primary" className="flex-1" onClick={save}>
            Save goal
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Saving for" htmlFor="g-name" error={error && !name.trim() ? error : undefined}>
          <Input id="g-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New phone, trip home, fees" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target" htmlFor="g-target" error={error && name.trim() ? error : undefined}>
            <Input id="g-target" inputMode="decimal" className="num" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="25,000" />
          </Field>
          <Field label="By (optional)" htmlFor="g-deadline">
            <Input id="g-deadline" type="date" min={todayISO()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        <Field label="Put aside each month (optional)" htmlFor="g-monthly" helper="Added automatically at the start of each month.">
          <Input id="g-monthly" inputMode="decimal" className="num" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Icon</p>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </div>
    </Sheet>
  );
}

function BucketSheet({ initial, onClose }: { initial: Partial<Bucket>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? 'piggy');
  const [rule, setRule] = useState<BucketRule>(initial.rule ?? 'fixed');
  const [value, setValue] = useState(initial.ruleValue ? (initial.rule === 'percent' ? String(initial.ruleValue / 100) : paiseToInput(initial.ruleValue)) : '');
  const [target, setTarget] = useState(initial.targetPaise ? paiseToInput(initial.targetPaise) : '');
  const save = async () => {
    if (!name.trim()) return;
    const ruleValue = rule === 'percent' ? Math.round(Number(value || 0) * 100) : rule === 'fixed' ? parseMoney(value) ?? 0 : 0;
    await saveBucket({ ...initial, name: name.trim(), icon, rule, ruleValue, targetPaise: parseMoney(target) ?? undefined } as Bucket);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial.id ? 'Edit bucket' : 'New savings bucket'}
      footer={
        <div className="flex gap-2">
          {initial.id && (
            <Button
              variant="ghost"
              onClick={async () => {
                await repo.buckets.update(initial.id!, { archived: true });
                onClose();
              }}
            >
              Archive
            </Button>
          )}
          <Button variant="primary" className="flex-1" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor="b-name">
          <Input id="b-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Rainy day, festival gifts" />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">How it fills</p>
          <Segmented
            label="How it fills"
            className="w-full"
            value={rule}
            onChange={setRule}
            options={[
              { value: 'fixed', label: 'Fixed' },
              { value: 'percent', label: '% of income' },
              { value: 'leftover', label: 'Leftover' },
            ]}
          />
          <p className="mt-2 text-sm text-ink-3">{RULE_LABEL[rule]}.</p>
        </div>
        {rule !== 'leftover' && (
          <Field label={rule === 'percent' ? 'Percent of income' : 'Each month'} htmlFor="b-value">
            <Input id="b-value" inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value)} placeholder={rule === 'percent' ? '10' : '500'} />
          </Field>
        )}
        <Field label="Target (optional)" htmlFor="b-target">
          <Input id="b-target" inputMode="decimal" className="num" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Icon</p>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
      </div>
    </Sheet>
  );
}

function MoneySheet({ pot, mode, pots, contributions, onClose }: { pot: PotRef; mode: 'add' | 'take' | 'move'; pots: PotRef[]; contributions: Contribution[]; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const others = pots.filter((p) => p.id !== pot.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const balance = potBalance(contributions, pot.type, pot.id);
  const showToast = useUI((s) => s.showToast);
  const p = parseMoney(amount) ?? 0;
  const tooMuch = mode !== 'add' && p > balance;
  const monthly = useMemo(() => [50_000, 100_000, 200_000], []);
  const save = async () => {
    if (p <= 0 || tooMuch) return;
    if (mode === 'add') await contribute(pot.type, pot.id, p);
    else if (mode === 'take') await contribute(pot.type, pot.id, -p);
    else {
      const dest = others.find((o) => o.id === to);
      if (!dest) return;
      await movePot({ type: pot.type, id: pot.id }, { type: dest.type, id: dest.id }, p);
    }
    showToast({ message: mode === 'add' ? `${formatMoney(p)} added to ${pot.name}` : mode === 'take' ? `${formatMoney(p)} taken out` : `${formatMoney(p)} moved` });
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'add' ? `Add to ${pot.name}` : mode === 'take' ? `Take out of ${pot.name}` : `Move from ${pot.name}`}
      footer={
        <Button variant="primary" className="w-full" onClick={save} disabled={p <= 0 || tooMuch}>
          {mode === 'add' ? 'Add' : mode === 'take' ? 'Take out' : 'Move'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Amount" htmlFor="m-amount" helper={`In ${pot.name}: ${formatMoney(balance)}`} error={tooMuch ? `Only ${formatMoney(balance)} is in there` : undefined}>
          <Input id="m-amount" autoFocus inputMode="decimal" className="num text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {mode === 'add' && (
          <div className="flex flex-wrap gap-2">
            {monthly.map((m) => (
              <Chip key={m} onClick={() => setAmount(paiseToInput(m))}>
                {formatMoney(m)}
              </Chip>
            ))}
          </div>
        )}
        {mode === 'move' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-2">To</legend>
            <div className="flex flex-wrap gap-2">
              {others.map((o) => (
                <Chip key={o.id} selected={to === o.id} onClick={() => setTo(o.id)}>
                  {o.name}
                </Chip>
              ))}
            </div>
          </fieldset>
        )}
        {mode === 'add' && p > 0 && (
          <p className="text-sm text-ink-3">
            Saving {formatMoney(p)} every month builds to <span className="num text-ink-2">{formatMoney(buildsTo(p, 6))}</span> in 6 months and <span className="num text-ink-2">{formatMoney(buildsTo(p, 12))}</span> in a year.
          </p>
        )}
      </div>
    </Sheet>
  );
}

function DebtSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [direction, setDirection] = useState<'i-owe' | 'owed-to-me'>('i-owe');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Debt or money owed"
      footer={
        <Button
          variant="primary"
          className="w-full"
          disabled={!name.trim() || !parseMoney(total)}
          onClick={async () => {
            await addDebt(name.trim(), direction, parseMoney(total) ?? 0);
            setName('');
            setTotal('');
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Segmented
          label="Direction"
          className="w-full"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'i-owe', label: 'I owe' },
            { value: 'owed-to-me', label: 'Owed to me' },
          ]}
        />
        <Field label="What is it" htmlFor="d-name">
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop loan from Appa" />
        </Field>
        <Field label="Total" htmlFor="d-total">
          <Input id="d-total" inputMode="decimal" className="num" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** A small, tasteful moment: the ring fills, one line of copy, no confetti. */
function Celebration({ value, onClose }: { value: { goal: Goal; milestone: number } | null; onClose: () => void }) {
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(onClose, 3800);
    return () => clearTimeout(t);
  }, [value, onClose]);
  return (
    <AnimatePresence>
      {value && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={SPRING}
          className="fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-4 rounded-card border border-line bg-sheet p-4 shadow-lift lg:bottom-10"
          onClick={onClose}
        >
          <Ring value={value.milestone / 100} size={56} stroke={6} label={`${value.milestone}%`}>
            <Sparkles size={18} className="text-accent" aria-hidden />
          </Ring>
          <div>
            <p className="text-[15px] font-medium">{value.milestone === 100 ? `${value.goal.name}: done.` : value.milestone === 50 ? `Halfway to ${value.goal.name}.` : `${value.milestone}% of the way to ${value.goal.name}.`}</p>
            <p className="text-sm text-ink-2">{value.milestone === 100 ? 'You did it. Time to enjoy it, or set the next one.' : 'Steady saving adds up. Keep going.'}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
