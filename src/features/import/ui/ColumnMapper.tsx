import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { repo } from '@/data/repo';
import { uid } from '@/data/db';
import type { ColumnMapping } from '@/data/types';
import { Button, Field, Input, Segmented, Select } from '@/design/ui';
import { customParser } from '../parsers/others';
import { headerSignature, readTable } from '../table';
import type { ImportFile, Parser } from '../types';

type Role = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'reference';
const ROLE_LABEL: Record<Role, string> = {
  date: 'Date',
  description: 'Description / payee',
  amount: 'Amount',
  debit: 'Money out (debit)',
  credit: 'Money in (credit)',
  balance: 'Balance (optional)',
  reference: 'Reference (optional)',
};

/**
 * For layouts no parser knows: pick which column is which, see the result live,
 * and save it as a named source so the same file type imports by itself next time.
 */
export function ColumnMapper({
  file,
  table,
  suggested,
  onBack,
  onDone,
}: {
  file: ImportFile;
  table: string[][];
  suggested: Partial<ColumnMapping>;
  onBack: () => void;
  onDone: (mapping: ColumnMapping, parser: Parser) => void;
}) {
  const [headerRow, setHeaderRow] = useState(suggested.headerRow ?? 0);
  const [split, setSplit] = useState<'one' | 'two'>(suggested.debit != null ? 'two' : 'one');
  const [cols, setCols] = useState<Partial<Record<Role, number>>>({
    date: suggested.date,
    description: suggested.description,
    amount: suggested.amount,
    debit: suggested.debit,
    credit: suggested.credit,
    balance: suggested.balance,
    reference: suggested.reference,
  });
  const [dateFormat, setDateFormat] = useState<ColumnMapping['dateFormat']>(suggested.dateFormat ?? 'DMY');
  const [name, setName] = useState(file.name.replace(/\.[^.]+$/, ''));

  const width = Math.max(...table.slice(0, 50).map((r) => r.length));
  const header = table[headerRow] ?? [];
  const mapping: ColumnMapping | null =
    cols.date != null && cols.description != null && (split === 'one' ? cols.amount != null : cols.debit != null && cols.credit != null)
      ? {
          headerRow,
          date: cols.date,
          description: cols.description,
          dateFormat,
          dateFormatConfirmed: true,
          ...(split === 'one' ? { amount: cols.amount } : { debit: cols.debit, credit: cols.credit }),
          balance: cols.balance,
          reference: cols.reference,
        }
      : null;
  const preview = useMemo(() => (mapping ? readTable(table, mapping) : null), [table, mapping]);
  const roles: Role[] = ['date', 'description', ...(split === 'one' ? (['amount'] as Role[]) : (['debit', 'credit'] as Role[])), 'balance', 'reference'];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <button onClick={onBack} aria-label="Back" className="-ml-2 grid h-11 w-11 place-items-center rounded-xl hover:bg-shelf">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-[24px] leading-tight">Which column is which?</h1>
          <p className="mt-1 text-sm text-ink-3">I haven't seen this layout before. Point me at the columns once and I'll remember it.</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Field label="Headings are on row" htmlFor="hdr-row">
            <Select id="hdr-row" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
              {table.slice(0, 40).map((r, i) => (
                <option key={i} value={i}>
                  {i + 1}: {r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60)}
                </option>
              ))}
            </Select>
          </Field>
          <Segmented
            label="Amounts"
            className="w-full"
            value={split}
            onChange={setSplit}
            options={[
              { value: 'one', label: 'One amount column' },
              { value: 'two', label: 'Debit and credit' },
            ]}
          />
          {roles.map((role) => (
            <Field key={role} label={ROLE_LABEL[role]} htmlFor={`map-${role}`}>
              <Select id={`map-${role}`} value={cols[role] ?? ''} onChange={(e) => setCols((c) => ({ ...c, [role]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                <option value="">—</option>
                {Array.from({ length: width }, (_, i) => (
                  <option key={i} value={i}>
                    Column {i + 1}
                    {header[i] ? `: ${header[i]}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Field label="Dates look like" htmlFor="map-df">
            <Select id="map-df" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ColumnMapping['dateFormat'])}>
              <option value="DMY">31/12/2026 (day first)</option>
              <option value="MDY">12/31/2026 (month first)</option>
              <option value="YMD">2026-12-31</option>
            </Select>
          </Field>
          <Field label="Save this layout as" htmlFor="map-name" helper="Next time a file like this imports by itself.">
            <Input id="map-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={!mapping || !preview?.rows.length}
            onClick={async () => {
              if (!mapping) return;
              const source = { id: uid(), name: name.trim() || 'My bank', headerSignature: headerSignature(table, headerRow), mapping, createdAt: Date.now() };
              await repo.customSources.put(source);
              onDone(mapping, customParser(source));
            }}
          >
            {preview?.rows.length ? `Continue with ${preview.rows.length} payments` : 'Pick the columns'}
          </Button>
        </div>

        <div className="min-w-0 lg:col-span-7">
          <p className="mb-2 text-sm font-medium text-ink-2">Your file</p>
          <div className="max-h-[520px] overflow-auto rounded-2xl border border-line">
            <table className="text-[13px]">
              <tbody>
                {table.slice(0, 40).map((r, i) => (
                  <tr key={i} className={clsx(i === headerRow ? 'bg-mist font-medium' : i < headerRow && 'text-ink-3')}>
                    <th className="px-2 py-1.5 text-left text-xs font-normal text-ink-3">{i + 1}</th>
                    {Array.from({ length: width }, (_, j) => {
                      const role = (Object.entries(cols) as [Role, number | undefined][]).find(([, v]) => v === j)?.[0];
                      return (
                        <td key={j} className={clsx('max-w-[220px] truncate whitespace-nowrap px-2 py-1.5', role && 'bg-accent/10')} title={r[j]}>
                          {i === headerRow && role ? <span className="mr-1 rounded bg-accent px-1 text-[10px] text-on-accent">{ROLE_LABEL[role].split(' ')[0]}</span> : null}
                          {r[j]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview && (
            <p className="mt-2 text-sm text-ink-3">
              {preview.rows.length} payments read{preview.unreadable.length ? `, ${preview.unreadable.length} rows I couldn't read` : ''}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
