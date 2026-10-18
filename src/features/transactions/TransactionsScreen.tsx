import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeftRight, CheckSquare, Download, Inbox, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { addDays, formatDay, todayISO } from '@/data/dates';
import { formatMoney } from '@/data/money';
import type { Transaction } from '@/data/types';
import { useActiveCategories, useCategoryMap, categoryColour } from '@/data/selectors';
import { Button, EmptyState, Segmented, Sheet } from '@/design/ui';
import { Icon } from '@/design/icons';
import { applyFilter, rangeFor, sortTx } from './filter';
import { FilterBar, type FilterState } from './FilterBar';
import { TransactionRow } from './TransactionRow';
import { bulkUpdate, deleteTransactions, learnRule } from './actions';
import { downloadCSV } from '@/features/settings/exporters';
import { isSpending } from '@/features/budget/math';

type Row = { kind: 'day'; date: string; total: number } | { kind: 'tx'; t: Transaction };

export function TransactionsScreen() {
  const txs = useData((s) => s.transactions);
  const startDay = useData((s) => s.settings.monthStartDay);
  const catMap = useCategoryMap();
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const showToast = useUI((s) => s.showToast);
  const pendingFilter = useUI((s) => s.pendingFilter);
  const setPendingFilter = useUI((s) => s.setPendingFilter);
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') === 'inbox' ? 'inbox' : 'all';

  const [state, setState] = useState<FilterState>(() => ({
    preset: 'this-month',
    custom: { from: addDays(todayISO(), -30), to: todayISO() },
    filter: {},
  }));
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickCategory, setPickCategory] = useState(false);

  // Chart taps elsewhere hand over a filter.
  useEffect(() => {
    if (!pendingFilter) return;
    const { range, ...rest } = pendingFilter;
    setState((s) => ({ ...s, preset: range ? 'custom' : 'all', custom: range ?? s.custom, filter: rest }));
    setPendingFilter(null);
  }, [pendingFilter, setPendingFilter]);

  const inboxCount = useMemo(() => txs.filter((t) => t.type === 'expense' && !t.excluded && !t.categoryId).length, [txs]);

  const list = useMemo(() => {
    if (tab === 'inbox') return txs.filter((t) => t.type === 'expense' && !t.excluded && !t.categoryId).sort(sortTx);
    const range = rangeFor(state.preset, startDay, state.custom);
    return applyFilter(txs, { ...state.filter, range }, catMap).sort(sortTx);
  }, [txs, state, startDay, catMap, tab]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let current = '';
    let header: Extract<Row, { kind: 'day' }> | null = null;
    for (const t of list) {
      if (t.date !== current) {
        current = t.date;
        header = { kind: 'day', date: t.date, total: 0 };
        out.push(header);
      }
      if (header && isSpending(t)) header.total += t.amountPaise;
      out.push({ kind: 'tx', t });
    }
    return out;
  }, [list]);

  const totals = useMemo(() => {
    let spent = 0;
    let income = 0;
    for (const t of list) {
      if (isSpending(t)) spent += t.amountPaise;
      else if (t.type === 'income' && !t.excluded) income += t.amountPaise;
    }
    return { spent, income };
  }, [list]);

  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    setOffset(listRef.current?.offsetTop ?? 0);
  }, [tab, state.preset]);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i].kind === 'day' ? 44 : 68),
    overscan: 12,
    scrollMargin: offset,
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const ids = [...selected];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Transactions</h1>
          <p className="mt-1 text-sm text-ink-3">
            {list.length} {list.length === 1 ? 'entry' : 'entries'}, <span className="num">{formatMoney(totals.spent)}</span> spent
            {totals.income > 0 && (
              <>
                ,{' '}
               <span className="num">{formatMoney(totals.income)}</span> in
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => (selecting ? exitSelect() : setSelecting(true))} icon={selecting ? <X size={16} /> : <CheckSquare size={16} />}>
            {selecting ? 'Cancel' : 'Select'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => downloadCSV(list, catMap)} icon={<Download size={16} />} disabled={!list.length}>
            CSV
          </Button>
        </div>
      </header>

      <Segmented
        label="View"
        value={tab}
        onChange={(v) => setParams(v === 'inbox' ? { view: 'inbox' } : {})}
        options={[
          { value: 'all', label: 'All' },
          { value: 'inbox', label: `Needs a category${inboxCount ? ` (${inboxCount})` : ''}` },
        ]}
        className="w-full sm:w-auto"
      />

      {tab === 'all' && <FilterBar state={state} setState={setState} />}

      {tab === 'inbox' && inboxCount > 0 && (
        <p className="text-sm text-ink-2">These payments need a category before they count in your budget lines. Tap one, or select several and set them together.</p>
      )}

      {list.length === 0 ? (
        tab === 'inbox' ? (
          <EmptyState art="inbox" title="All sorted." body="Every payment has a category. New imports that I can't guess will wait here." />
        ) : txs.length === 0 ? (
          <EmptyState title="No payments yet." body="Tap + to add your first one, it takes 5 seconds. Or import a bank statement to bring in months at once." action={<Button variant="primary" onClick={() => openQuickAdd()}>Add a payment</Button>} />
        ) : (
          <EmptyState title="Nothing matches these filters." body="Try a wider date range or clear a filter." />
        )
      ) : (
        <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="absolute inset-x-0"
                style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
              >
                {row.kind === 'day' ? (
                  <div className="flex h-11 items-end justify-between px-2 pb-1.5">
                    <h2 className="text-[13px] font-medium text-ink-2">{formatDay(row.date)}</h2>
                    {row.total > 0 && <span className="num text-[13px] text-ink-3">{formatMoney(row.total)}</span>}
                  </div>
                ) : (
                  <TransactionRow
                    t={row.t}
                    cat={row.t.categoryId ? catMap.get(row.t.categoryId) : undefined}
                    catMap={catMap}
                    onOpen={(t) => openQuickAdd({ editing: t })}
                    selecting={selecting}
                    selected={selected.has(row.t.id)}
                    onToggle={(id) => {
                      if (!selecting) setSelecting(true);
                      toggle(id);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {selecting && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-sheet px-4 py-3 shadow-lift lg:left-[248px]">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2">
            <span className="mr-auto text-sm text-ink-2">
              <span className="num font-medium text-ink">{selected.size}</span> selected
              <button className="ml-3 h-11 font-medium text-accent" onClick={() => setSelected(new Set(list.map((t) => t.id)))}>
                Select all {list.length}
              </button>
            </span>
            <Button size="sm" disabled={!selected.size} onClick={() => setPickCategory(true)} icon={<Tag size={16} />}>
              Category
            </Button>
            <Button
              size="sm"
              disabled={!selected.size}
              icon={<ArrowLeftRight size={16} />}
              onClick={async () => {
                const undo = await bulkUpdate(ids, { type: 'transfer', categoryId: null });
                exitSelect();
                showToast({ message: `${ids.length} marked as not spending`, actionLabel: 'Undo', onAction: () => void undo() });
              }}
            >
              Not spending
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!selected.size}
              icon={<Trash2 size={16} />}
              onClick={async () => {
                const undo = await deleteTransactions(ids);
                exitSelect();
                showToast({ message: `${ids.length} deleted`, actionLabel: 'Undo', onAction: () => void undo() });
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}

      <BulkCategorySheet
        open={pickCategory}
        onClose={() => setPickCategory(false)}
        onPick={async (categoryId, remember) => {
          const rowsSel = list.filter((t) => selected.has(t.id));
          const undo = await bulkUpdate(ids, { categoryId, type: 'expense' });
          if (remember) {
            const places = new Set(rowsSel.map((t) => t.place).filter(Boolean));
            for (const p of places) await learnRule(p, categoryId, undefined, 'manual');
          }
          setPickCategory(false);
          exitSelect();
          showToast({ message: `${ids.length} moved to ${catMap.get(categoryId)?.name}`, actionLabel: 'Undo', onAction: () => void undo() });
        }}
      />
    </div>
  );
}

export function BulkCategorySheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string, remember: boolean) => void }) {
  const cats = useActiveCategories();
  const [remember, setRemember] = useState(true);
  return (
    <Sheet open={open} onClose={onClose} title="Move to category">
      <label className="mb-4 flex min-h-[44px] items-center gap-3 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
        Remember these places for next time
      </label>
      <div className="grid grid-cols-2 gap-2">
        {cats.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id, remember)} className="press flex h-12 items-center gap-2 rounded-xl bg-shelf px-3 text-left text-sm text-ink hover:bg-mist">
            <span style={{ color: categoryColour(c) }}>
              <Icon name={c.icon} size={16} />
            </span>
            <span className="truncate">{c.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-ink-3">
        <Inbox size={14} aria-hidden /> Rows with a category leave the "Needs a category" inbox.
      </p>
    </Sheet>
  );
}
