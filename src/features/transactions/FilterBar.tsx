import { clsx } from 'clsx';
import { Bookmark, Search, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { useData } from '@/data/store';
import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import { parseMoney, paiseToInput } from '@/data/money';
import { PAYMENT_MODES, type ISODate, type TxFilter } from '@/data/types';
import { useActiveCategories, categoryColour } from '@/data/selectors';
import { Button, Chip, Dot, Field, Input, Sheet, inputClass } from '@/design/ui';
import { isFilterEmpty, type RangePreset } from './filter';

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3', label: '3 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

export interface FilterState {
  preset: RangePreset;
  custom: { from: ISODate; to: ISODate };
  filter: TxFilter;
}

export function RangeChips({
  value,
  onChange,
  custom,
  onCustom,
  options = RANGE_OPTIONS,
}: {
  value: RangePreset;
  onChange: (v: RangePreset) => void;
  custom: { from: ISODate; to: ISODate };
  onCustom: (c: { from: ISODate; to: ISODate }) => void;
  options?: { value: RangePreset; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="scroll-x" role="group" aria-label="Date range">
        {options.map((o) => (
          <Chip key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
      {value === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            From
            <input type="date" className={clsx(inputClass, 'h-11 w-auto')} value={custom.from} onChange={(e) => e.target.value && onCustom({ ...custom, from: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            to
            <input type="date" className={clsx(inputClass, 'h-11 w-auto')} value={custom.to} onChange={(e) => e.target.value && onCustom({ ...custom, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

export function FilterBar({ state, setState }: { state: FilterState; setState: (s: FilterState) => void }) {
  const [open, setOpen] = useState(false);
  const saved = useData((s) => s.savedFilters);
  const f = state.filter;
  const activeCount =
    (f.categoryIds?.length ? 1 : 0) + (f.paymentModes?.length ? 1 : 0) + (f.place ? 1 : 0) + (f.minPaise != null || f.maxPaise != null ? 1 : 0) + (f.types?.length ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            aria-label="Search payments"
            placeholder="Search item, place, note"
            className="pl-10"
            value={f.text ?? ''}
            onChange={(e) => setState({ ...state, filter: { ...f, text: e.target.value } })}
          />
        </div>
        <Button onClick={() => setOpen(true)} icon={<SlidersHorizontal size={18} aria-hidden />} aria-label="More filters">
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && <span className="num rounded-full bg-accent px-1.5 text-xs text-on-accent">{activeCount}</span>}
        </Button>
      </div>
      <RangeChips
        value={state.preset}
        onChange={(preset) => setState({ ...state, preset })}
        custom={state.custom}
        onCustom={(custom) => setState({ ...state, custom })}
      />
      {saved.length > 0 && (
        <div className="scroll-x" role="group" aria-label="Saved filters">
          {saved.map((s) => (
            <Chip key={s.id} onClick={() => setState({ ...state, filter: s.filter })}>
              <Bookmark size={14} aria-hidden /> {s.name}
            </Chip>
          ))}
        </div>
      )}
      <FilterSheet open={open} onClose={() => setOpen(false)} filter={f} onChange={(filter) => setState({ ...state, filter })} />
    </div>
  );
}

function FilterSheet({ open, onClose, filter, onChange }: { open: boolean; onClose: () => void; filter: TxFilter; onChange: (f: TxFilter) => void }) {
  const cats = useActiveCategories();
  const [saveName, setSaveName] = useState('');
  const toggle = <T,>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onChange({ text: filter.text })} icon={<X size={16} />}>
            Clear
          </Button>
          <Button variant="primary" className="flex-1" onClick={onClose}>
            Show results
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">Type</legend>
          <div className="flex flex-wrap gap-2">
            {(['expense', 'income', 'transfer'] as const).map((t) => (
              <Chip key={t} selected={filter.types?.includes(t)} onClick={() => onChange({ ...filter, types: toggle(filter.types, t) })}>
                {t === 'expense' ? 'Spent' : t === 'income' ? 'Money in' : 'Transfers'}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">Category</legend>
          <div className="flex flex-wrap gap-2">
            <Chip selected={filter.categoryIds?.includes('uncategorised')} onClick={() => onChange({ ...filter, categoryIds: toggle(filter.categoryIds, 'uncategorised') })}>
              Needs a category
            </Chip>
            {cats.map((c) => (
              <Chip key={c.id} selected={filter.categoryIds?.includes(c.id)} onClick={() => onChange({ ...filter, categoryIds: toggle(filter.categoryIds, c.id) })}>
                <Dot colour={categoryColour(c)} /> {c.name}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-2">Paid by</legend>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((m) => (
              <Chip key={m} selected={filter.paymentModes?.includes(m)} onClick={() => onChange({ ...filter, paymentModes: toggle(filter.paymentModes, m) })}>
                {m}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="At least (₹)" htmlFor="f-min">
            <Input id="f-min" inputMode="decimal" value={filter.minPaise != null ? paiseToInput(filter.minPaise) : ''} onChange={(e) => onChange({ ...filter, minPaise: parseMoney(e.target.value) ?? undefined })} />
          </Field>
          <Field label="At most (₹)" htmlFor="f-max">
            <Input id="f-max" inputMode="decimal" value={filter.maxPaise != null ? paiseToInput(filter.maxPaise) : ''} onChange={(e) => onChange({ ...filter, maxPaise: parseMoney(e.target.value) ?? undefined })} />
          </Field>
        </div>
        <Field label="Place" htmlFor="f-place" helper="Exact place name, e.g. Ramana canteen">
          <Input id="f-place" value={filter.place ?? ''} onChange={(e) => onChange({ ...filter, place: e.target.value || undefined })} />
        </Field>
        {!isFilterEmpty(filter) && (
          <div className="flex gap-2">
            <Input aria-label="Name this filter" placeholder="Save as… e.g. Food this term" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <Button
              disabled={!saveName.trim()}
              onClick={async () => {
                await repo.savedFilters.put({ id: uid(), name: saveName.trim(), filter: { ...filter, range: undefined } });
                setSaveName('');
              }}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
