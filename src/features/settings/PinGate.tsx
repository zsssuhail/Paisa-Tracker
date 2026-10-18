import { clsx } from 'clsx';
import { Delete, Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useData } from '@/data/store';

const SESSION_KEY = 'paisa-unlocked';

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`paisa:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readUnlocked() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Optional app lock. The PIN hash lives with the data; unlock lasts for the browser session. */
export function PinGate({ children }: { children: ReactNode }) {
  const pinHash = useData((s) => s.settings.pinHash);
  const [unlocked, setUnlocked] = useState(readUnlocked);
  if (!pinHash || unlocked) return <>{children}</>;
  return (
    <PinPad
      title="Enter your PIN"
      onComplete={async (pin) => {
        if ((await hashPin(pin)) !== pinHash) return false;
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          /* private mode: unlock for this render only */
        }
        setUnlocked(true);
        return true;
      }}
    />
  );
}

export function PinPad({ title, onComplete, length = 4, compact }: { title: string; onComplete: (pin: string) => Promise<boolean>; length?: number; compact?: boolean }) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    if (pin.length !== length) return;
    void onComplete(pin).then((ok) => {
      if (!ok) {
        setWrong(true);
        setTimeout(() => {
          setPin('');
          setWrong(false);
        }, 500);
      }
    });
  }, [pin, length, onComplete]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < length ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [length]);

  return (
    <div className={clsx('flex flex-col items-center justify-center gap-8 px-6', compact ? 'py-4' : 'min-h-[100dvh]')}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mist text-accent">
        <Lock size={22} aria-hidden />
      </span>
      <h1 className="text-xl">{title}</h1>
      <div className={clsx('flex gap-3', wrong && 'animate-[shake_.3s]')} aria-live="polite" aria-label={`${pin.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={clsx('h-3.5 w-3.5 rounded-full border-2', i < pin.length ? (wrong ? 'border-over bg-over' : 'border-accent bg-accent') : 'border-line')} />
        ))}
      </div>
      {wrong && <p className="text-sm text-over">That's not it. Try again.</p>}
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
          k === '' ? (
            <span key="blank" />
          ) : (
            <button
              key={k}
              aria-label={k === 'del' ? 'Delete digit' : k}
              onClick={() => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length < length ? p + k : p))}
              className="press num grid h-16 w-16 place-items-center rounded-full bg-shelf text-2xl hover:bg-line"
            >
              {k === 'del' ? <Delete size={22} aria-hidden /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
