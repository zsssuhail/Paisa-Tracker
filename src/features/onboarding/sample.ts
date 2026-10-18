import { repo } from '@/data/repo';
import { db } from '@/data/db';
import { addDays, daysInMonth, parts, periodFor, shiftPeriod, todayISO } from '@/data/dates';
import { rupees } from '@/data/money';
import { normalisePlace } from '@/features/rules/engine';
import type {
  Budget,
  Bucket,
  Contribution,
  Goal,
  PaymentMode,
  Person,
  Recurring,
  Rule,
  Split,
  Transaction,
} from '@/data/types';

/** Every sample row's id starts with this, so "Clear sample data" is one query. */
export const SAMPLE_PREFIX = 'sample-';

type Row = [day: number, item: string, rupees: number, categoryId: string, place: string, mode?: PaymentMode];

/** The realistic month from the brief (all amounts are my share). */
const MONTH: Row[] = [
  [1, 'Petrol', 50, 'c-travel', 'CSA Automobile'],
  [1, 'Xerox', 99, 'c-stationery', 'Sri Xerox'],
  [2, 'Fruits', 50, 'c-fruits', 'Fruit stall', 'Cash'],
  [2, 'Tea & vada', 108, 'c-tea', 'Meenakshi Bhavan'],
  [3, 'Snacks and tea', 44, 'c-tea', 'Ramana canteen'],
  [4, 'Rose milk', 50, 'c-snacks', 'Ramana canteen'],
  [4, 'Dinner', 212, 'c-eating-out', 'Swiggy'],
  [5, 'Phone case', 750, 'c-phone', 'Mobile World'],
  [6, 'Bus ticket', 530, 'c-travel', 'TNSTC'],
  [7, 'Laundry', 200, 'c-laundry', 'Campus laundry', 'Cash'],
  [8, 'Belt', 287, 'c-shopping', 'Flipkart'],
  [9, 'Lunch', 235, 'c-eating-out', 'Janani mess'],
  [10, 'Notebooks', 96, 'c-stationery', 'Lakshmi Stationers'],
  [11, 'SETC bus', 310, 'c-travel', 'SETC'],
  [12, 'Burger', 100, 'c-eating-out', 'Burger Point'],
  [13, 'Contact lenses', 560.2, 'c-medical', 'Vasan Eye Care'],
  [14, 'Mushroom dosa', 180, 'c-eating-out', 'Saravana Bhavan'],
  [15, 'Airtel recharge', 449, 'c-phone', 'Airtel'],
  [16, 'Group dinner', 223, 'c-eating-out', 'Annatchi Famous'],
  [17, 'Power petrol', 234.52, 'c-travel', 'CSA Automobile'],
];

const ONE_OFFS = new Set(['Phone case', 'Belt', 'Contact lenses', 'Group dinner']);
const FIXED_PRICE = new Set(['Airtel recharge', 'Laundry']);

