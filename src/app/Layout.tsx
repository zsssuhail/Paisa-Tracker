import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { clsx } from 'clsx';
import {
  ArrowDownToLine,
  BarChart3,
  Home,
  ListOrdered,
  Plus,
  Settings,
  Target,
  Users,
  Wallet,
  Repeat,
  Tags,
} from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useData } from '@/data/store';
import { useUI } from './ui';
import { QuickAddSheet } from '@/features/transactions/QuickAddSheet';
import { IncomeSplitSheet } from '@/features/goals/IncomeSplitSheet';
import { SNAP } from '@/design/ui';

const NAV = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/transactions', label: 'Transactions', Icon: ListOrdered },
  { to: '/budget', label: 'Budget', Icon: Wallet },
  { to: '/goals', label: 'Goals', Icon: Target },
  { to: '/insights', label: 'Insights', Icon: BarChart3 },
];

const MORE = [
  { to: '/import', label: 'Import', Icon: ArrowDownToLine },
  { to: '/friends', label: 'Money with friends', Icon: Users },
  { to: '/recurring', label: 'Recurring', Icon: Repeat },
  { to: '/categories', label: 'Categories', Icon: Tags },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

function useInboxCount() {
  const txs = useData((s) => s.transactions);
  return useMemo(() => txs.filter((t) => t.type === 'expense' && !t.excluded && !t.categoryId).length, [txs]);
}

export function Layout({ children }: { children: ReactNode }) {
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const savedTick = useUI((s) => s.savedTick);
  const inbox = useInboxCount();
  const fab = useAnimationControls();
  const location = useLocation();
  const sampleLoaded = useData((s) => s.settings.sampleLoaded);

  useEffect(() => {
    if (savedTick) void fab.start({ scale: [1, 0.92, 1.04, 1], transition: { duration: 0.42 } });
  }, [savedTick, fab]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Keyboard: "n" opens quick add from anywhere (outside inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        openQuickAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openQuickAdd]);

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr] print:block">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-sheet focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-[100dvh] flex-col border-r border-line px-4 py-6 print:hidden lg:flex" aria-label="Main">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((n) => (
            <RailLink key={n.to} {...n} badge={n.to === '/transactions' ? inbox : 0} />
          ))}
        </nav>
        <p className="label-quiet mb-2 mt-8 px-3">More</p>
        <nav className="flex flex-col gap-1" aria-label="More">
          {MORE.map((n) => (
            <RailLink key={n.to} {...n} />
          ))}
        </nav>
        <motion.button
          animate={fab}
          onClick={() => openQuickAdd()}
          className="press mt-auto flex h-12 items-center justify-center gap-2 rounded-[14px] bg-accent font-medium text-on-accent"
        >
          <Plus size={20} strokeWidth={2.25} aria-hidden /> Add payment
          <kbd className="ml-1 rounded bg-on-accent/15 px-1.5 text-xs">N</kbd>
        </motion.button>
      </aside>

      <div className="min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-canvas/85 px-4 backdrop-blur-md print:hidden lg:hidden">
          <Brand />
          <MobileMore />
        </header>

        {sampleLoaded && (
          <div className="mx-auto max-w-[1200px] px-4 pt-3 print:hidden lg:px-10 lg:pt-6">
            <SampleBanner />
          </div>
        )}

        <main id="main" className="mx-auto max-w-[1200px] px-4 pb-36 pt-4 lg:px-10 lg:pb-16 lg:pt-8">
          {children}
        </main>
      </div>

      {/* Mobile FAB (hidden where a screen has its own bottom action bar) */}
      <motion.button
        animate={fab}
        onClick={() => openQuickAdd()}
        aria-label="Add a payment"
        className={clsx(location.pathname.startsWith('/import') ? 'hidden' : 'grid', 'press fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-40 h-[60px] w-[60px] place-items-center rounded-[20px] bg-accent text-on-accent shadow-lift print:hidden lg:hidden')}
      >
        <Plus size={28} strokeWidth={2.25} aria-hidden />
      </motion.button>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-sheet/95 backdrop-blur-md print:hidden lg:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx('relative flex h-[68px] flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'font-medium text-accent' : 'text-ink-3')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" className="absolute top-2 h-8 w-14 rounded-full bg-mist" transition={SNAP} />}
                    <span className="relative">
                      <Icon size={22} strokeWidth={1.75} aria-hidden />
                      {to === '/transactions' && inbox > 0 && <InboxBadge count={inbox} />}
                    </span>
                    <span className="relative">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <QuickAddSheet />
      <IncomeSplitSheet />
      <ToastHost />
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 px-1" aria-label="Paisa home">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-on-accent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 6h10M7 10h10M7 6c4 0 5.5 1.5 5.5 3S11 12 7 12l7 6" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">Paisa</span>
    </NavLink>
  );
}

function InboxBadge({ count }: { count: number }) {
  return (
    <span
      className="pulse-soft absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10px] font-semibold text-sheet"
      aria-label={`${count} need a category`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function RailLink({ to, label, Icon, badge = 0 }: { to: string; label: string; Icon: typeof Home; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px]',
          isActive ? 'bg-mist font-medium text-accent' : 'text-ink-2 hover:bg-shelf hover:text-ink',
        )
      }
    >
      <Icon size={19} strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="pulse-soft rounded-full bg-warn px-2 text-xs font-semibold text-sheet" aria-label={`${badge} need a category`}>
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function MobileMore() {
  return (
    <div className="flex items-center gap-1">
      {MORE.filter((m) => ['/import', '/friends', '/settings'].includes(m.to)).map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={label}
          title={label}
          className={({ isActive }) => clsx('grid h-11 w-11 place-items-center rounded-xl', isActive ? 'bg-mist text-accent' : 'text-ink-2')}
        >
          <Icon size={20} strokeWidth={1.75} aria-hidden />
        </NavLink>
      ))}
    </div>
  );
}

function SampleBanner() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-sheet py-1 pl-4 pr-1 text-sm">
      <span className="text-ink-2">
        <span className="font-medium text-ink">Sample data</span>
        <span className="hidden sm:inline"> — explore freely, then clear it in one tap.</span>
      </span>
      <ClearSampleButton />
    </div>
  );
}

function ClearSampleButton() {
  const showToast = useUI((s) => s.showToast);
  return (
    <button
      className="press h-11 shrink-0 rounded-xl px-3 font-medium text-accent hover:bg-mist"
      onClick={async () => {
        const { clearSample } = await import('@/features/onboarding/sample');
        await clearSample();
        showToast({ message: 'Sample data cleared. Fresh start.' });
      }}
    >
      Clear sample data
    </button>
  );
}

function ToastHost() {
  const toast = useUI((s) => s.toast);
  const dismiss = useUI((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 5000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-8" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={SNAP}
            className="pointer-events-auto flex min-h-[48px] max-w-md items-center gap-4 rounded-2xl bg-ink px-4 py-2 text-[15px] text-canvas shadow-lift"
            role="status"
          >
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button
                className="h-10 rounded-lg px-2 font-semibold text-mist underline-offset-2 hover:underline"
                onClick={() => {
                  toast.onAction?.();
                  dismiss();
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
