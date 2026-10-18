import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Camera, Check, ChevronDown, Copy, Plus, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { haptic, useUI } from '@/app/ui';
import { useData } from '@/data/store';
import { addDays, todayISO } from '@/data/dates';
import { formatMoney, paiseToInput, parseMoney, currencySymbol } from '@/data/money';
import { PAYMENT_MODES, type Split, type Transaction, type TxSubtype, type TxType } from '@/data/types';
import { useActiveCategories, useCategoryMap, useTopCategories, categoryColour } from '@/data/selectors';
import { Button, Chip, Field, Input, Segmented, Sheet, Toggle, inputClass, SPRING } from '@/design/ui';
import { Combobox } from '@/design/Combobox';
import { Icon } from '@/design/icons';
import { findRule, normalisePlace, suggestCategory } from '@/features/rules/engine';
import { equalShares, matchPayback } from '@/features/friends/math';
import { blankDraft, deleteTransactions, duplicateTransaction, saveTransaction, type Draft } from './actions';
import { addCategory } from '@/features/categories/actions';
import { addPerson, settleShare } from '@/features/friends/actions';

const INCOME_KINDS: { value: TxSubtype; label: string }[] = [
  { value: 'pocket-money', label: 'Pocket money' },
  { value: 'family', label: 'From family' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'salary', label: 'Salary' },
  { value: 'refund', label: 'Refund' },
  { value: 'payback', label: 'Friend paid back' },
  { value: 'interest', label: 'Interest' },
];

const TRANSFER_KINDS: { value: TxSubtype; label: string }[] = [
  { value: 'cash-withdrawal', label: 'Cash withdrawal' },
  { value: 'settlement', label: 'Paid a friend back' },
];

export function QuickAddSheet() {
  const { open, editing, preset } = useUI((s) => s.quickAdd);
  const close = useUI((s) => s.closeQuickAdd);
  return (
    <Sheet open={open} onClose={close} title={editing ? 'Edit' : 'Add a payment'}>
      {open && <QuickAddForm key={editing?.id ?? 'new'} editing={editing} preset={preset} onDone={close} />}
    </Sheet>
  );
}