/** Small deterministic PRNG so sample history is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function tx(id: string, date: string, partial: Partial<Transaction>): Transaction {
  const now = Date.now();
  return {
    id: SAMPLE_PREFIX + id,
    date,
    type: 'expense',
    amountPaise: 0,
    categoryId: null,
    item: '',
    place: '',
    paymentMode: 'UPI',
    note: '',
    sources: [{ kind: 'sample' }],
    isSample: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function buildSample(today = todayISO(), startDay = 1) {
  const current = periodFor(today, startDay);
  const txs: Transaction[] = [];

  // Current month: the brief's month, capped at today so nothing is in the future.
  const [, , todayDay] = parts(today);
  const dayCap = Math.min(todayDay, current.days);
  const spread = (day: number) => {
    const scaled = Math.max(1, Math.round((day / 17) * Math.max(1, dayCap - 1)));
    return addDays(current.start, Math.min(scaled, dayCap) - 1);
  };

  MONTH.forEach(([day, item, r, categoryId, place, mode], i) => {
    txs.push(
      tx(`m0-${i}`, spread(day), {
        item,
        amountPaise: rupees(r),
        categoryId,
        place,
        paymentMode: mode ?? 'UPI',
        note: item === 'Group dinner' ? 'My share of ₹1,100' : '',
      }),
    );
  });
  txs.push(tx('m0-income', current.start, { type: 'income', subtype: 'family', item: 'Monthly money from home', amountPaise: rupees(125_000), place: 'Family', paymentMode: 'Net banking' }));
  txs.push(
    tx('m0-game', spread(9), {
      item: 'Game subscription (yearly)',
      amountPaise: rupees(7_900),
      categoryId: 'c-games',
      place: 'Xbox Game Pass',
      paymentMode: 'Card',
      bigItem: true,
      note: 'Big item: paid once for the year',
    }),
  );

  // Three earlier months so comparisons, averages and trends have something to say.
  const r = rng(20261018);
  for (let m = 1; m <= 3; m++) {
    const p = shiftPeriod(current, -m, startDay);
    txs.push(tx(`m${m}-income`, p.start, { type: 'income', subtype: 'family', item: 'Monthly money from home', amountPaise: rupees(125_000), place: 'Family', paymentMode: 'Net banking' }));
    MONTH.forEach(([day, item, rupeesValue, categoryId, place, mode], i) => {
      // One-off purchases don't repeat every month; bills repeat at the same price.
      if (ONE_OFFS.has(item) || r() < 0.12) return;
      const scale = FIXED_PRICE.has(item) ? 1 : 0.7 + r() * 0.6 + (categoryId === 'c-eating-out' ? -0.15 * (m - 1) : 0);
      const date = addDays(p.start, Math.min(p.days - 1, Math.floor(((day - 1) / 17) * (p.days - 1) + r() * 3)));
      txs.push(
        tx(`m${m}-${i}`, date, {
          item,
          amountPaise: Math.round(rupees(rupeesValue) * scale),
          categoryId,
          place,
          paymentMode: mode ?? 'UPI',
        }),
      );
    });
    // Repeat stalls: daily tea habit.
    const visits = 6 + Math.floor(r() * 5);
    for (let v = 0; v < visits; v++) {
      const date = addDays(p.start, Math.floor(r() * p.days));
      txs.push(tx(`m${m}-tea-${v}`, date, { item: 'Tea & vada', amountPaise: rupees(20 + Math.floor(r() * 4) * 10), categoryId: 'c-tea', place: 'Ramana canteen' }));
    }
  }
  // Daily tea habit this month too.
  for (let v = 0; v < Math.min(8, dayCap); v++) {
    txs.push(tx(`m0-tea-${v}`, spread(1 + ((v * 5) % 17)), { item: 'Tea', amountPaise: rupees(20 + (v % 3) * 10), categoryId: 'c-tea', place: 'Ramana canteen' }));
  }

  // Splits: the group dinner (₹1,100 total, my share ₹223).
  const people: Person[] = [
    { id: `${SAMPLE_PREFIX}p-srinivas`, name: 'Srinivas S', aliases: ['srinivas s'] },
    { id: `${SAMPLE_PREFIX}p-karthik`, name: 'Karthik R', aliases: ['karthik r'] },
    { id: `${SAMPLE_PREFIX}p-divya`, name: 'Divya M', aliases: ['divya m'] },
    { id: `${SAMPLE_PREFIX}p-arun`, name: 'Arun K', aliases: ['arun k'] },
  ];
  const dinner = txs.find((t) => t.id === `${SAMPLE_PREFIX}m0-18`)!;
  const nextDay = addDays(dinner.date, 1);
  const payback = tx('m0-payback', nextDay <= today ? nextDay : dinner.date, {
    type: 'income',
    subtype: 'payback',
    item: 'Payback for dinner',
    amountPaise: rupees(220),
    place: 'Srinivas S',
    note: 'dinner',
  });
  txs.push(payback);
  const split: Split = {
    id: `${SAMPLE_PREFIX}split-dinner`,
    transactionId: dinner.id,
    totalPaise: rupees(1_100),
    myShareP: rupees(223),
    paidBy: 'me',
    shares: [
      { personId: people[0].id, sharePaise: rupees(220), settledByTransactionId: payback.id, settledAt: payback.date },
      { personId: people[1].id, sharePaise: rupees(219) },
      { personId: people[2].id, sharePaise: rupees(219) },
      { personId: people[3].id, sharePaise: rupees(219) },
    ],
  };
  dinner.splitId = split.id;

  const rules: Rule[] = [
    { id: `${SAMPLE_PREFIX}r-ramana`, matchText: normalisePlace('Ramana canteen'), categoryId: 'c-tea', item: 'Tea & vada', source: 'learned', hits: 12, createdAt: Date.now() },
    { id: `${SAMPLE_PREFIX}r-csa`, matchText: normalisePlace('CSA Automobile'), categoryId: 'c-travel', item: 'Petrol', source: 'learned', hits: 6, createdAt: Date.now() },
  ];

  const goals: Goal[] = [
    { id: `${SAMPLE_PREFIX}g-emergency`, name: 'Emergency fund', targetPaise: rupees(30_000), icon: 'shield', monthlyAllocationPaise: rupees(3_000), isEmergency: true, archived: false, celebrated: 25, createdAt: Date.now() },
    { id: `${SAMPLE_PREFIX}g-phone`, name: 'New phone', targetPaise: rupees(25_000), deadline: addDays(shiftPeriod(current, 5, startDay).start, 0), icon: 'phone', monthlyAllocationPaise: rupees(4_000), archived: false, celebrated: 25, createdAt: Date.now() },
  ];
  const buckets: Bucket[] = [
    { id: `${SAMPLE_PREFIX}b-rainy`, name: 'Rainy day', icon: 'umbrella', rule: 'leftover', ruleValue: 0, archived: false, order: 0 },
    { id: `${SAMPLE_PREFIX}b-festival`, name: 'Festival gifts', icon: 'gift', rule: 'fixed', ruleValue: rupees(1_000), targetPaise: rupees(5_000), archived: false, order: 1 },
    { id: `${SAMPLE_PREFIX}b-fees`, name: 'Fees', icon: 'grad', rule: 'percent', ruleValue: 500, targetPaise: rupees(40_000), archived: false, order: 2 },
  ];
  const contributions: Contribution[] = [];
  for (let m = 3; m >= 0; m--) {
    const p = shiftPeriod(current, -m, startDay);
    contributions.push(
      { id: `${SAMPLE_PREFIX}c-e-${m}`, potType: 'goal', potId: goals[0].id, date: p.start, amountPaise: rupees(2_500), source: 'auto' },
      { id: `${SAMPLE_PREFIX}c-p-${m}`, potType: 'goal', potId: goals[1].id, date: p.start, amountPaise: rupees(3_000), source: 'auto' },
      { id: `${SAMPLE_PREFIX}c-f-${m}`, potType: 'bucket', potId: buckets[1].id, date: p.start, amountPaise: rupees(1_000), source: 'auto' },
      { id: `${SAMPLE_PREFIX}c-s-${m}`, potType: 'bucket', potId: buckets[2].id, date: p.start, amountPaise: rupees(6_250), source: 'income-split' },
    );
    if (m > 0) contributions.push({ id: `${SAMPLE_PREFIX}c-r-${m}`, potType: 'bucket', potId: buckets[0].id, date: p.end, amountPaise: rupees(400 + m * 150), source: 'leftover' });
  }

  const [ny, nm] = parts(shiftPeriod(current, 1, startDay).start);
  const recurring: Recurring[] = [
    { id: `${SAMPLE_PREFIX}rec-airtel`, name: 'Airtel recharge', amountPaise: rupees(449), categoryId: 'c-phone', place: 'Airtel', paymentMode: 'UPI', frequency: 'monthly', nextDue: `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(15, daysInMonth(ny, nm))).padStart(2, '0')}`, mode: 'remind', active: true },
    { id: `${SAMPLE_PREFIX}rec-laundry`, name: 'Laundry', amountPaise: rupees(200), categoryId: 'c-laundry', place: 'Campus laundry', paymentMode: 'Cash', frequency: 'weekly', nextDue: addDays(today, 3), mode: 'remind', active: true },
  ];

  const budget: Budget = {
    id: current.start,
    isSample: true,
    mode: 'simple',
    incomePaise: rupees(125_000),
    totalLimitPaise: rupees(15_000),
    allocations: [
      ['c-eating-out', 900],
      ['c-tea', 450],
      ['c-snacks', 300],
      ['c-travel', 1_400],
      ['c-phone', 1_300],
      ['c-stationery', 300],
      ['c-medical', 800],
      ['c-shopping', 500],
      ['c-games', 8_000],
    ].map(([id, r]) => ({ targetType: 'category' as const, targetId: id as string, amountPaise: rupees(r as number), rollover: false })),
  };
  // Last month's budget, so rollover and comparisons have a predecessor.
  const prevBudget: Budget = { ...budget, id: shiftPeriod(current, -1, startDay).start };

  return { txs, people, split, rules, goals, buckets, contributions, recurring, budgets: [budget, prevBudget] };
}

export async function loadSample() {
  const { startDay } = { startDay: (await repo.settings.read()).monthStartDay };
  const s = buildSample(todayISO(), startDay);
  await repo.transaction(async () => {
    await repo.transactions.bulkPut(s.txs);
    await repo.people.bulkPut(s.people);
    await repo.splits.put(s.split);
    // Sample rules must not overwrite the user's own rules for the same place.
    const existing = new Set((await repo.rules.all()).map((r) => r.matchText));
    await repo.rules.bulkPut(s.rules.filter((r) => !existing.has(r.matchText)));
    await repo.goals.bulkPut(s.goals);
    await repo.buckets.bulkPut(s.buckets);
    await repo.contributions.bulkPut(s.contributions);
    await repo.recurring.bulkPut(s.recurring);
    const existingBudgets = new Set((await repo.budgets.all()).map((b) => b.id));
    await repo.budgets.bulkPut(s.budgets.filter((b) => !existingBudgets.has(b.id)));
    await repo.settings.patch({ sampleLoaded: true });
  });
}

/** Removes every sample record in one go. Sample budgets the user has edited are kept. */
export async function clearSample() {
  const tables = ['transactions', 'people', 'splits', 'rules', 'goals', 'buckets', 'contributions', 'recurring'] as const;
  await repo.transaction(async () => {
    for (const name of tables) {
      const keys = (await db.table(name).toCollection().primaryKeys()) as string[];
      await db.table(name).bulkDelete(keys.filter((k) => k.startsWith(SAMPLE_PREFIX)));
    }
    // Round-ups created from sample rows.
    const ru = (await db.contributions.toCollection().primaryKeys()) as string[];
    await db.contributions.bulkDelete(ru.filter((k) => k.startsWith(`ru-${SAMPLE_PREFIX}`)));
    const budgets = await repo.budgets.all();
    await repo.budgets.bulkRemove(budgets.filter((b) => b.isSample).map((b) => b.id));
    await repo.settings.patch({ sampleLoaded: false });
  });
}
