import type { Category, CategoryGroup } from '@/data/types';

export const DEFAULT_GROUPS: CategoryGroup[] = [
  { id: 'g-food', name: 'Food & drink', order: 0 },
  { id: 'g-essentials', name: 'Essentials', order: 1 },
  { id: 'g-lifestyle', name: 'Lifestyle', order: 2 },
  { id: 'g-fees', name: 'Fees & big items', order: 3 },
];

type Seed = [id: string, name: string, group: string, icon: string, colour: number, nature: 'need' | 'want'];

/** Colour slots are spread so categories inside one group never share a hue. */
const SEED: Seed[] = [
  ['c-snacks', 'Snacks', 'g-food', 'cookie', 2, 'want'],
  ['c-tea', 'Tea & Vada', 'g-food', 'coffee', 4, 'want'],
  ['c-eating-out', 'Eating Out', 'g-food', 'utensils', 8, 'want'],
  ['c-fruits', 'Fruits & Juice', 'g-food', 'apple', 6, 'need'],
  ['c-groceries', 'Groceries & Essentials', 'g-essentials', 'basket', 3, 'need'],
  ['c-stationery', 'Stationery & Books', 'g-essentials', 'book', 7, 'need'],
  ['c-travel', 'Travel & Transport', 'g-essentials', 'bus', 1, 'need'],
  ['c-medical', 'Medical & Health', 'g-essentials', 'health', 5, 'need'],
  ['c-laundry', 'Laundry', 'g-essentials', 'laundry', 2, 'need'],
  ['c-personal', 'Personal Care', 'g-essentials', 'scissors', 4, 'need'],
  ['c-shopping', 'Online Shopping', 'g-lifestyle', 'bag', 5, 'want'],
  ['c-phone', 'Phone & Gadgets', 'g-lifestyle', 'phone', 1, 'want'],
  ['c-events', 'Events', 'g-lifestyle', 'ticket', 3, 'want'],
  ['c-games', 'Games & Subscriptions', 'g-lifestyle', 'game', 7, 'want'],
  ['c-licence', 'Licence & RTO', 'g-fees', 'id', 6, 'need'],
  ['c-misc', 'Miscellaneous', 'g-fees', 'package', 8, 'want'],
];

export const DEFAULT_CATEGORIES: Category[] = SEED.map(([id, name, groupId, icon, colour, nature], order) => ({
  id,
  name,
  groupId,
  icon,
  colour,
  nature,
  archived: false,
  order,
}));
