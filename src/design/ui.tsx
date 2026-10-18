import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowUpRight, Check, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { currencySymbol, formatMoney } from '@/data/money';
import type { LimitState } from '@/features/budget/math';

export const SPRING = { type: 'spring', stiffness: 100, damping: 20 } as const;
export const SNAP = { type: 'spring', stiffness: 400, damping: 30 } as const;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' | 'lg'; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        'press inline-flex select-none items-center justify-center gap-2 font-medium disabled:pointer-events-none disabled:opacity-40',
        size === 'lg' && 'h-14 rounded-2xl px-6 text-base',
        size === 'md' && 'h-12 rounded-[14px] px-5 text-[15px]',
        size === 'sm' && 'h-11 rounded-xl px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent/90',
        variant === 'secondary' && 'bg-shelf text-ink hover:bg-line/70',
        variant === 'ghost' && 'text-ink-2 hover:bg-shelf hover:text-ink',
        variant === 'danger' && 'bg-over/10 text-over hover:bg-over/15',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx('press grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-shelf hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  selected,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(
        'press inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm',
        selected ? 'border-accent bg-mist font-medium text-accent' : 'border-transparent bg-shelf text-ink-2 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={clsx('card p-5', className)}>{children}</As>;
}

/** Animated money figure: counts up on change, static under reduced motion. */
export function Amount({
  paise,
  className,
  sign,
  animate = true,
  hero,
  bare,
}: {
  paise: number;
  className?: string;
  sign?: boolean;
  animate?: boolean;
  /** Display-size figure: sans with proportional digits (tabular only in columns). */
  hero?: boolean;
  /** Without the currency symbol, when the layout sets it separately. */
  bare?: boolean;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(paise);
  const from = useRef(paise);
  useEffect(() => {
    if (reduce || !animate) {
      setShown(paise);
      from.current = paise;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 600);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (paise - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = paise;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paise, reduce, animate]);
  return (
    <span className={clsx(hero ? 'font-sans' : 'num', className)} aria-label={formatMoney(paise, { sign })}>
      <span aria-hidden>{bare ? formatMoney(shown, { sign }).replace(currencySymbol(), '').trim() : formatMoney(shown, { sign })}</span>
    </span>
  );
}

const STATE_META: Record<Exclude<LimitState, 'none'>, { label: string; text: string; bar: string; Icon: typeof Check }> = {
  ok: { label: 'On track', text: 'text-accent', bar: 'bg-accent', Icon: Check },
  close: { label: 'Close', text: 'text-warn', bar: 'bg-warn', Icon: AlertTriangle },
  over: { label: 'Over', text: 'text-over', bar: 'bg-over', Icon: ArrowUpRight },
};

export function StateTag({ state, className }: { state: LimitState; className?: string }) {
  if (state === 'none') return null;
  const m = STATE_META[state];
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', m.text, className)}>
      <m.Icon size={13} strokeWidth={2} aria-hidden />
      {m.label}
    </span>
  );
}

export function ProgressBar({ value, state = 'ok', label }: { value: number; state?: LimitState; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const bar = state === 'none' ? 'bg-ink-3' : STATE_META[state].bar;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-mist"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <motion.div
        className={clsx('h-full origin-left rounded-full', bar)}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct }}
        transition={SPRING}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 6, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--mist))" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgb(var(--accent))"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={SPRING}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Field({
  label,
  helper,
  error,
  children,
  htmlFor,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-over">{error}</p> : helper ? <p className="text-xs text-ink-3">{helper}</p> : null}
    </div>
  );
}

export const inputClass =
  'h-12 w-full rounded-xl border border-line bg-sheet px-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputClass, className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputClass, 'appearance-none pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex rounded-[14px] bg-shelf p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'relative h-10 flex-1 whitespace-nowrap rounded-[10px] px-3 text-sm',
            value === o.value ? 'font-medium text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[10px] bg-sheet shadow-card" transition={SNAP} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-[15px] text-ink">{label}</span>
        {description && <span className="block text-sm text-ink-3">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}
      >
        <motion.span
          className="absolute left-1 top-1 h-5 w-5 rounded-full bg-sheet shadow"
          animate={{ x: checked ? 20 : 0 }}
          transition={SNAP}
        />
      </button>
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/** Composed empty state: a quiet line drawing, one teaching sentence, one action. */
export function EmptyState({ title, body, action, art = 'notebook' }: { title: string; body?: string; action?: ReactNode; art?: 'notebook' | 'chart' | 'target' | 'inbox' }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-line px-5 py-8 sm:flex-row sm:items-center">
      <EmptyArt kind={art} />
      <div className="flex-1">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {body && <p className="mt-1 max-w-[52ch] text-sm text-ink-2">{body}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

function EmptyArt({ kind }: { kind: 'notebook' | 'chart' | 'target' | 'inbox' }) {
  const common = { fill: 'none', stroke: 'rgb(var(--ink-3))', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden className="shrink-0">
      <rect x="4" y="4" width="64" height="64" rx="18" fill="rgb(var(--mist))" />
      {kind === 'notebook' && (
        <g {...common}>
          <rect x="22" y="18" width="28" height="36" rx="4" />
          <path d="M28 28h16M28 35h16M28 42h9" />
          <circle cx="50" cy="50" r="7" fill="rgb(var(--accent))" stroke="none" />
          <path d="M50 47v6M47 50h6" stroke="rgb(var(--on-accent))" />
        </g>
      )}
      {kind === 'chart' && (
        <g {...common}>
          <path d="M20 52h32" />
          <path d="M24 46v-8M33 46V28M42 46v-12" stroke="rgb(var(--accent))" strokeWidth={4} />
        </g>
      )}
      {kind === 'target' && (
        <g {...common}>
          <circle cx="36" cy="36" r="15" />
          <circle cx="36" cy="36" r="8" />
          <circle cx="36" cy="36" r="2.5" fill="rgb(var(--accent))" stroke="none" />
        </g>
      )}
      {kind === 'inbox' && (
        <g {...common}>
          <path d="M20 38l6-16h20l6 16v12H20z" />
          <path d="M20 38h10l2 5h8l2-5h10" stroke="rgb(var(--accent))" />
        </g>
      )}
    </svg>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. Drag down or Esc to close. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const dragControls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={clsx(
              'relative flex max-h-[92dvh] w-full flex-col rounded-t-sheet border border-line bg-sheet shadow-lift sm:rounded-sheet',
              wide ? 'sm:max-w-2xl' : 'sm:max-w-[480px]',
            )}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={SNAP}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            dragControls={dragControls}
            onDragEnd={onDragEnd}
          >
            <div
              className="flex h-6 cursor-grab touch-none items-center justify-center sm:hidden"
              onPointerDown={(e) => dragControls.start(e)}
              aria-hidden
            >
              <span className="h-1.5 w-10 rounded-full bg-line" />
            </div>
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-1">
              <h2 id={titleId} className="text-lg">
                {title}
              </h2>
              <IconButton label="Close" onClick={onClose}>
                <X size={20} />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
            {footer && <div className="safe-bottom border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Dot({ colour, className }: { colour: string; className?: string }) {
  return <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: colour }} aria-hidden />;
}
