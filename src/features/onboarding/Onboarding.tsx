import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { ArrowLeft, BarChart3, Plus, FileUp, PiggyBank, Sparkles, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { periodFor, todayISO } from '@/data/dates';
import { parseMoney, rupees } from '@/data/money';
import type { BudgetMode, Focus } from '@/data/types';
import { Button, Field, Input, Select, SPRING } from '@/design/ui';
import { Icon } from '@/design/icons';
import { ensureDefaultCategories } from '@/features/categories/actions';
import { templateAllocations, type TemplateId } from '@/features/budget/math';
import { loadSample } from './sample';

const CURRENCIES = [
  { code: 'INR', locale: 'en-IN', label: '₹ Indian rupee' },
  { code: 'USD', locale: 'en-US', label: '$ US dollar' },
  { code: 'EUR', locale: 'de-DE', label: '€ Euro' },
  { code: 'GBP', locale: 'en-GB', label: '£ British pound' },
  { code: 'AED', locale: 'en-AE', label: 'AED UAE dirham' },
  { code: 'SGD', locale: 'en-SG', label: 'S$ Singapore dollar' },
];

const GOAL_PRESETS = [
  { name: 'Emergency fund', icon: 'shield', target: 30_000, emergency: true },
  { name: 'New phone', icon: 'phone', target: 25_000 },
  { name: 'Trip', icon: 'plane', target: 15_000 },
  { name: 'Fees', icon: 'grad', target: 40_000 },
];

type Start = 'sample' | 'fresh' | 'import';

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [focus, setFocus] = useState<Focus>('track');
  const [mode, setMode] = useState<BudgetMode>('simple');
  const [template, setTemplate] = useState<TemplateId>('student');
  const [income, setIncome] = useState('');
  const [startDay, setStartDay] = useState(1);
  const [goal, setGoal] = useState<number | null>(0);
  const [goalTarget, setGoalTarget] = useState('30000');
  const [busy, setBusy] = useState(false);

  const finish = async (start: Start) => {
    setBusy(true);
    const cur = CURRENCIES.find((c) => c.code === currency)!;
    await ensureDefaultCategories();
    await repo.settings.patch({ name: name.trim(), currency: cur.code, locale: cur.locale, focus, budgetMode: mode, monthStartDay: startDay });

    const goalId = uid();
    // Sample data brings its own Emergency fund; don't create a twin.
    const skipGoal = start === 'sample' && goal !== null && GOAL_PRESETS[goal].emergency;
    if (goal !== null && !skipGoal) {
      const g = GOAL_PRESETS[goal];
      await repo.goals.put({
        id: goalId,
        name: g.name,
        icon: g.icon,
        targetPaise: parseMoney(goalTarget) ?? rupees(g.target),
        monthlyAllocationPaise: 0,
        isEmergency: g.emergency,
        archived: false,
        celebrated: 0,
        createdAt: Date.now(),
      });
    }

    if (start === 'sample') {
      await loadSample();
    } else {
      const incomePaise = parseMoney(income) ?? 0;
      const today = todayISO();
      const period = periodFor(today, startDay);
      const [categories, txs] = await Promise.all([repo.categories.all(), repo.transactions.all()]);
      const allocations = templateAllocations({
        template,
        incomePaise: incomePaise || rupees(10_000),
        categories,
        txs,
        today,
        startDay,
        savingsTargets: goal !== null ? [{ targetType: 'goal', targetId: goalId }] : [],
        rollover: false,
      });
      const total = allocations.filter((a) => a.targetType === 'category').reduce((s, a) => s + a.amountPaise, 0);
      await repo.budgets.put({ id: period.start, mode, incomePaise, totalLimitPaise: mode === 'simple' ? total : 0, allocations });
    }
    await repo.settings.patch({ onboarded: true });
    if (start === 'import') navigate('/import');
    else navigate('/');
  };

  const steps: { title: string; body: ReactNode; canNext?: boolean }[] = [
    {
      title: 'Hi. What should I call you?',
      canNext: true,
      body: (
        <div className="grid gap-4">
          <Field label="Your name" htmlFor="ob-name" helper="Only used to greet you. Stays on this phone.">
            <Input id="ob-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" autoComplete="given-name" />
          </Field>
          <Field label="Currency" htmlFor="ob-cur">
            <Select id="ob-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ),
    },
    {
      title: 'What would you like help with?',
      canNext: true,
      body: (
        <div className="grid gap-2">
          <Choice selected={focus === 'track'} onClick={() => setFocus('track')} icon={<BarChart3 size={20} />} title="Know where my money goes" body="Fast logging and clear charts." />
          <Choice selected={focus === 'budget'} onClick={() => setFocus('budget')} icon={<Wallet size={20} />} title="Stick to a budget" body="A daily safe-to-spend number and gentle nudges." />
          <Choice selected={focus === 'save'} onClick={() => setFocus('save')} icon={<PiggyBank size={20} />} title="Save for something" body="Goals with a clear monthly amount." />
        </div>
      ),
    },
    {
      title: 'How do you want to budget?',
      canNext: true,
      body: (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Choice selected={mode === 'simple'} onClick={() => setMode('simple')} title="Simple" body="One total for the month, plus a limit for the categories you care about." />
            <Choice selected={mode === 'zero'} onClick={() => setMode('zero')} title="Every rupee a job" body="Give all of this month's money a place, spending or saving, until nothing is left to assign." />
          </div>
          <Field label="Money you get each month" htmlFor="ob-income" helper="Pocket money, scholarship, stipend. A rough number is fine.">
            <Input id="ob-income" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="10,000" className="num" />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">Start from</p>
            <div className="grid gap-2">
              <Choice compact selected={template === 'student'} onClick={() => setTemplate('student')} title="Student essentials" body="Sensible limits for food, travel and study." />
              <Choice compact selected={template === '503020'} onClick={() => setTemplate('503020')} title="50 / 30 / 20" body="Half on needs, 30% on wants, 20% saved." />
              <Choice compact selected={template === 'history'} onClick={() => setTemplate('history')} title="My last 3 months" body="Uses your averages once you've imported history." />
            </div>
          </div>
          <Field label="My month starts on" htmlFor="ob-start" helper="Pick the day your pocket money or salary arrives.">
            <Select id="ob-start" value={startDay} onChange={(e) => setStartDay(Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1st (calendar month)' : `Day ${d}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ),
    },
    {
      title: 'Saving for something?',
      canNext: true,
      body: (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            {GOAL_PRESETS.map((g, i) => (
              <button
                key={g.name}
                type="button"
                aria-pressed={goal === i}
                onClick={() => {
                  setGoal(i);
                  setGoalTarget(String(g.target));
                }}
                className={clsx('press flex min-h-[72px] flex-col items-start gap-1.5 rounded-2xl border p-3 text-left', goal === i ? 'border-accent bg-mist' : 'border-line bg-sheet')}
              >
                <Icon name={g.icon} size={20} className={goal === i ? 'text-accent' : 'text-ink-2'} />
                <span className="text-sm font-medium">{g.name}</span>
                {g.emergency && <span className="text-xs text-ink-3">Recommended first</span>}
              </button>
            ))}
          </div>
          {goal !== null && (
            <Field label="Target" htmlFor="ob-target">
              <Input id="ob-target" inputMode="decimal" className="num" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} />
            </Field>
          )}
          <button type="button" className="h-11 self-start text-sm font-medium text-ink-2 hover:text-ink" onClick={() => setGoal(null)}>
            Skip for now
          </button>
        </div>
      ),
    },
    {
      title: 'Last step. How do you want to start?',
      body: (
        <div className="grid gap-2">
          <Choice disabled={busy} onClick={() => finish('sample')} icon={<Sparkles size={20} />} title="Look around with sample data" body="A realistic student month. Clearly labelled, cleared in one tap." />
          <Choice disabled={busy} onClick={() => finish('import')} icon={<FileUp size={20} />} title="Import my old data" body="Bank statement, Google Pay history or your old spreadsheet. Nothing leaves this device." />
          <Choice disabled={busy} onClick={() => finish('fresh')} icon={<Plus size={20} />} title="Start fresh" body="Add your first payment. It takes 5 seconds." />
        </div>
      ),
    },
  ];

  const s = steps[step];
  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[5fr_7fr]">
      <aside className="hidden flex-col justify-between bg-accent p-12 text-on-accent lg:flex">
        <span className="text-lg font-semibold">Paisa</span>
        <div>
          <p className="max-w-[18ch] text-[44px] font-semibold leading-[1.05] tracking-tight">Know what you can spend today.</p>
          <p className="mt-4 max-w-[40ch] text-on-accent/80">A money notebook that learns your places, reads your statements and keeps everything on your device.</p>
        </div>
        <p className="text-sm text-on-accent/70">No account. No ads. Export anytime.</p>
      </aside>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-8 pt-6 lg:justify-center">
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-shelf" onClick={() => setStep(step - 1)} aria-label="Back">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <span className="text-lg font-semibold lg:hidden">Paisa</span>
          )}
          <div className="ml-auto flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={clsx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-accent' : i < step ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-line')} />
            ))}
          </div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={SPRING} className="mt-10 flex-1">
            <h1 className="mb-6 text-[28px] leading-tight">{s.title}</h1>
            {s.body}
          </motion.div>
        </AnimatePresence>
        {s.canNext && (
          <Button variant="primary" size="lg" className="mt-8 w-full" onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        )}
      </main>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  icon,
  title,
  body,
  compact,
  disabled,
}: {
  selected?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  title: string;
  body: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={clsx(
        'press flex w-full items-start gap-3 rounded-2xl border text-left disabled:opacity-50',
        compact ? 'p-3' : 'p-4',
        selected ? 'border-accent bg-mist' : 'border-line bg-sheet hover:border-ink-3/40',
      )}
    >
      {icon && <span className={clsx('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-ink-2')}>{icon}</span>}
      <span>
        <span className="block text-[15px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{body}</span>
      </span>
    </button>
  );
}
