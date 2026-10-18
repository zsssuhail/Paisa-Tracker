import { useNavigate } from 'react-router-dom';
import { useUI } from '@/app/ui';
import { formatMoney } from '@/data/money';
import { addMonths, todayISO } from '@/data/dates';
import { setCategoryLimitNow } from '@/features/budget/actions';
import { createRecurring } from '@/features/recurring/run';
import type { Insight } from './engine';

/** Runs the follow-up attached to an insight card. */
export function useInsightAction() {
  const navigate = useNavigate();
  const showToast = useUI((s) => s.showToast);
  return async (action: NonNullable<Insight['action']>) => {
    if ('to' in action) {
      navigate(action.to);
      return;
    }
    if (action.kind === 'limit') {
      await setCategoryLimitNow(action.categoryId, action.amountPaise);
      showToast({ message: `Limit set: ${formatMoney(action.amountPaise)} this month` });
      return;
    }
    await createRecurring({
      name: action.place,
      amountPaise: action.amountPaise,
      categoryId: action.categoryId,
      place: action.place,
      paymentMode: 'UPI',
      frequency: 'monthly',
      nextDue: addMonths(todayISO(), 1),
      mode: 'remind',
    });
    showToast({ message: `${action.place} added to recurring` });
  };
}
