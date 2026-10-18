import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useData } from '@/data/store';
import { Layout } from './Layout';
import { useTheme } from './theme';
import { PinGate } from '@/features/settings/PinGate';
import { HomeScreen } from '@/features/home/HomeScreen';
import { TransactionsScreen } from '@/features/transactions/TransactionsScreen';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Skeleton } from '@/design/ui';
import { runDueRecurring } from '@/features/recurring/run';
import { runAutoSavings } from '@/features/goals/actions';
import { ensureDefaultCategories } from '@/features/categories/actions';

const BudgetScreen = lazy(() => import('@/features/budget/BudgetScreen'));
const GoalsScreen = lazy(() => import('@/features/goals/GoalsScreen'));
const InsightsScreen = lazy(() => import('@/features/insights/InsightsScreen'));
const ImportScreen = lazy(() => import('@/features/import/ui/ImportScreen'));
const FriendsScreen = lazy(() => import('@/features/friends/FriendsScreen'));
const SettingsScreen = lazy(() => import('@/features/settings/SettingsScreen'));
const CategoriesScreen = lazy(() => import('@/features/categories/CategoriesScreen'));
const RecurringScreen = lazy(() => import('@/features/recurring/RecurringScreen'));
const ReportScreen = lazy(() => import('@/features/insights/ReportScreen'));
const CommonScreen = lazy(() => import('@/features/insights/CommonScreen'));

function ScreenFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function App() {
  const ready = useData((s) => s.ready);
  const onboarded = useData((s) => s.settings.onboarded);
  useTheme();

  useEffect(() => {
    if (!ready || !onboarded) return;
    void ensureDefaultCategories()
      .then(() => runDueRecurring())
      .then(() => runAutoSavings());
  }, [ready, onboarded]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }
  if (!onboarded) return <Onboarding />;

  return (
    <PinGate>
      <Layout>
        <Suspense fallback={<ScreenFallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/transactions" element={<TransactionsScreen />} />
            <Route path="/budget" element={<BudgetScreen />} />
            <Route path="/goals" element={<GoalsScreen />} />
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/insights/common" element={<CommonScreen />} />
            <Route path="/report" element={<ReportScreen />} />
            <Route path="/import" element={<ImportScreen />} />
            <Route path="/friends" element={<FriendsScreen />} />
            <Route path="/recurring" element={<RecurringScreen />} />
            <Route path="/categories" element={<CategoriesScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </PinGate>
  );
}
