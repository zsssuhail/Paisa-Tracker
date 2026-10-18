import { clsx } from 'clsx';
import { Download, Table2, BarChart3 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { formatMoney, formatMoneyShort } from '@/data/money';
import { IconButton } from '@/design/ui';
import { downloadNodeAsImage } from '@/features/settings/exporters';

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => ReactNode;
  numeric?: boolean;
}

/**
 * Every chart: a one-sentence takeaway above it, a table-view toggle (also the
 * screen-reader fallback), and a download-as-image button.
 */
export function ChartCard<T>({
  id,
  title,
  takeaway,
  children,
  rows,
  columns,
  className,
  legend,
}: {
  id: string;
  title: string;
  takeaway: ReactNode;
  children: ReactNode;
  rows: T[];
  columns: Column<T>[];
  className?: string;
  legend?: ReactNode;
}) {
  const [table, setTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const headingId = `${id}-title`;
  return (
    <section ref={ref} id={id} aria-labelledby={headingId} className={clsx('flex min-w-0 flex-col border-t border-line pb-2 pt-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-[15px] font-semibold text-ink">
            {title}
          </h3>
          <p className="mt-1 max-w-[60ch] text-[15px] leading-snug text-ink-2">{takeaway}</p>
        </div>
        <div className="-mr-2 -mt-2 flex shrink-0" data-export-hide>
          <IconButton label={table ? 'Show chart' : 'Show as table'} aria-pressed={table} onClick={() => setTable((t) => !t)}>
            {table ? <BarChart3 size={18} /> : <Table2 size={18} />}
          </IconButton>
          <IconButton
            label="Download as image"
            onClick={() => ref.current && downloadNodeAsImage(ref.current, `paisa-${id}.png`)}
          >
            <Download size={18} />
          </IconButton>
        </div>
      </div>
      {legend && !table && <div className="mt-3">{legend}</div>}
      <div className="mt-4 min-w-0 flex-1">
        {table ? (
          <DataTable rows={rows} columns={columns} caption={title} />
        ) : (
          <>
            <div aria-hidden>{children}</div>
            <div className="sr-only">
              <DataTable rows={rows} columns={columns} caption={title} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function DataTable<T>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  return (
    <div className="max-h-[360px] overflow-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-shelf text-left text-ink-2">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={clsx('px-3 py-2 font-medium', c.numeric && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={clsx('px-3 py-2', c.numeric && 'num text-right')}>
                  {c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Recessive axes: hairline, muted ink, compact money ticks. */
export const axisProps = {
  stroke: 'rgb(var(--line))',
  tick: { fill: 'rgb(var(--ink-3))', fontSize: 11, fontFamily: '"Geist Variable", sans-serif', fontFeatureSettings: '"tnum"' },
  tickLine: false,
  axisLine: false,
} as const;

export const moneyTick = (v: number) => formatMoneyShort(v);
export const gridProps = { stroke: 'rgb(var(--line))', strokeDasharray: '0', vertical: false } as const;

/** One tooltip, every series. Values lead, labels follow, keyed by a short line. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v: number) => formatMoney(v),
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }[];
  label?: string | number;
  labelFormatter?: (l: string | number, p?: Record<string, unknown>) => ReactNode;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => p.value != null);
  return (
    <div className="min-w-[160px] rounded-xl border border-line bg-sheet px-3 py-2 text-sm shadow-lift">
      {label != null && <p className="mb-1 text-xs text-ink-3">{labelFormatter ? labelFormatter(label, payload[0]?.payload) : label}</p>}
      <ul className="flex flex-col gap-1">
        {items.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="num font-medium text-ink">{valueFormatter(Number(p.value))}</span>
            <span className="truncate text-ink-3">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LegendItem({ colour, label, line, value }: { colour: string; label: ReactNode; line?: boolean; value?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
      <span className={line ? 'h-0.5 w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'} style={{ background: colour }} aria-hidden />
      {label}
      {value != null && <span className="num text-ink-3">{value}</span>}
    </span>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>;
}

export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];