function QuickAddForm({ editing, preset, onDone }: { editing?: Transaction; preset?: Partial<Transaction>; onDone: () => void }) {
  const txs = useData((s) => s.transactions);
  const rules = useData((s) => s.rules);
  const people = useData((s) => s.people);
  const splits = useData((s) => s.splits);
  const showToast = useUI((s) => s.showToast);
  const bumpSaved = useUI((s) => s.bumpSaved);
  const setIncomeSplit = useUI((s) => s.setIncomeSplit);
  const goals = useData((s) => s.goals);
  const buckets = useData((s) => s.buckets);
  const top = useTopCategories(6);
  const all = useActiveCategories();
  const catMap = useCategoryMap();

  const [draft, setDraft] = useState<Draft>(() => ({ ...blankDraft(), ...preset, ...editing }));
  const existingSplit = editing?.splitId ? splits.find((s) => s.id === editing.splitId) : undefined;
  const [amountText, setAmountText] = useState(() => {
    const p = existingSplit ? existingSplit.totalPaise : (editing ?? preset)?.amountPaise;
    return p ? paiseToInput(p) : '';
  });
  const [categoryTouched, setCategoryTouched] = useState(Boolean(editing?.categoryId || preset?.categoryId));
  const [suggestReason, setSuggestReason] = useState<string | null>(null);
  const [always, setAlways] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showMore, setShowMore] = useState(Boolean(editing?.note || editing?.photo));
  const [error, setError] = useState<string | null>(null);
  const [splitOn, setSplitOn] = useState(Boolean(existingSplit));
  const [splitPeople, setSplitPeople] = useState<string[]>(() => existingSplit?.shares.map((s) => s.personId).filter((id) => id !== existingSplit.paidBy) ?? []);
  const [paidBy, setPaidBy] = useState<string>(existingSplit?.paidBy ?? 'me');
  const [customShares, setCustomShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(existingSplit?.shares.map((s) => [s.personId, paiseToInput(s.sharePaise)]) ?? []),
  );
  const [settleIds, setSettleIds] = useState<string[]>([]);
  const amountRef = useRef<HTMLInputElement>(null);

  const amountPaise = parseMoney(amountText) ?? 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const places = useMemo(() => {
    const m = new Map<string, { count: number; categoryId: string | null }>();
    for (const t of txs) {
      if (!t.place) continue;
      const e = m.get(t.place) ?? { count: 0, categoryId: t.categoryId };
      e.count++;
      m.set(t.place, e);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 60)
      .map(([value, e]) => ({ value, hint: e.categoryId ? catMap.get(e.categoryId)?.name : undefined }));
  }, [txs, catMap]);

  const items = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) if (t.item) m.set(t.item, (m.get(t.item) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([value]) => ({ value }));
  }, [txs]);

  const recent = useMemo(() => {
    if (editing) return [];
    const seen = new Set<string>();
    const out: Transaction[] = [];
    for (const t of [...txs].sort((a, b) => b.createdAt - a.createdAt)) {
      if (t.type !== 'expense' || !t.item) continue;
      const k = `${t.item}|${t.place}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length === 4) break;
    }
    return out;
  }, [txs, editing]);

  /** Learn from me: a known place fills category and item. */
  const applySuggestion = (place: string, force = false) => {
    if (draft.type !== 'expense' || (!force && categoryTouched)) return;
    if (!place.trim()) return;
    const s = suggestCategory({ place, item: draft.item, amountPaise }, rules, txs);
    if (s.categoryId && s.confidence !== 'low') {
      setDraft((d) => ({ ...d, categoryId: s.categoryId, item: d.item || s.item || '' }));
      setSuggestReason(s.reason);
    }
  };

  const rule = findRule(draft.place, rules);
  const canOfferAlways =
    draft.type === 'expense' && Boolean(draft.place.trim()) && Boolean(draft.categoryId) && !(rule && rule.categoryId === draft.categoryId);

  // Split maths
  const others = splitPeople;
  const equal = equalShares(amountPaise, others.length + 1);
  const shareFor = (pid: string, i: number) =>
    customShares[pid] !== undefined && customShares[pid] !== '' ? parseMoney(customShares[pid]) ?? 0 : equal[i + 1] ?? 0;
  const othersTotal = others.reduce((s, pid, i) => s + shareFor(pid, i), 0);
  const myShare = splitOn ? amountPaise - othersTotal : amountPaise;

  const paybackMatches = useMemo(
    () => (draft.type === 'income' && draft.subtype === 'payback' ? matchPayback({ place: draft.place, amountPaise, type: 'income' }, splits, people) : []),
    [draft.type, draft.subtype, draft.place, amountPaise, splits, people],
  );

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (amountPaise <= 0) {
      setError('Enter an amount');
      amountRef.current?.focus();
      return;
    }
    if (splitOn && others.length === 0) {
      setError('Pick who you split with');
      return;
    }
    if (splitOn && myShare < 0) {
      setError("Friends' shares add up to more than the total");
      return;
    }
    let split: Omit<Split, 'id' | 'transactionId'> | undefined;
    if (splitOn && draft.type === 'expense') {
      const shares = others.map((pid, i) => {
        const prev = existingSplit?.shares.find((s) => s.personId === pid);
        return { ...prev, personId: pid, sharePaise: shareFor(pid, i) };
      });
      split = { totalPaise: amountPaise, myShareP: myShare, paidBy, shares };
    }
    const saved = await saveTransaction(
      {
        ...draft,
        amountPaise,
        note: split ? draft.note || `My share of ${formatMoney(amountPaise)}` : draft.note,
        subtype: draft.type === 'expense' ? undefined : draft.subtype,
        categoryId: draft.type === 'expense' ? draft.categoryId : null,
      },
      { always: always && canOfferAlways, split },
    );
    for (const sid of settleIds) {
      const m = paybackMatches.find((p) => p.splitId === sid);
      if (m) await settleShare(m.splitId, m.personId, saved.id, saved.date);
    }
    haptic();
    bumpSaved();
    onDone();
    const realIncome = saved.type === 'income' && !['payback', 'refund', 'interest'].includes(saved.subtype ?? '');
    if (!editing && realIncome && [...goals, ...buckets].some((p) => !p.archived)) {
      setIncomeSplit(saved);
      return;
    }
    showToast({
      message: editing ? 'Saved' : `${formatMoney(saved.amountPaise)} added${saved.categoryId ? ` to ${catMap.get(saved.categoryId)?.name}` : ''}`,
      actionLabel: editing ? undefined : 'Undo',
      onAction: editing ? undefined : async () => void (await deleteTransactions([saved.id])),
    });
  };

  const remove = async () => {
    if (!editing) return;
    const undo = await deleteTransactions([editing.id]);
    onDone();
    showToast({ message: 'Deleted', actionLabel: 'Undo', onAction: () => void undo() });
  };

  const duplicate = async () => {
    if (!editing) return;
    await duplicateTransaction(editing);
    bumpSaved();
    onDone();
    showToast({ message: 'Copied to today' });
  };

  const typeOptions: { value: TxType; label: string }[] = [
    { value: 'expense', label: 'Spent' },
    { value: 'income', label: 'Money in' },
    { value: 'transfer', label: 'Transfer' },
  ];

  const dateChips = [
    { label: 'Today', value: todayISO() },
    { label: 'Yesterday', value: addDays(todayISO(), -1) },
  ];
  const customDate = !dateChips.some((d) => d.value === draft.date);

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <Segmented
        label="Type"
        value={draft.type}
        options={typeOptions}
        onChange={(v) => {
          setDraft((d) => ({ ...d, type: v, subtype: defaultSubtype(v, d.subtype) }));
          if (v !== 'expense') setSplitOn(false);
        }}
        className="w-full"
      />

      {/* Amount */}
      <div>
        <label htmlFor="qa-amount" className="sr-only">
          Amount
        </label>
        <div className={clsx('flex items-baseline gap-2 border-b-2 pb-2 transition-colors', error && !amountPaise ? 'border-over' : 'border-line focus-within:border-accent')}>
          <span className="num text-3xl text-ink-3" aria-hidden>
            {currencySymbol()}
          </span>
          <input
            id="qa-amount"
            ref={amountRef}
            autoFocus
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            value={amountText}
            onChange={(e) => {
              setError(null);
              setAmountText(e.target.value.replace(/[^\d.,]/g, ''));
            }}
            className="num w-full bg-transparent text-[40px] font-medium leading-tight text-ink placeholder:text-line focus:outline-none"
            aria-invalid={Boolean(error && !amountPaise)}
            aria-describedby="qa-error"
          />
        </div>
        <p id="qa-error" className="mt-1.5 min-h-[20px] text-sm text-over" role="alert">
          {error}
        </p>
      </div>

      {recent.length > 0 && !amountText && (
        <div>
          <p className="label-quiet mb-2">Same as before</p>
          <div className="scroll-x -mx-5 px-5">
            {recent.map((r) => (
              <Chip
                key={r.id}
                onClick={() => {
                  setDraft((d) => ({ ...d, item: r.item, place: r.place, categoryId: r.categoryId, paymentMode: r.paymentMode }));
                  setAmountText(paiseToInput(r.amountPaise));
                  setCategoryTouched(true);
                }}
              >
                <Copy size={14} aria-hidden />
                {r.item}, <span className="num">{formatMoney(r.amountPaise)}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}

      {draft.type === 'expense' && (
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium text-ink-2">
            Category
            {suggestReason && draft.categoryId && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-accent">
                <Sparkles size={13} aria-hidden /> {suggestReason}
              </span>
            )}
          </legend>
          <CategoryChips
            selected={draft.categoryId}
            categories={showAll ? all : mergeSelected(top, draft.categoryId, catMap)}
            onSelect={(id) => {
              set('categoryId', id);
              setCategoryTouched(true);
              setSuggestReason(null);
            }}
            grouped={showAll}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="press inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-accent" onClick={() => setShowAll((v) => !v)}>
              <ChevronDown size={16} className={clsx('transition-transform', showAll && 'rotate-180')} aria-hidden />
              {showAll ? 'Fewer' : 'More categories'}
            </button>
            {showAll && <NewCategoryInline onCreated={(id) => { set('categoryId', id); setCategoryTouched(true); }} />}
          </div>
        </fieldset>
      )}

      {draft.type === 'income' && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">What is it?</legend>
          <div className="flex flex-wrap gap-2">
            {INCOME_KINDS.map((k) => (
              <Chip key={k.value} selected={draft.subtype === k.value} onClick={() => set('subtype', k.value)}>
                {k.label}
              </Chip>
            ))}
          </div>
          {(draft.subtype === 'payback' || draft.subtype === 'refund') && (
            <p className="mt-2 text-sm text-ink-3">Paybacks and refunds don't count as income, so your savings rate stays honest.</p>
          )}
        </fieldset>
      )}

      {draft.type === 'transfer' && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">What kind of transfer?</legend>
          <div className="flex flex-wrap gap-2">
            {TRANSFER_KINDS.map((k) => (
              <Chip key={k.value} selected={draft.subtype === k.value} onClick={() => set('subtype', k.value)}>
                {k.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-3">Transfers move your own money around. They are never counted as spending.</p>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={draft.type === 'income' ? 'From' : 'Where'} htmlFor="qa-place">
          <Combobox
            id="qa-place"
            label={draft.type === 'income' ? 'From' : 'Where'}
            value={draft.place}
            onChange={(v) => set('place', v)}
            onPick={(v) => applySuggestion(v, !categoryTouched)}
            options={places}
            placeholder={draft.type === 'income' ? 'Family, scholarship…' : 'Shop or app'}
          />
        </Field>
        <Field label="What" htmlFor="qa-item">
          <Combobox id="qa-item" label="What" value={draft.item} onChange={(v) => set('item', v)} options={items} placeholder="Tea, petrol, notebook…" />
        </Field>
      </div>

      {/* Blur on place also suggests (typed, not picked). */}
      <PlaceWatcher place={draft.place} onSettle={(p) => applySuggestion(p)} />

      <AnimatePresence initial={false}>
        {canOfferAlways && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING}>
            <Toggle
              checked={always}
              onChange={setAlways}
              label={`Always put “${draft.place.trim()}” in ${catMap.get(draft.categoryId!)?.name}`}
              description="I'll fill this in for you next time, including imports."
            />
          </motion.div>
        )}
      </AnimatePresence>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">When</legend>
        <div className="flex flex-wrap items-center gap-2">
          {dateChips.map((d) => (
            <Chip key={d.label} selected={draft.date === d.value} onClick={() => set('date', d.value)}>
              {d.label}
            </Chip>
          ))}
          <label className={clsx('relative inline-flex h-11 items-center rounded-full border px-3.5 text-sm', customDate ? 'border-accent bg-mist text-accent' : 'border-transparent bg-shelf text-ink-2')}>
            <span className="sr-only">Pick a date</span>
            <input
              type="date"
              value={draft.date}
              max={todayISO()}
              onChange={(e) => e.target.value && set('date', e.target.value)}
              className="bg-transparent text-sm focus:outline-none"
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-2">Paid by</legend>
        <div className="scroll-x -mx-5 px-5">
          {PAYMENT_MODES.map((m) => (
            <Chip key={m} selected={draft.paymentMode === m} onClick={() => set('paymentMode', m)}>
              {m}
            </Chip>
          ))}
        </div>
      </fieldset>

      {draft.type === 'expense' && (
        <SplitSection
          on={splitOn}
          setOn={setSplitOn}
          people={people}
          selected={splitPeople}
          setSelected={setSplitPeople}
          paidBy={paidBy}
          setPaidBy={setPaidBy}
          customShares={customShares}
          setCustomShares={setCustomShares}
          shareFor={shareFor}
          myShare={myShare}
          total={amountPaise}
        />
      )}

      {paybackMatches.length > 0 && (
        <fieldset className="rounded-2xl bg-mist p-4">
          <legend className="sr-only">Settle a shared bill</legend>
          <p className="text-sm font-medium text-ink">Does this settle a shared bill?</p>
          <div className="mt-2 flex flex-col gap-1">
            {paybackMatches.map((m) => {
              const s = splits.find((x) => x.id === m.splitId);
              const t = txs.find((x) => x.id === s?.transactionId);
              const on = settleIds.includes(m.splitId);
              return (
                <label key={m.splitId} className="flex min-h-[44px] cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setSettleIds((ids) => (on ? ids.filter((i) => i !== m.splitId) : [...ids, m.splitId]))}
                    className="h-5 w-5 accent-[rgb(var(--accent))]"
                  />
                  <span className="text-sm">
                    {t?.item ?? 'Shared bill'}, {people.find((p) => p.id === m.personId)?.name} owes <span className="num">{formatMoney(m.sharePaise)}</span>
                    {m.exact && <span className="ml-1 text-accent">(exact match)</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {!showMore ? (
        <button type="button" onClick={() => setShowMore(true)} className="press inline-flex h-11 items-center gap-1.5 self-start rounded-xl text-sm font-medium text-ink-2 hover:text-ink">
          <Plus size={16} aria-hidden /> Note or bill photo
        </button>
      ) : (
        <div className="grid gap-4">
          <Field label="Note" htmlFor="qa-note">
            <textarea id="qa-note" rows={2} value={draft.note} onChange={(e) => set('note', e.target.value)} className={clsx(inputClass, 'h-auto py-2.5')} />
          </Field>
          <PhotoField photo={draft.photo} onChange={(p) => set('photo', p)} />
        </div>
      )}

      <div className="safe-bottom sticky -bottom-5 -mx-5 -mb-5 flex gap-2 border-t border-line bg-sheet px-5 pb-5 pt-3">
        {editing && (
          <>
            <Button type="button" variant="danger" onClick={remove} aria-label="Delete" icon={<Trash2 size={18} />} />
            <Button type="button" onClick={duplicate} aria-label="Duplicate to today" icon={<Copy size={18} />} />
          </>
        )}
        <Button type="submit" variant="primary" size="lg" className="flex-1" icon={<Check size={20} aria-hidden />}>
          {splitOn ? `Save my share of ${formatMoney(Math.max(0, myShare))}` : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function defaultSubtype(type: TxType, current?: TxSubtype): TxSubtype | undefined {
  const kinds = type === 'income' ? INCOME_KINDS : type === 'transfer' ? TRANSFER_KINDS : [];
  if (!kinds.length) return undefined;
  return kinds.some((k) => k.value === current) ? current : kinds[0].value;
}

function mergeSelected(top: ReturnType<typeof useTopCategories>, selected: string | null, map: ReturnType<typeof useCategoryMap>) {
  if (!selected || top.some((c) => c.id === selected)) return top;
  const c = map.get(selected);
  return c ? [c, ...top.slice(0, 5)] : top;
}

function CategoryChips({
  categories,
  selected,
  onSelect,
  grouped,
}: {
  categories: ReturnType<typeof useActiveCategories>;
  selected: string | null;
  onSelect: (id: string) => void;
  grouped: boolean;
}) {
  const groups = useData((s) => s.groups);
  if (!grouped) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => (
          <CategoryChip key={c.id} c={c} selected={selected === c.id} onSelect={onSelect} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {[...groups].sort((a, b) => a.order - b.order).map((g) => {
        const list = categories.filter((c) => c.groupId === g.id);
        if (!list.length) return null;
        return (
          <div key={g.id}>
            <p className="label-quiet mb-1.5">{g.name}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((c) => (
                <CategoryChip key={c.id} c={c} selected={selected === c.id} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryChip({ c, selected, onSelect }: { c: ReturnType<typeof useActiveCategories>[number]; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(c.id)}
      className={clsx(
        'press flex h-12 min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-sm',
        selected ? 'border-accent bg-mist font-medium text-accent' : 'border-transparent bg-shelf text-ink-2 hover:text-ink',
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${categoryColour(c)} 16%, transparent)`, color: categoryColour(c) }}>
        <Icon name={c.icon} size={16} />
      </span>
      <span className="truncate">{c.name}</span>
    </button>
  );
}

