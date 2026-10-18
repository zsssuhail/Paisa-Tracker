import { clsx } from 'clsx';
import { ArrowDownLeft, ArrowLeftRight, Check, Layers, Paperclip, Users } from 'lucide-react';
import { memo } from 'react';
import { formatMoney } from '@/data/money';
import type { Category, Transaction } from '@/data/types';
import { categoryColour, labelForTx } from '@/data/selectors';
import { Icon } from '@/design/icons';

const SUBTYPE_LABEL: Record<string, string> = {
  'pocket-money': 'Pocket money',
  family: 'From family',
  scholarship: 'Scholarship',
  interest: 'Interest',
  refund: 'Refund',
  payback: 'Friend paid back',
  salary: 'Salary',
  'cash-withdrawal': 'Cash withdrawal',
  'bank-charge': 'Bank charge',
  settlement: 'Paid a friend back',
  verification: 'Bank check (ignored)',
};

export function subtypeLabel(t: Transaction) {
  return t.subtype ? SUBTYPE_LABEL[t.subtype] : undefined;
}

export const TransactionRow = memo(function TransactionRow({
  t,
  cat,
  onOpen,
  selecting,
  selected,
  onToggle,
  catMap,
}: {
  t: Transaction;
  cat?: Category;
  onOpen: (t: Transaction) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  catMap: Map<string, Category>;
}) {
  const label = labelForTx(t, catMap);
  const meta = [t.type === 'expense' ? cat?.name ?? 'Needs a category' : subtypeLabel(t) ?? (t.type === 'income' ? 'Money in' : 'Transfer'), t.place && t.place !== label ? t.place : null, t.paymentMode]
    .filter(Boolean)
    .join(', ');
  const merged = t.sources.length > 1;
  return (
    <button
      type="button"
      onClick={() => (selecting ? onToggle?.(t.id) : onOpen(t))}
      onContextMenu={(e) => {
        if (!onToggle) return;
        e.preventDefault();
        onToggle(t.id);
      }}
      aria-pressed={selecting ? selected : undefined}
      className={clsx('flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-shelf/70', selected && 'bg-mist hover:bg-mist', t.excluded && 'opacity-60')}
    >
      {selecting ? (
        <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2', selected ? 'border-accent bg-accent text-on-accent' : 'border-line')}>
          {selected && <Check size={18} strokeWidth={2.5} aria-hidden />}
        </span>
      ) : (
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={
            t.type === 'expense' && cat
              ? { background: `color-mix(in srgb, ${categoryColour(cat)} 15%, transparent)`, color: categoryColour(cat) }
              : { background: 'rgb(var(--shelf))', color: t.type === 'income' ? 'rgb(var(--accent))' : 'rgb(var(--ink-2))' }
          }
        >
          {t.type === 'income' ? <ArrowDownLeft size={18} aria-hidden /> : t.type === 'transfer' ? <ArrowLeftRight size={18} aria-hidden /> : cat ? <Icon name={cat.icon} size={18} /> : <span className="h-2 w-2 rounded-full bg-warn" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] text-ink">{label}</span>
          {t.splitId && <Users size={13} className="shrink-0 text-ink-3" aria-label="Split with friends" />}
          {merged && <Layers size={13} className="shrink-0 text-ink-3" aria-label={`Merged from ${t.sources.length} sources`} />}
          {t.photo && <Paperclip size={13} className="shrink-0 text-ink-3" aria-label="Has a bill photo" />}
          {t.bigItem && <span className="shrink-0 rounded bg-shelf px-1.5 text-[11px] text-ink-2">Big item</span>}
          {t.isSample && <span className="shrink-0 rounded bg-shelf px-1.5 text-[11px] text-ink-3">Sample</span>}
        </span>
        <span className={clsx('block truncate text-[13px]', t.type === 'expense' && !cat ? 'text-warn' : 'text-ink-3')}>{meta}</span>
      </span>
      <span className={clsx('num shrink-0 text-[15px]', t.type === 'income' ? 'text-accent' : t.type === 'transfer' ? 'text-ink-3' : 'text-ink')}>
        {t.type === 'income' ? '+' : ''}
        {formatMoney(t.amountPaise)}
      </span>
    </button>
  );
});
