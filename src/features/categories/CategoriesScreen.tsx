import { clsx } from 'clsx';
import { Archive, ArchiveRestore, GitMerge, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '@/data/store';
import { useUI } from '@/app/ui';
import type { Category } from '@/data/types';
import { categoryColour } from '@/data/selectors';
import { seriesVar } from '@/design/chartPalette';
import { Button, Field, Input, Segmented, Select, Sheet } from '@/design/ui';
import { Icon, ICON_NAMES } from '@/design/icons';
import { addCategory, addGroup, mergeCategories, updateCategory } from './actions';

export default function CategoriesScreen() {
  const categories = useData((s) => s.categories);
  const groups = useData((s) => s.groups);
  const txs = useData((s) => s.transactions);
  const [editing, setEditing] = useState<Category | null>(null);
  const [newName, setNewName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) if (t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    return m;
  }, [txs]);
  const archived = categories.filter((c) => c.archived);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[28px] leading-tight">Categories</h1>
        <p className="mt-1 text-sm text-ink-3">Rename, recolour, regroup. Changes show up everywhere straight away.</p>
      </header>

      <form
        className="flex max-w-md gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          await addCategory(newName.trim());
          setNewName('');
        }}
      >
        <Input aria-label="New category name" placeholder="New category, e.g. Gym" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" variant="primary" icon={<Plus size={16} />}>
          Add
        </Button>
      </form>

      {[...groups]
        .sort((a, b) => a.order - b.order)
        .map((g) => {
          const list = categories.filter((c) => c.groupId === g.id && !c.archived).sort((a, b) => a.order - b.order);
          return (
            <section key={g.id} aria-labelledby={`grp-${g.id}`}>
              <h2 id={`grp-${g.id}`} className="label-quiet mb-2">
                {g.name}
              </h2>
              {list.length === 0 ? (
                <p className="text-sm text-ink-3">Empty group.</p>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setEditing(c)} className="press flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 text-left hover:bg-shelf">
                        <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${categoryColour(c)} 15%, transparent)`, color: categoryColour(c) }}>
                          <Icon name={c.icon} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px]">{c.name}</span>
                          <span className="block text-[13px] text-ink-3">
                            {c.nature === 'need' ? 'Need' : 'Want'}, {counts.get(c.id) ?? 0} payments
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

      <NewGroup />

      {archived.length > 0 && (
        <section>
          <button className="h-11 text-sm font-medium text-ink-2" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-1">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-ink-3">
                  <Icon name={c.icon} size={18} />
                  <span className="flex-1">{c.name}</span>
                  <Button size="sm" variant="ghost" icon={<ArchiveRestore size={16} />} onClick={() => updateCategory(c.id, { archived: false })}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editing && <CategorySheet category={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewGroup() {
  const [name, setName] = useState('');
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await addGroup(name.trim());
        setName('');
      }}
    >
      <Input aria-label="New group name" placeholder="New group" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit">Add group</Button>
    </form>
  );
}

function CategorySheet({ category, onClose }: { category: Category; onClose: () => void }) {
  const groups = useData((s) => s.groups);
  const categories = useData((s) => s.categories);
  const showToast = useUI((s) => s.showToast);
  const [c, setC] = useState(category);
  const [mergeInto, setMergeInto] = useState('');
  const set = <K extends keyof Category>(k: K, v: Category[K]) => setC((x) => ({ ...x, [k]: v }));
  const save = async () => {
    await updateCategory(c.id, { name: c.name.trim() || category.name, icon: c.icon, colour: c.colour, groupId: c.groupId, nature: c.nature });
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit category"
      footer={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            icon={<Archive size={16} />}
            onClick={async () => {
              await updateCategory(c.id, { archived: true });
              onClose();
              showToast({ message: `${c.name} archived`, actionLabel: 'Undo', onAction: () => void updateCategory(c.id, { archived: false }) });
            }}
          >
            Archive
          </Button>
          <Button variant="primary" className="flex-1" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor="c-name">
          <Input id="c-name" value={c.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group" htmlFor="c-group">
            <Select id="c-group" value={c.groupId} onChange={(e) => set('groupId', e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-2">Need or want</p>
            <Segmented
              label="Need or want"
              className="w-full"
              value={c.nature}
              onChange={(v) => set('nature', v)}
              options={[
                { value: 'need', label: 'Need' },
                { value: 'want', label: 'Want' },
              ]}
            />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Colour</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
              <button
                key={slot}
                type="button"
                role="radio"
                aria-checked={c.colour === slot}
                aria-label={`Colour ${slot}`}
                onClick={() => set('colour', slot)}
                className={clsx('grid h-11 w-11 place-items-center rounded-full', c.colour === slot && 'ring-2 ring-ink ring-offset-2 ring-offset-sheet')}
              >
                <span className="h-7 w-7 rounded-full" style={{ background: seriesVar(slot) }} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Icon</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
            {ICON_NAMES.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={c.icon === n}
                aria-label={n}
                onClick={() => set('icon', n)}
                className={clsx('grid h-11 w-11 place-items-center rounded-xl', c.icon === n ? 'bg-accent text-on-accent' : 'bg-shelf text-ink-2')}
              >
                <Icon name={n} size={18} />
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line p-4">
          <p className="text-sm font-medium">Merge into another category</p>
          <p className="mt-0.5 text-sm text-ink-3">Moves every payment, rule and budget line, then archives this one.</p>
          <div className="mt-3 flex gap-2">
            <Select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">Choose…</option>
              {categories
                .filter((x) => !x.archived && x.id !== c.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
            <Button
              disabled={!mergeInto}
              icon={<GitMerge size={16} />}
              onClick={async () => {
                await mergeCategories(c.id, mergeInto);
                showToast({ message: `Merged into ${categories.find((x) => x.id === mergeInto)?.name}` });
                onClose();
              }}
            >
              Merge
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
