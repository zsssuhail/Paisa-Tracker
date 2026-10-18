import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useData } from '@/data/store';
import { repo } from '@/data/repo';
import { addMonths, formatDay, todayISO } from '@/data/dates';
import { formatMoney, paiseToInput, parseMoney } from '@/data/money';
import { PAYMENT_MODES, type Frequency, type Recurring } from '@/data/types';
import { useActiveCategories, useToday } from '@/data/selectors';
import { Button, Chip, EmptyState, Field, Input, Segmented, Select, Sheet, Toggle } from '@/design/ui';
import { addDueNow, createRecurring, skipDue } from './run';

const FREQ: Record<Frequency, string> = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

export default function RecurringScreen() {
  const items = useData((s) => s.recurring);
  const today = useToday();
  const [editing, setEditing] = useState<Partial<Recurring> | null>(null);
  const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active) || a.nextDue.localeCompare(b.nextDue));
  const monthly = items.filter((r) => r.active).reduce((s, r) => s + (r.frequency === 'weekly' ? Math.round((r.amountPaise * 52) / 12) : r.frequency === 'yearly' ? Math.round(r.amountPaise / 12) : r.amountPaise), 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">Recurring</h1>
          <p className="mt-1 text-sm text-ink-3">
            Subscriptions and bills. About <span className="num text-ink-2">{formatMoney(monthly)}</span> a month.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing({ frequency: 'monthly', mode: 'remind', paymentMode: 'UPI', nextDue: addMonths(todayISO(), 1) })} icon={<Plus size={18} />}>
          Add
        </Button>
      </header>

      {sorted.length === 0 ? (
        <EmptyState title="Nothing recurring yet." body="Add your mobile recharge, game pass or hostel fee. I'll add them for you, or just remind you." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-sheet">
          {sorted.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <CalendarClock size={18} className="text-ink-3" aria-hidden />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                <span className="block truncate text-[15px]">{r.name}</span>
                <span className="block text-[13px] text-ink-3">
                  {FREQ[r.frequency]}, {r.mode === 'auto' ? 'adds itself' : 'reminds me'}, next {formatDay(r.nextDue)}
                  {!r.active && ', paused'}
                </span>
              </button>
              <span className="num text-[15px]">{formatMoney(r.amountPaise)}</span>
              {r.active && r.nextDue <= today && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => skipDue(r)}>
                    Skip
                  </Button>
                  <Button size="sm" onClick={() => addDueNow(r)}>
                    Add now
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <RecurringSheet initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecurringSheet({ initial, onClose }: { initial: Partial<Recurring>; onClose: () => void }) {
  const cats = useActiveCategories();
  const [r, setR] = useState<Partial<Recurring>>(initial);
  const [amount, setAmount] = useState(initial.amountPaise ? paiseToInput(initial.amountPaise) : '');
  const set = <K extends keyof Recurring>(k: K, v: Recurring[K]) => setR((x) => ({ ...x, [k]: v }));
  const valid = r.name?.trim() && (parseMoney(amount) ?? 0) > 0 && r.nextDue;
  const save = async () => {
    if (!valid) return;
    const full = { ...r, name: r.name!.trim(), amountPaise: parseMoney(amount)!, categoryId: r.categoryId ?? null, place: r.place ?? r.name!.trim() } as Recurring;
    if (r.id) await repo.recurring.put(full);
    else await createRecurring(full);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={r.id ? 'Edit recurring' : 'New recurring item'}
      footer={
        <div className="flex gap-2">
          {r.id && (
            <Button
              variant="danger"
              aria-label="Delete"
              icon={<Trash2 size={18} />}
              onClick={async () => {
                await repo.recurring.remove(r.id!);
                onClose();
              }}
            />
          )}
          <Button variant="primary" className="flex-1" onClick={save} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="Name" htmlFor="r-name">
            <Input id="r-name" autoFocus value={r.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Airtel recharge" />
          </Field>
          <Field label="Amount" htmlFor="r-amount">
            <Input id="r-amount" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <Field label="Category" htmlFor="r-cat">
          <Select id="r-cat" value={r.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
            <option value="">Choose…</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Segmented
          label="How often"
          className="w-full"
          value={r.frequency ?? 'monthly'}
          onChange={(v) => set('frequency', v)}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
        <Field label="Next due" htmlFor="r-next">
          <Input id="r-next" type="date" value={r.nextDue ?? ''} onChange={(e) => set('nextDue', e.target.value)} />
        </Field>
        <Toggle checked={r.mode === 'auto'} onChange={(v) => set('mode', v ? 'auto' : 'remind')} label="Add it automatically" description="Off: I'll remind you on Home and you tap Add." />
        <div className="flex flex-wrap gap-2">
          {PAYMENT_MODES.map((m) => (
            <Chip key={m} selected={(r.paymentMode ?? 'UPI') === m} onClick={() => set('paymentMode', m)}>
              {m}
            </Chip>
          ))}
        </div>
        {r.id && <Toggle checked={r.active ?? true} onChange={(v) => set('active', v)} label="Active" />}
      </div>
    </Sheet>
  );
}