function NewCategoryInline({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open)
    return (
      <button type="button" className="press inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-accent" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> New category
      </button>
    );
  return (
    <div className="flex w-full gap-2">
      <Input
        autoFocus
        aria-label="New category name"
        placeholder="Name, e.g. Gym"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!name.trim()) return;
            onCreated(await addCategory(name.trim()));
            setOpen(false);
            setName('');
          }
        }}
      />
      <Button
        type="button"
        variant="primary"
        onClick={async () => {
          if (!name.trim()) return;
          onCreated(await addCategory(name.trim()));
          setOpen(false);
          setName('');
        }}
      >
        Add
      </Button>
    </div>
  );
}

function PlaceWatcher({ place, onSettle }: { place: string; onSettle: (p: string) => void }) {
  const last = useRef(place);
  useEffect(() => {
    if (place === last.current) return;
    const t = setTimeout(() => {
      last.current = place;
      if (normalisePlace(place).length >= 3) onSettle(place);
    }, 350);
    return () => clearTimeout(t);
  }, [place, onSettle]);
  return null;
}

function PhotoField({ photo, onChange }: { photo?: Blob; onChange: (p: Blob | undefined) => void }) {
  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-2">Bill photo</p>
      {url ? (
        <div className="flex items-center gap-3">
          <img src={url} alt="Bill" className="h-20 w-20 rounded-xl object-cover" />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)} icon={<X size={16} />}>
            Remove
          </Button>
        </div>
      ) : (
        <label className="press inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-shelf px-3.5 text-sm text-ink-2">
          <Camera size={16} aria-hidden /> Add a photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onChange(e.target.files?.[0])} />
        </label>
      )}
      <p className="mt-1 text-xs text-ink-3">Stays on this device only.</p>
    </div>
  );
}

