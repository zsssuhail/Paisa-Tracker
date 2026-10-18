import { Download, FileJson, Lock, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/data/store';
import { repo, importSnapshot, wipeEverything, type Snapshot } from '@/data/repo';
import { useUI } from '@/app/ui';
import { formatMoney } from '@/data/money';
import { useCategoryMap } from '@/data/selectors';
import { Button, Field, Input, Segmented, Select, Sheet, Toggle } from '@/design/ui';
import { downloadBackup, downloadCSV } from './exporters';
import { hashPin, PinPad } from './PinGate';
import { clearSample, loadSample } from '@/features/onboarding/sample';

const CURRENCIES = [
  { code: 'INR', locale: 'en-IN', label: '₹ Indian rupee (1,25,000)' },
  { code: 'INR', locale: 'en-US', label: '₹ Indian rupee (125,000)' },
  { code: 'USD', locale: 'en-US', label: '$ US dollar' },
  { code: 'EUR', locale: 'de-DE', label: '€ Euro' },
  { code: 'GBP', locale: 'en-GB', label: '£ British pound' },
  { code: 'AED', locale: 'en-AE', label: 'AED UAE dirham' },
  { code: 'SGD', locale: 'en-SG', label: 'S$ Singapore dollar' },
];

export default function SettingsScreen() {
  const settings = useData((s) => s.settings);
  const txs = useData((s) => s.transactions);
  const catMap = useCategoryMap();
  const showToast = useUI((s) => s.showToast);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pinSetup, setPinSetup] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <header>
        <h1 className="text-[28px] leading-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-3">Everything is stored on this device only.</p>
      </header>

      <Group title="You">
        <Field label="Name" htmlFor="s-name">
          <Input id="s-name" defaultValue={settings.name} onBlur={(e) => repo.settings.patch({ name: e.target.value.trim() })} />
        </Field>
        <Field label="Currency and number style" htmlFor="s-cur" helper={`Example: ${formatMoney(12_500_000)}`}>
          <Select
            id="s-cur"
            value={`${settings.currency}|${settings.locale}`}
            onChange={(e) => {
              const [currency, locale] = e.target.value.split('|');
              void repo.settings.patch({ currency, locale });
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={`${c.code}|${c.locale}`} value={`${c.code}|${c.locale}`}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-2">Theme</p>
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => repo.settings.patch({ theme })}
            options={[
              { value: 'system', label: 'Match phone' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </Group>

      <Group title="Budget">
        <Field label="My month starts on" htmlFor="s-start" helper="The day your pocket money or salary arrives. Budgets, charts and safe-to-spend follow it.">
          <Select id="s-start" value={settings.monthStartDay} onChange={(e) => repo.settings.patch({ monthStartDay: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 1 ? '1st (calendar month)' : `Day ${d}`}
              </option>
            ))}
          </Select>
        </Field>
        <Toggle checked={settings.defaultRollover} onChange={(v) => repo.settings.patch({ defaultRollover: v })} label="Carry unspent money forward by default" description="New category limits roll leftovers into next month." />
        <div className="flex flex-wrap gap-2">
          <Link to="/categories" className="press inline-flex h-11 items-center rounded-xl bg-shelf px-3.5 text-sm font-medium">
            Edit categories
          </Link>
          <Link to="/recurring" className="press inline-flex h-11 items-center rounded-xl bg-shelf px-3.5 text-sm font-medium">
            Recurring items
          </Link>
        </div>
      </Group>

      <Group title="Privacy">
        <Toggle
          checked={Boolean(settings.pinHash)}
          onChange={async (on) => {
            if (on) setPinSetup(true);
            else {
              await repo.settings.patch({ pinHash: undefined });
              showToast({ message: 'App lock turned off' });
            }
          }}
          label="Lock with a PIN"
          description="Asks for a 4-digit PIN when you open the app."
        />
        <p className="flex items-start gap-2 text-sm text-ink-3">
          <Lock size={15} className="mt-0.5 shrink-0" aria-hidden /> No account, no cloud, no tracking. Statements are read in the browser and never uploaded.
        </p>
      </Group>

      <Group title="Backup">
        <p className="text-sm text-ink-2">Save everything as one file, and restore it on any device. Do this now and then so you never lose your data.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<FileJson size={16} />} onClick={() => downloadBackup()}>
            Export backup
          </Button>
          <Button icon={<Upload size={16} />} onClick={() => fileInput.current?.click()}>
            Restore from backup
          </Button>
          <Button icon={<Download size={16} />} onClick={() => downloadCSV([...txs].sort((a, b) => a.date.localeCompare(b.date)), catMap, 'paisa-all')}>
            All payments as CSV
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const snap = JSON.parse(await f.text()) as Snapshot;
              const count = (snap.data?.transactions ?? []).length;
              if (!window.confirm(`Replace everything on this device with the backup from ${snap.exportedAt?.slice(0, 10)} (${count} payments)?`)) return;
              await importSnapshot(snap);
              showToast({ message: `Restored ${count} payments` });
            } catch (err) {
              showToast({ message: (err as Error).message || "That file couldn't be read" });
            }
          }}
        />
        <p className="text-xs text-ink-3">Bill photos stay on this device and aren't included in backups.</p>
      </Group>

      <Group title="Sample data">
        {settings.sampleLoaded ? (
          <Button
            icon={<RotateCcw size={16} />}
            onClick={async () => {
              await clearSample();
              showToast({ message: 'Sample data cleared' });
            }}
          >
            Clear sample data
          </Button>
        ) : (
          <Button
            icon={<Sparkles size={16} />}
            onClick={async () => {
              await loadSample();
              showToast({ message: 'Sample month loaded' });
            }}
          >
            Load a sample month
          </Button>
        )}
      </Group>

      <Group title="Start over">
        <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setWipe(true)}>
          Delete all data on this device
        </Button>
      </Group>

      <Sheet open={pinSetup} onClose={() => setPinSetup(false)} title="Choose a PIN">
        <PinSetup
          onDone={async (pin) => {
            await repo.settings.patch({ pinHash: await hashPin(pin) });
            try {
              sessionStorage.setItem('paisa-unlocked', '1');
            } catch {
              /* ignore */
            }
            setPinSetup(false);
            showToast({ message: 'App lock is on' });
          }}
        />
      </Sheet>

      <Sheet
        open={wipe}
        onClose={() => setWipe(false)}
        title="Delete everything?"
        footer={
          <Button
            variant="danger"
            className="w-full"
            disabled={confirmText.trim().toLowerCase() !== 'delete'}
            onClick={async () => {
              await wipeEverything();
              window.location.assign('/');
            }}
          >
            Delete all my data
          </Button>
        }
      >
        <p className="text-[15px] text-ink-2">This removes every payment, budget and goal from this device. It can't be undone. Export a backup first if you might want it back.</p>
        <Field label='Type "delete" to confirm' htmlFor="wipe-confirm">
          <Input id="wipe-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </Field>
      </Sheet>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="label-quiet">{title}</h2>
      {children}
    </section>
  );
}

function PinSetup({ onDone }: { onDone: (pin: string) => void }) {
  const [first, setFirst] = useState<string | null>(null);
  return (
    <PinPad
      key={first ? 'confirm' : 'choose'}
      compact
      title={first ? 'Type it again' : 'Pick 4 digits'}
      onComplete={async (pin) => {
        if (!first) {
          setFirst(pin);
          return true;
        }
        if (pin !== first) {
          setFirst(null);
          return false;
        }
        onDone(pin);
        return true;
      }}
    />
  );
}
