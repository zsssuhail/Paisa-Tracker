import { motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Columns3, Layers, MoreHorizontal, Undo2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { formatDay, formatLong } from '@/data/dates';
import { formatMoney } from '@/data/money';
import type { Category, ImportBatch, TxSubtype, TxType } from '@/data/types';
import { useActiveCategories, useCategoryMap, categoryColour } from '@/data/selectors';
import { Button, Chip, EmptyState, Segmented, Sheet, Toggle } from '@/design/ui';
import { Icon } from '@/design/icons';
import { normalisePlace } from '@/features/rules/engine';
import { commitImport, undoImport } from '../pipeline/commit';
import { summarise, type Candidate } from '../pipeline/build';
import type { Prepared } from './ImportScreen';

type View = 'all' | 'look' | 'dupes';

const CONF_LABEL = { high: 'Confident', medium: 'Fairly sure', low: 'Guess' } as const;

export function ReviewScreen({ prepared, onBack, onRemap }: { prepared: Prepared; onBack: () => void; onRemap: () => void }) {
  const [cands, setCands] = useState<Candidate[]>(prepared.candidates);
  const [view, setView] = useState<View>(() => (prepared.candidates.some(needsLook) ? 'look' : 'all'));
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [learn, setLearn] = useState<{ payee: string; categoryId: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<ImportBatch | null>(null);
  const catMap = useCategoryMap();
  const showToast = useUI((s) => s.showToast);

  const summary = summarise(cands, prepared.result.unreadable.length, prepared.result.skipped);
  const toSave = cands.filter((c) => c.approved && c.status !== 'duplicate');
  const lookCount = cands.filter(needsLook).length;

  const visible = useMemo(() => {
    const list = view === 'look' ? cands.filter(needsLook) : view === 'dupes' ? cands.filter((c) => c.status !== 'new') : cands;
    return [...list].sort((a, b) => b.raw.date.localeCompare(a.raw.date) || a.raw.rowIndex - b.raw.rowIndex);
  }, [cands, view]);

  const groups = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const c of visible) m.set(c.raw.date, [...(m.get(c.raw.date) ?? []), c]);
    return [...m.entries()];
  }, [visible]);

  const update = (key: string, patch: Partial<Candidate>) => setCands((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const applyToPayee = (payee: string, categoryId: string) => {
    const n = normalisePlace(payee);
    setCands((list) =>
      list.map((c) =>
        normalisePlace(c.cls.payee) === n && c.cls.type === 'expense' && c.status === 'new'
          ? { ...c, categoryId, confidence: 'high', reason: 'You chose this', approved: true, needsReview: false }
          : c,
      ),
    );
  };

  const setType = (c: Candidate, type: TxType, subtype?: TxSubtype) =>
    update(c.key, { cls: { ...c.cls, type, subtype, excluded: false }, categoryId: type === 'expense' ? c.categoryId : null, approved: true, needsReview: false, reason: type === 'expense' ? c.reason : 'You changed this' });

  if (done) {
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mist text-accent">
          <CheckCheck size={24} aria-hidden />
        </span>
        <div>
          <h1 className="text-[28px] leading-tight">Imported.</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            {done.counts.added} new, {done.counts.merged} merged with payments you already had, {done.counts.duplicates} duplicates skipped
            {done.counts.needCategory ? `, ${done.counts.needCategory} need a category` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {done.counts.needCategory > 0 ? (
            <Link to="/transactions?view=inbox" className="press inline-flex h-12 items-center rounded-[14px] bg-accent px-5 font-medium text-on-accent">
              Sort {done.counts.needCategory} now
            </Link>
          ) : (
            <Link to="/" className="press inline-flex h-12 items-center rounded-[14px] bg-accent px-5 font-medium text-on-accent">
              See my month
            </Link>
          )}
          <Button
            icon={<Undo2 size={16} />}
            onClick={async () => {
              await undoImport(done.id);
              showToast({ message: 'Import undone' });
              onBack();
            }}
          >
            Undo this import
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-24">
      <header className="flex items-start gap-2">
        <button onClick={onBack} aria-label="Back" className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-shelf">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] leading-tight">Review {prepared.result.bankName ?? prepared.parser.label}</h1>
          <p className="mt-1 text-[15px] text-ink-2">
            <span className="num text-ink">{summary.found}</span> found, <span className="num text-ink">{summary.added}</span> new
            {summary.merged > 0 && (
              <>
                ,{' '}
               <span className="num text-ink">{summary.merged}</span> already in your notebook, will be joined
              </>
            )}
            {summary.duplicates > 0 && (
              <>
                ,{' '}
               <span className="num text-ink">{summary.duplicates}</span> duplicates skipped
              </>
            )}
            {summary.needCategory > 0 && (
              <>
                ,{' '}
               <span className="num text-warn">{summary.needCategory}</span> need a category
              </>
            )}
            {summary.skipped > 0 && <>, {summary.skipped} cancelled or pending left out</>}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRemap} icon={<Columns3 size={16} />} className="hidden sm:inline-flex">
          Fix columns
        </Button>
      </header>

      <FileSummary prepared={prepared} />

      {prepared.reconciliation && (
        <div className={clsx('flex items-start gap-3 rounded-2xl border p-4 text-sm', prepared.reconciliation.balanced ? 'border-line bg-sheet' : 'border-warn/30 bg-warn/5')}>
          {prepared.reconciliation.balanced ? <Check size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
          <div>
            {prepared.reconciliation.balanced ? (
              <p>
                Balances check out: <span className="num">{formatMoney(prepared.reconciliation.opening)}</span> opening + <span className="num">{formatMoney(prepared.reconciliation.credits)}</span> in − <span className="num">{formatMoney(prepared.reconciliation.debits)}</span> out ={' '}
                <span className="num">{formatMoney(prepared.reconciliation.closing)}</span> closing.
              </p>
            ) : (
              <>
                <p className="font-medium">The running balance doesn't add up in {prepared.reconciliation.gaps.length || 1} place{prepared.reconciliation.gaps.length === 1 ? '' : 's'}. A row may be missing.</p>
                <ul className="mt-1 text-ink-2">
                  {prepared.reconciliation.gaps.slice(0, 3).map((g, i) => (
                    <li key={i}>
                      Between {formatDay(g.after.date)} and {formatDay(g.before.date)}: <span className="num">{formatMoney(Math.abs(g.differencePaise))}</span> {g.differencePaise > 0 ? 'more came in' : 'more went out'} than the rows show.
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'look', label: `Needs a look (${lookCount})` },
            { value: 'all', label: `All (${cands.length})` },
            { value: 'dupes', label: `Merged or repeated (${summary.merged + summary.duplicates})` },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<CheckCheck size={16} />}
          onClick={() => setCands((l) => l.map((c) => (needsLook(c) && c.categoryId ? { ...c, confidence: 'high', needsReview: false, reason: 'You accepted this' } : c)))}
        >
          Accept all guesses
        </Button>
      </div>
      <p className="text-sm text-ink-3">Everything is saved unless you untick it. Rows without a category go to your Needs-a-category inbox. Tap a row to change it; swipe left for not spending.</p>

      {visible.length === 0 ? (
        <EmptyState art="inbox" title={view === 'look' ? 'Nothing needs a look.' : 'Nothing here.'} body={view === 'look' ? 'Every row has a confident guess. Save when ready.' : undefined} />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([date, list]) => (
            <section key={date} aria-label={formatDay(date)}>
              <h2 className="mb-1 px-2 text-[13px] font-medium text-ink-2">{formatDay(date)}</h2>
              <ul className="flex flex-col">
                {list.map((c) => (
                  <ReviewRow key={c.key} c={c} cat={c.categoryId ? catMap.get(c.categoryId) : undefined} onOpen={() => setEditing(c)} onToggle={() => update(c.key, { approved: !c.approved })} onNotSpending={() => setType(c, 'transfer')} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {prepared.result.unreadable.length > 0 && (
        <section aria-labelledby="unreadable" className="rounded-2xl border border-line p-4">
          <h2 id="unreadable" className="text-[15px] font-medium">
            Couldn't read these ({prepared.result.unreadable.length})
          </h2>
          <p className="text-sm text-ink-3">They're not lost: add any that matter by hand, or fix the columns.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {prepared.result.unreadable.slice(0, 20).map((u, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-mono text-[12px] text-ink-2" title={u.text}>
                  {u.text}
                </span>
                <span className="shrink-0 text-xs text-ink-3">{u.reason}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={onRemap} icon={<Columns3 size={16} />}>
            Fix columns
          </Button>
        </section>
      )}

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-sheet/95 px-4 py-3 backdrop-blur lg:left-[248px]">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3">
          <p className="hidden flex-1 text-sm text-ink-2 sm:block">
            {toSave.length} to save{cands.filter((c) => !c.approved && c.status !== 'duplicate').length ? `, ${cands.filter((c) => !c.approved && c.status !== 'duplicate').length} left out` : ''}
          </p>
          <Button
            variant="primary"
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={!toSave.length || saving}
            onClick={async () => {
              setSaving(true);
              const batch = await commitImport({
                candidates: cands,
                sourceKind: prepared.parser.source,
                parserId: prepared.parser.id,
                fileName: prepared.file.name,
                unreadable: prepared.result.unreadable.length,
                skipped: prepared.result.skipped,
                learn,
              });
              setSaving(false);
              setDone(batch);
            }}
          >
            {saving ? 'Saving…' : `Save ${toSave.length}`}
          </Button>
        </div>
      </div>

      {editing && (
        <RowSheet
          c={cands.find((x) => x.key === editing.key)!}
          sameCount={cands.filter((x) => normalisePlace(x.cls.payee) === normalisePlace(editing.cls.payee) && x.cls.type === 'expense' && x.status === 'new').length}
          onClose={() => setEditing(null)}
          onCategory={(categoryId, all, always) => {
            if (all) applyToPayee(editing.cls.payee, categoryId);
            else update(editing.key, { categoryId, confidence: 'high', reason: 'You chose this', approved: true, needsReview: false });
            if (always) setLearn((l) => [...l.filter((x) => normalisePlace(x.payee) !== normalisePlace(editing.cls.payee)), { payee: editing.cls.payee, categoryId }]);
            setEditing(null);
          }}
          onType={(type, subtype) => {
            setType(cands.find((x) => x.key === editing.key)!, type, subtype);
            setEditing(null);
          }}
          onSplit={(ids) => update(editing.key, { splitWith: ids.length ? ids : undefined })}
          onSkip={() => {
            update(editing.key, { approved: false });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** What was read from the file, in plain words: the facts it used and the parts it set aside. */
function FileSummary({ prepared }: { prepared: Prepared }) {
  const r = prepared.result;
  const facts = [
    r.bankName && r.account ? `${r.bankName}, account ending ${r.account.replace(/\D/g, '')}` : r.bankName,
    r.period ? `${formatLong(r.period.from)} to ${formatLong(r.period.to)}` : undefined,
    r.holderName ? `Payments to ${titleCaseName(r.holderName)} count as moving your own money` : undefined,
  ].filter(Boolean) as string[];
  const kept = ['date', 'who was paid', 'amount', 'money in or out'];
  if (r.rows.some((x) => x.upiRef)) kept.push('UPI reference');
  if (r.rows.some((x) => x.balancePaise != null)) kept.push('running balance');
  if (r.rows.some((x) => x.note)) kept.push('your own notes like “dinner”');
  if (r.rows.some((x) => x.categoryName)) kept.push('your categories');
  const noise = [...(r.ignored ?? [])];
  if (r.rows.some((x) => /UPI\//i.test(x.description))) noise.push('Bank codes and app tags in each line (YES, CNR, UPIIntent, collect-pay)');
  if (r.skipped) noise.push(`${r.skipped} cancelled, failed or pending ${r.skipped === 1 ? 'payment' : 'payments'}`);
  return (
    <details className="group rounded-2xl border border-line bg-sheet px-4 py-3 text-sm">
      <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-ink-2">
          <span className="font-medium text-ink">Read from {prepared.file.name}</span>
          {facts[0] ? `: ${facts[0]}` : ''}
        </span>
        <span className="shrink-0 text-accent group-open:hidden">What I kept</span>
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-medium text-ink">Kept from every line</p>
          <p className="mt-1 text-ink-2">{kept.join(', ')}.</p>
          {facts.slice(1).map((f) => (
            <p key={f} className="mt-1 text-ink-2">
              {f}.
            </p>
          ))}
        </div>
        {noise.length > 0 && (
          <div>
            <p className="font-medium text-ink">Set aside</p>
            <ul className="mt-1 list-disc pl-4 text-ink-2">
              {noise.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

const titleCaseName = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function needsLook(c: Candidate) {
  return c.status === 'new' && c.cls.type === 'expense' && !c.cls.excluded && (c.confidence === 'low' || !c.categoryId || c.needsReview);
}

function ReviewRow({ c, cat, onOpen, onToggle, onNotSpending }: { c: Candidate; cat?: Category; onOpen: () => void; onToggle: () => void; onNotSpending: () => void }) {
  const reduce = useReducedMotion();
  const look = needsLook(c);
  const dup = c.status === 'duplicate';
  const label = c.cls.type === 'expense' ? (c.cls.excluded ? 'Ignored' : cat?.name ?? 'Needs a category') : c.cls.type === 'income' ? subtypeName(c.cls.subtype) : 'Not spending';
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -90 && c.cls.type === 'expense') onNotSpending();
  };
  return (
    <li className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-0 flex items-center justify-end rounded-2xl bg-shelf pr-5 text-sm font-medium text-ink-2" aria-hidden>
        Not spending
      </div>
      <motion.div
        drag={reduce || dup ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragEnd={onDragEnd}
        className={clsx('relative flex min-h-[64px] items-center gap-3 rounded-2xl bg-canvas px-2 py-2', look && 'shadow-[inset_0_0_0_999px_rgb(var(--warn)/0.07)]', dup && 'opacity-55')}
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={dup}
          aria-pressed={c.approved}
          aria-label={c.approved ? 'Included, tap to leave out' : 'Left out, tap to include'}
          className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2', c.approved && !dup ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent')}
        >
          <Check size={18} strokeWidth={2.5} aria-hidden />
        </button>
        <button type="button" onClick={onOpen} disabled={dup} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15px]">{c.cls.payee || c.raw.description}</span>
              {c.status === 'merge' && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-shelf px-1.5 text-[11px] text-ink-2">
                  <Layers size={11} aria-hidden /> Already logged
                </span>
              )}
              {dup && <span className="shrink-0 rounded bg-shelf px-1.5 text-[11px] text-ink-3">Duplicate</span>}
              {c.splitWith?.length ? <Users size={13} className="shrink-0 text-ink-3" aria-label="Split" /> : null}
            </span>
            <span className="flex items-center gap-1.5 text-[13px]">
              {c.cls.type === 'expense' && !c.cls.excluded && <ConfidenceDot level={c.confidence} />}
              {cat && <span style={{ color: categoryColour(cat) }}><Icon name={cat.icon} size={13} /></span>}
              <span className={clsx('truncate', look ? 'text-warn' : 'text-ink-3')}>
                {label}
                {c.reason && c.reason !== label && `, ${c.reason}`}
              </span>
            </span>
          </span>
          <span className={clsx('num shrink-0 text-[15px]', c.raw.direction === 'credit' ? 'text-accent' : 'text-ink')}>
            {c.raw.direction === 'credit' ? '+' : ''}
            {formatMoney(c.raw.amountPaise)}
          </span>
          <MoreHorizontal size={18} className="shrink-0 text-ink-3" aria-hidden />
        </button>
      </motion.div>
    </li>
  );
}

function ConfidenceDot({ level }: { level: Candidate['confidence'] }) {
  return (
    <span
      className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', level === 'high' ? 'bg-accent' : level === 'medium' ? 'bg-warn' : 'border border-ink-3')}
      title={CONF_LABEL[level]}
      aria-label={CONF_LABEL[level]}
      role="img"
    />
  );
}

function subtypeName(s?: TxSubtype) {
  return (
    {
      family: 'From family',
      scholarship: 'Scholarship',
      interest: 'Interest',
      refund: 'Refund',
      payback: 'Friend paid back',
      salary: 'Salary',
      'pocket-money': 'Money in',
      verification: 'Ignored',
    } as Record<string, string>
  )[s ?? ''] ?? 'Money in';
}

function RowSheet({
  c,
  sameCount,
  onClose,
  onCategory,
  onType,
  onSplit,
  onSkip,
}: {
  c: Candidate;
  sameCount: number;
  onClose: () => void;
  onCategory: (id: string, all: boolean, always: boolean) => void;
  onType: (t: TxType, s?: TxSubtype) => void;
  onSplit: (ids: string[]) => void;
  onSkip: () => void;
}) {
  const cats = useActiveCategories();
  const people = useData((s) => s.people);
  const [all, setAll] = useState(sameCount > 1);
  const [always, setAlways] = useState(true);
  const [splitOpen, setSplitOpen] = useState(Boolean(c.splitWith?.length));
  return (
    <Sheet open onClose={onClose} title={c.cls.payee || 'Payment'} footer={<Button variant="ghost" className="w-full" onClick={onSkip}>Leave this one out</Button>}>
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-shelf/70 p-3 text-sm">
          <p className="num text-lg font-medium">
            {c.raw.direction === 'credit' ? '+' : ''}
            {formatMoney(c.raw.amountPaise)} <span className="font-sans text-sm font-normal text-ink-3">· {formatDay(c.raw.date)}</span>
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-ink-3">{c.raw.description}</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">What is it?</legend>
          <div className="flex flex-wrap gap-2">
            {c.raw.direction === 'debit' ? (
              <>
                <Chip selected={c.cls.type === 'expense' && !c.cls.excluded} onClick={() => onType('expense')}>Spending</Chip>
                <Chip selected={c.cls.type === 'transfer' && c.cls.subtype !== 'settlement'} onClick={() => onType('transfer')}>My own money (transfer)</Chip>
                <Chip selected={c.cls.subtype === 'settlement'} onClick={() => onType('transfer', 'settlement')}>Paid a friend back</Chip>
              </>
            ) : (
              <>
                <Chip selected={c.cls.subtype === 'payback'} onClick={() => onType('income', 'payback')}>Friend paid back</Chip>
                <Chip selected={c.cls.subtype === 'refund'} onClick={() => onType('income', 'refund')}>Refund</Chip>
                <Chip selected={c.cls.subtype === 'family'} onClick={() => onType('income', 'family')}>From family</Chip>
                <Chip selected={c.cls.subtype === 'scholarship'} onClick={() => onType('income', 'scholarship')}>Scholarship</Chip>
                <Chip selected={c.cls.type === 'income' && c.cls.subtype === 'pocket-money'} onClick={() => onType('income', 'pocket-money')}>Other income</Chip>
                <Chip selected={c.cls.type === 'transfer'} onClick={() => onType('transfer')}>My own money</Chip>
              </>
            )}
          </div>
        </fieldset>

        {c.cls.type === 'expense' && (
          <>
            <div className="flex flex-col gap-1 rounded-2xl border border-line p-3">
              {sameCount > 1 && <Toggle checked={all} onChange={setAll} label={`Apply to all ${sameCount} payments to ${c.cls.payee}`} />}
              <Toggle checked={always} onChange={setAlways} label="Always do this" description="Future payments here get this category automatically." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cats.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => onCategory(cat.id, all, always)}
                  className={clsx('press flex h-12 items-center gap-2 rounded-xl border px-3 text-left text-sm', c.categoryId === cat.id ? 'border-accent bg-mist text-accent' : 'border-transparent bg-shelf text-ink')}
                >
                  <span style={{ color: categoryColour(cat) }}>
                    <Icon name={cat.icon} size={16} />
                  </span>
                  <span className="truncate">{cat.name}</span>
                </button>
              ))}
            </div>
            <div>
              <button className="inline-flex h-11 items-center gap-2 text-sm font-medium text-accent" onClick={() => setSplitOpen((v) => !v)}>
                <Users size={16} aria-hidden /> Split with friends
              </button>
              {splitOpen && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {people.length === 0 && <p className="text-sm text-ink-3">Add friends in Money with friends first.</p>}
                  {people.map((p) => {
                    const on = c.splitWith?.includes(p.id) ?? false;
                    return (
                      <Chip key={p.id} selected={on} onClick={() => onSplit(on ? (c.splitWith ?? []).filter((x) => x !== p.id) : [...(c.splitWith ?? []), p.id])}>
                        {p.name}
                      </Chip>
                    );
                  })}
                  {c.splitWith?.length ? (
                    <p className="w-full text-sm text-ink-3">
                      Your share: <span className="num text-ink">{formatMoney(Math.ceil(c.raw.amountPaise / (c.splitWith.length + 1)))}</span>. Only that counts as spending.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
