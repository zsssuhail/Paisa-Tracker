import { clsx } from 'clsx';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { inputClass } from './ui';

export interface Option {
  value: string;
  hint?: ReactNode;
}

/** Text input with an accessible suggestion list (ARIA 1.2 combobox pattern). */
export function Combobox({
  id,
  value,
  onChange,
  onPick,
  options,
  placeholder,
  label,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  options: Option[];
  placeholder?: string;
  label: string;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((o) => o.value.toLowerCase().includes(q) && o.value.toLowerCase() !== q) : options;
    return list.slice(0, 6);
  }, [value, options]);

  const pick = (v: string) => {
    onChange(v);
    onPick?.(v);
    setOpen(false);
    setActive(-1);
  };

  const show = open && matches.length > 0;

  return (
    <div className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-label={label}
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(matches[active].value);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-[calc(100%+4px)] z-10 overflow-hidden rounded-xl border border-line bg-sheet py-1 shadow-lift">
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              className={clsx('flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3.5 text-[15px]', i === active ? 'bg-mist' : 'hover:bg-shelf')}
            >
              <span className="truncate">{o.value}</span>
              {o.hint && <span className="shrink-0 text-xs text-ink-3">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