function SplitSection(props: {
  on: boolean;
  setOn: (v: boolean) => void;
  people: ReturnType<typeof useData.getState>['people'];
  selected: string[];
  setSelected: (fn: (s: string[]) => string[]) => void;
  paidBy: string;
  setPaidBy: (v: string) => void;
  customShares: Record<string, string>;
  setCustomShares: (fn: (s: Record<string, string>) => Record<string, string>) => void;
  shareFor: (pid: string, i: number) => number;
  myShare: number;
  total: number;
}) {
  const { on, setOn, people, selected, setSelected, paidBy, setPaidBy, customShares, setCustomShares, shareFor, myShare, total } = props;
  const [newName, setNewName] = useState('');
  return (
    <div className="rounded-2xl border border-line p-4">
      <Toggle checked={on} onChange={setOn} label="Split with friends" description="Only your share counts as spending." />
      {on && (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-ink-2">With</p>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Chip key={p.id} selected={selected.includes(p.id)} onClick={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}>
                  <Users size={14} aria-hidden /> {p.name}
                </Chip>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                aria-label="Add a friend"
                placeholder="Add a friend's name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    e.preventDefault();
                    const id = await addPerson(newName.trim());
                    setSelected((s) => [...s, id]);
                    setNewName('');
                  }
                }}
              />
              <Button
                type="button"
                onClick={async () => {
                  if (!newName.trim()) return;
                  const id = await addPerson(newName.trim());
                  setSelected((s) => [...s, id]);
                  setNewName('');
                }}
              >
                Add
              </Button>
            </div>
          </div>

          {selected.length > 0 && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-ink-2">Who paid the bill?</p>
                <div className="flex flex-wrap gap-2">
                  <Chip selected={paidBy === 'me'} onClick={() => setPaidBy('me')}>
                    I did
                  </Chip>
                  {selected.map((pid) => (
                    <Chip key={pid} selected={paidBy === pid} onClick={() => setPaidBy(pid)}>
                      {people.find((p) => p.id === pid)?.name}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-line rounded-xl bg-shelf/60">
                <div className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <span className="font-medium">You</span>
                  <span className={clsx('num', myShare < 0 && 'text-over')}>{formatMoney(myShare)}</span>
                </div>
                {selected.map((pid, i) => (
                  <div key={pid} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <span>{people.find((p) => p.id === pid)?.name}</span>
                    <input
                      inputMode="decimal"
                      aria-label={`${people.find((p) => p.id === pid)?.name}'s share`}
                      value={customShares[pid] ?? paiseToInput(shareFor(pid, i))}
                      onChange={(e) => setCustomShares((s) => ({ ...s, [pid]: e.target.value.replace(/[^\d.]/g, '') }))}
                      className="num h-10 w-28 rounded-lg border border-line bg-sheet px-2 text-right focus:border-accent focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <p className="text-sm text-ink-3">
                Total <span className="num">{formatMoney(total)}</span>, split evenly unless you change a share.{' '}
                {paidBy === 'me' ? 'Friends will show up in "Money with friends" until they pay you back.' : 'You will owe your share to the friend who paid.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
