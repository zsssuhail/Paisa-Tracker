import { useEffect, useState } from 'react';
import { useUI } from '@/app/ui';
import { useData } from '@/data/store';
import { formatMoney, paiseToInput, parseMoney } from '@/data/money';
import { Button, Sheet } from '@/design/ui';
import { applyIncomeSplit, proposeIncomeSplit, type SplitProposal } from './actions';

/** Pay yourself first: when income lands, propose what goes to savings before spending. */
export function IncomeSplitSheet() {
  const tx = useUI((s) => s.incomeSplit);
  const close = useUI((s) => s.setIncomeSplit);
  const showToast = useUI((s) => s.showToast);
  const goals = useData((s) => s.goals);
  const buckets = useData((s) => s.buckets);
  const [items, setItems] = useState<SplitProposal[]>([]);
  const [text, setText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!tx) return;
    const p = proposeIncomeSplit(tx.amountPaise, goals, buckets);
    setItems(p);
    setText(Object.fromEntries(p.map((i) => [i.potId, paiseToInput(i.amountPaise)])));
    // Only when a new income arrives.
  }, [tx?.id]);

  if (!tx) return null;
  const resolved = items.map((i) => ({ ...i, amountPaise: parseMoney(text[i.potId] ?? '') ?? 0 }));
  const saved = resolved.reduce((s, i) => s + i.amountPaise, 0);
  const over = saved > tx.amountPaise;

  return (
    <Sheet
      open
      onClose={() => close(null)}
      title="Pay yourself first"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => close(null)}>
            Not now
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={over}
            onClick={async () => {
              await applyIncomeSplit(tx.id, tx.date, resolved);
              close(null);
              showToast({ message: `${formatMoney(saved)} saved before spending. Nice.` });
            }}
          >
            Save {formatMoney(saved)}
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-ink-2">
        <span className="num font-medium text-ink">{formatMoney(tx.amountPaise)}</span> just came in. Before you spend it, here's what your goals and buckets ask for this month.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {items.map((i) => (
          <li key={i.potId} className="flex items-center justify-between gap-3 py-2.5">
            <label htmlFor={`is-${i.potId}`} className="text-[15px]">
              {i.name}
            </label>
            <input
              id={`is-${i.potId}`}
              inputMode="decimal"
              value={text[i.potId] ?? ''}
              onChange={(e) => setText((t) => ({ ...t, [i.potId]: e.target.value.replace(/[^\d.]/g, '') }))}
              className="num h-11 w-32 rounded-xl border border-line bg-sheet px-3 text-right focus:border-accent focus:outline-none"
            />
          </li>
        ))}
      </ul>
      <p className={over ? 'mt-3 text-sm text-over' : 'mt-3 text-sm text-ink-3'}>
        {over ? 'That is more than came in.' : <>Left to spend: <span className="num text-ink-2">{formatMoney(tx.amountPaise - saved)}</span></>}
      </p>
    </Sheet>
  );
}
