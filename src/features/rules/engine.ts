import type { Paise, Rule, Transaction } from '@/data/types';

export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  categoryId: string | null;
  item?: string;
  confidence: Confidence;
  /** Plain-English reason shown in the review screen. */
  reason: string;
  /** Large payments are flagged for review instead of guessed. */
  needsReview: boolean;
}

export function normalisePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keyword hints for common Indian merchants. Order matters: first hit wins. */
const KEYWORDS: [RegExp, string, string?][] = [
  [/\b(swiggy|zomato|eatsure|dominos|domino s|pizza|kfc|mcdonald|burger|biryani|mess|hotel|restaurant|dhaba|cafe|caterers?|cate|mandi|momos|shawarma|shawarmar|dosa|parotta|vilas|muniyandi|kitchen|eatery|jigarthanda)\b/, 'c-eating-out'],
  [/\b(tea|chai|vada|vadai|canteen|bakery|bakes?|bake|coffee|falooda|bajji|baji|snacks)\b/, 'c-tea'],
  [/\b(fruit|fruits|juice|juices|juic|sugarcane|fresh j|tender coconut)\b/, 'c-fruits'],
  [/\b(petrol|fuel|automobile|indian oil|iocl|bpcl|hpcl|hp petrol|bharat petroleum|shell)\b/, 'c-travel', 'Petrol'],
  [/\b(uber|ola|rapido|redbus|setc|tnstc|irctc|metro|bus|railway|namma yatri)\b/, 'c-travel'],
  [/\b(airtel|jio|vodafone|vi prepaid|bsnl|recharge)\b/, 'c-phone', 'Mobile recharge'],
  [/\b(pharmacy|pharma|medical|medicals|medica|apollo|medplus|clinic|hospital|lens|lenskart|optical|opticals|netmeds|1mg|pharmeasy|diagnostics?|scans?)\b/, 'c-medical'],
  [/\b(flipkart|amazon|myntra|meesho|ajio|nykaa)\b/, 'c-shopping'],
  [/\b(xerox|xe|stationery|stationers|book|books|print|printers|printouts|penguin)\b/, 'c-stationery'],
  [/\b(laundry|dhobi|wash|dry clean)\b/, 'c-laundry'],
  [/\b(salon|saloon|barber|parlour|parlor)\b/, 'c-personal'],
  [/\b(supermarket|mart|bigbasket|blinkit|zepto|instamart|dmart|grocery|provision|stores)\b/, 'c-groceries'],
  [/\b(steam|playstation|xbox|netflix|spotify|hotstar|prime video|youtube|google play|google one|google|game pass|icloud|apple)\b/, 'c-games'],
  [/\b(rto|parivahan|licence|license)\b/, 'c-licence'],
  [/\b(bookmyshow|big tree|bigtree|ticket|tickets|event|events|concert|museum|cinemas?|theatre)\b/, 'c-events'],
];

const BUSINESS_WORDS =
  /\b(store|stores|shop|mart|medical|medicals|automobile|bhavan|bhavanam|canteen|enterprises|traders|pvt|ltd|limited|hotel|cafe|bakery|agency|agencies|services|centre|center|restaurant|mess|pharmacy|petroleum|fuels|&|co)\b/;

/** A payee that looks like a person (no business words, 1–3 words, no digits). */
export function looksLikePerson(place: string): boolean {
  const n = normalisePlace(place);
  if (!n || /\d/.test(n) || BUSINESS_WORDS.test(n)) return false;
  if (KEYWORDS.some(([re]) => re.test(n))) return false;
  // Initials ("S A Vishnu Var") don't count towards the length of a name.
  const words = n.split(' ').filter((w) => w.length > 1);
  return words.length >= 1 && words.length <= 3;
}

const BIG_PAYMENT: Paise = 100_000; // ₹1,000

export function findRule(place: string, rules: Rule[]): Rule | undefined {
  const n = normalisePlace(place);
  if (!n) return undefined;
  return rules.find((r) => r.matchText === n) ?? rules.find((r) => r.matchText.length >= 4 && n.includes(r.matchText));
}

/** Most common category previously used for this place. */
export function historyFor(place: string, history: Transaction[]): { categoryId: string; item: string; count: number } | null {
  const n = normalisePlace(place);
  if (!n) return null;
  const counts = new Map<string, { count: number; item: string }>();
  for (const t of history) {
    if (t.type !== 'expense' || !t.categoryId || normalisePlace(t.place) !== n) continue;
    const c = counts.get(t.categoryId) ?? { count: 0, item: t.item };
    c.count++;
    counts.set(t.categoryId, c);
  }
  let best: { categoryId: string; item: string; count: number } | null = null;
  for (const [categoryId, { count, item }] of counts) {
    if (!best || count > best.count) best = { categoryId, item, count };
  }
  return best;
}

/**
 * Smart first guess, in priority order:
 * learned rule → my history at this place → merchant keywords → rules of thumb by size.
 */
export function suggestCategory(
  input: { place: string; item?: string; amountPaise: Paise },
  rules: Rule[],
  history: Transaction[],
): Suggestion {
  const rule = findRule(input.place, rules);
  if (rule) {
    return { categoryId: rule.categoryId, item: rule.item, confidence: 'high', reason: 'You told me this place', needsReview: false };
  }
  const past = historyFor(input.place, history);
  if (past) {
    return {
      categoryId: past.categoryId,
      item: past.item || undefined,
      confidence: past.count >= 2 ? 'high' : 'medium',
      reason: `Same as last time at ${input.place}`,
      needsReview: false,
    };
  }
  const text = normalisePlace(`${input.place} ${input.item ?? ''}`);
  for (const [re, categoryId, item] of KEYWORDS) {
    if (re.test(text)) {
      return { categoryId, item, confidence: 'medium', reason: 'Matched the name', needsReview: input.amountPaise >= BIG_PAYMENT };
    }
  }
  if (input.amountPaise >= BIG_PAYMENT) {
    return { categoryId: null, confidence: 'low', reason: '₹1,000 or more — please check', needsReview: true };
  }
  if (looksLikePerson(input.place) || !input.place) {
    if (input.amountPaise < 6_000) {
      return { categoryId: 'c-tea', confidence: 'low', reason: 'Small payment, usually a stall', needsReview: false };
    }
    if (input.amountPaise <= 25_000) {
      return { categoryId: 'c-eating-out', confidence: 'low', reason: '₹60–250, usually a meal', needsReview: false };
    }
  }
  return { categoryId: null, confidence: 'low', reason: 'New place', needsReview: true };
}
