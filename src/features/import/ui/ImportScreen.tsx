import { clsx } from 'clsx';
import { FileUp, History, Lock, ShieldCheck, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import { formatLong } from '@/data/dates';
import type { ColumnMapping, SourceKind } from '@/data/types';
import { Button, Chip, Field, Input, inputClass } from '@/design/ui';
import { loadFile, fromPaste, PasswordRequired, UnsupportedFile } from '../load';
import { allParsers, rankParsers } from '../parsers';
import { parseWithMapping, tableOf } from '../parsers/bank';
import { pdfLinesToLooseTable } from '../pdf/toTable';
import { detectColumns } from '../table';
import type { ImportFile, ParseResult, Parser } from '../types';
import { buildCandidates, type Candidate } from '../pipeline/build';
import { reconcile, type Reconciliation } from '../pipeline/reconcile';
import { undoImport } from '../pipeline/commit';
import { ReviewScreen } from './ReviewScreen';
import { ColumnMapper } from './ColumnMapper';

const SOURCES: { id: string; label: string; hint: string }[] = [
  { id: 'auto', label: 'Detect for me', hint: 'I work out what it is from the file itself, whatever its name.' },
  { id: 'googlepay', label: 'Google Pay', hint: 'Takeout My Activity.html / .json, or the statement PDF' },
  { id: 'bank', label: 'Bank statement', hint: 'PDF, CSV or Excel from IOB, SBI, HDFC, ICICI, Axis, Canara, Kotak…' },
  { id: 'phonepe', label: 'PhonePe', hint: 'Statement PDF' },
  { id: 'paytm', label: 'Paytm', hint: 'Passbook CSV or Excel' },
  { id: 'legacy-sheet', label: 'My old spreadsheet', hint: 'Your Numbers, Excel or CSV file as it is, including a Money In sheet' },
];

export interface Prepared {
  file: ImportFile;
  parser: Parser;
  result: ParseResult;
  candidates: Candidate[];
  reconciliation: Reconciliation | null;
}

type Step = { kind: 'pick' } | { kind: 'password'; file: File } | { kind: 'mapping'; file: ImportFile; table: string[][]; suggested: Partial<ColumnMapping> } | { kind: 'review'; prepared: Prepared };

export default function ImportScreen() {
  const s = useData();
  const showToast = useUI((x) => x.showToast);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [source, setSource] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState('');
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const prepare = (file: ImportFile, parser: Parser, result: ParseResult) => {
    const candidates = buildCandidates(result.rows, {
      existing: s.transactions,
      rules: s.rules,
      people: s.people,
      categories: s.categories,
      sourceKind: parser.source as SourceKind,
      parserId: parser.id,
      holderName: result.holderName,
    });
    setStep({ kind: 'review', prepared: { file, parser, result, candidates, reconciliation: reconcile(result.rows) } });
  };

  const open = async (file: ImportFile) => {
    const ranked = rankParsers(file, s.customSources).filter((r) => r.confidence >= 0.4);
    const picked = source === 'auto' ? ranked : ranked.filter((r) => r.parser.id === source || (source === 'bank' && ['iob', 'bank'].includes(r.parser.id)));
    // Try every reader that recognises the file, best first; a reader that trips on an odd file never stops the next one.
    let onlySkipped: { parser: Parser; result: ParseResult } | null = null;
    for (const { parser } of picked.length ? picked : ranked) {
      let result: ParseResult;
      try {
        result = parser.parse(file);
      } catch (e) {
        console.warn(`${parser.id} could not read ${file.name}`, e);
        continue;
      }
      if (result.rows.length) return prepare(file, parser, result);
      if (result.skipped && !onlySkipped) onlySkipped = { parser, result };
    }
    if (onlySkipped) {
      const n = onlySkipped.result.skipped;
      setError(`This ${onlySkipped.parser.label} file has ${n === 1 ? 'one payment' : `${n} payments`}, but ${n === 1 ? 'it was' : 'all were'} cancelled, failed or still pending, so there's nothing to add.`);
      return;
    }
    // Unknown layout: never fail, ask which column is which.
    const table = tableOf(file) ?? (file.lines ? pdfLinesToLooseTable(file.lines) : null);
    if (table?.length) {
      const guess = detectColumns(table);
      setStep({ kind: 'mapping', file, table, suggested: guess?.mapping ?? {} });
      return;
    }
    setError("I couldn't find any payments in that file. If it's a scanned PDF, try the CSV or Excel download from your bank instead.");
  };

  const onFile = async (f: File, pw?: string) => {
    setBusy(true);
    setError(null);
    try {
      await open(await loadFile(f, pw));
    } catch (e) {
      if (e instanceof PasswordRequired) {
        if (pw) setError("That password didn't open the PDF. Bank statements often use your date of birth (DDMMYYYY) or customer ID.");
        setStep({ kind: 'password', file: f });
      } else if (e instanceof UnsupportedFile) setError(e.message);
      else setError(`Couldn't open ${f.name}. Try downloading it again, or export it as CSV or Excel. (${(e as Error).message})`);
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'review') {
    return (
      <ReviewScreen
        prepared={step.prepared}
        onBack={() => setStep({ kind: 'pick' })}
        onRemap={() => {
          const f = step.prepared.file;
          const table = tableOf(f) ?? (f.lines ? pdfLinesToLooseTable(f.lines) : []);
          setStep({ kind: 'mapping', file: f, table, suggested: detectColumns(table)?.mapping ?? {} });
        }}
      />
    );
  }

  if (step.kind === 'mapping') {
    return (
      <ColumnMapper
        file={step.file}
        table={step.table}
        suggested={step.suggested}
        onBack={() => setStep({ kind: 'pick' })}
        onDone={(mapping, parser) => {
          const result = parseWithMapping({ ...step.file, table: step.table, lines: undefined }, mapping);
          prepare(step.file, parser, result);
        }}
      />
    );
  }

  const recent = [...s.batches].sort((a, b) => b.importedAt - a.importedAt).slice(0, 8);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[28px] leading-tight">Import</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
          <ShieldCheck size={15} className="text-accent" aria-hidden /> Files are read on this device. Nothing is uploaded.
        </p>
      </header>

      {step.kind === 'password' ? (
        <form
          className="card flex max-w-md flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onFile(step.file, password);
          }}
        >
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <Lock size={18} aria-hidden /> {step.file.name} is password protected
          </p>
          <p className="text-sm text-ink-2">Bank statements often use your date of birth or customer ID. The password is used once to open the file and isn't saved.</p>
          <Field label="PDF password" htmlFor="pdf-pw">
            <Input id="pdf-pw" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'pick' })}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!password || busy}>
              Open
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">What are you importing?</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Source">
                {SOURCES.map((x) => (
                  <Chip key={x.id} selected={source === x.id} onClick={() => setSource(x.id)} role="radio" aria-checked={source === x.id}>
                    {x.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-sm text-ink-3">{SOURCES.find((x) => x.id === source)?.hint}</p>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void onFile(f);
              }}
              className={clsx(
                'flex min-h-[220px] cursor-pointer flex-col items-start justify-end gap-3 rounded-card border-2 border-dashed p-6 transition-colors',
                drag ? 'border-accent bg-mist' : 'border-line bg-sheet hover:border-accent/50',
                busy && 'pointer-events-none opacity-60',
              )}
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mist text-accent">
                <FileUp size={22} aria-hidden />
              </span>
              <span>
                <span className="block text-lg font-medium">{busy ? 'Reading your file…' : 'Drop a file here, or tap to choose'}</span>
                <span className="block text-sm text-ink-3">PDF, Excel, Numbers, CSV, HTML or JSON, any file name</span>
              </span>
              <input
                ref={input}
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            {error && (
              <p role="alert" className="rounded-2xl border border-over/30 bg-over/5 p-4 text-sm text-ink">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:col-span-5">
            <label htmlFor="paste" className="text-sm font-medium text-ink-2">
              Or paste statement rows or SMS alerts
            </label>
            <textarea
              id="paste"
              rows={7}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'Rs.50.00 debited from A/c XX1234 on 01-10-26 to VPA csa@ybl (UPI Ref No 629032644176)\n\n05/10/2026 UPI/629032644176/DR/CSA Automobile/YES/UPI 50.00 4,950.00'}
              className={clsx(inputClass, 'h-auto py-3 font-mono text-[13px]')}
            />
            <Button
              disabled={!paste.trim() || busy}
              onClick={async () => {
                setError(null);
                const f = fromPaste(paste);
                if (f.kind === 'text') {
                  const parser = allParsers(s.customSources).find((p) => p.id === 'paste')!;
                  const result = parser.parse(f);
                  if (!result.rows.length) return setError("I couldn't find a payment in that text. Each entry needs a date and an amount.");
                  return prepare(f, parser, result);
                }
                await open(f);
              }}
            >
              Read pasted text
            </Button>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="past-imports">
          <h2 id="past-imports" className="mb-3 flex items-center gap-2 text-[17px]">
            <History size={18} aria-hidden /> Past imports
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-sheet">
            {recent.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{b.fileName}</p>
                  <p className="text-[13px] text-ink-3">
                    {formatLong(new Date(b.importedAt).toISOString().slice(0, 10))}, {b.counts.added} added, {b.counts.merged} merged, {b.counts.duplicates} duplicates skipped
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Undo2 size={16} />}
                  onClick={async () => {
                    await undoImport(b.id);
                    showToast({ message: `Import undone: ${b.counts.added} removed` });
                  }}
                >
                  Undo import
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-card bg-shelf/60 p-5 text-sm text-ink-2">
        <p className="font-medium text-ink">Where to get your files</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>
            <span className="text-ink">Google Pay:</span> takeout.google.com → select only "Google Pay" → download → open <span className="font-mono">My Activity.html</span>.
          </li>
          <li>
            <span className="text-ink">Bank:</span> net banking → Account statement → choose dates → download as PDF, CSV or Excel.
          </li>
          <li>
            <span className="text-ink">Old spreadsheet:</span> drop the Numbers or Excel file straight in.
          </li>
        </ul>
      </section>
    </div>
  );
}
