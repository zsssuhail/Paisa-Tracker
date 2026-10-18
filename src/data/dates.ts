import type { ISODate } from './types';

export const TIMEZONE = 'Asia/Kolkata';

const istParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in IST, regardless of device timezone. */
export function todayISO(): ISODate {
  return istParts.format(new Date());
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parts(iso: ISODate): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Pure calendar arithmetic in UTC so DST/timezones never shift dates. */
export function addDays(iso: ISODate, n: number): ISODate {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonths(iso: ISODate, n: number): ISODate {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function diffDays(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** 0 = Sunday. */
export function weekday(iso: ISODate): number {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface Period {
  /** Inclusive. */
  start: ISODate;
  /** Inclusive. */
  end: ISODate;
  days: number;
}

/** Day the period starts in a given month, clamped for short months (start day 31 → Feb 28). */
function startIn(y: number, m: number, startDay: number): ISODate {
  return toISO(y, m, Math.min(startDay, daysInMonth(y, m)));
}

/**
 * The budget month containing `date` for a month that starts on `startDay`
 * (e.g. pocket money arrives on the 5th → periods run 5th → 4th).
 */
export function periodFor(date: ISODate, startDay = 1): Period {
  const [y, m] = parts(date);
  let start = startIn(y, m, startDay);
  if (date < start) {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    start = startIn(py, pm, startDay);
  }
  const [sy, sm] = parts(start);
  const ny = sm === 12 ? sy + 1 : sy;
  const nm = sm === 12 ? 1 : sm + 1;
  const end = addDays(startIn(ny, nm, startDay), -1);
  return { start, end, days: diffDays(end, start) + 1 };
}

export function shiftPeriod(p: Period, n: number, startDay = 1): Period {
  const [y, m] = parts(p.start);
  const total = y * 12 + (m - 1) + n;
  return periodFor(startIn(Math.floor(total / 12), (total % 12) + 1, startDay), startDay);
}

/** Days remaining in the period including `today`. */
export function daysLeft(p: Period, today: ISODate): number {
  if (today > p.end) return 0;
  if (today < p.start) return p.days;
  return diffDays(p.end, today) + 1;
}

export function daysElapsed(p: Period, today: ISODate): number {
  if (today < p.start) return 0;
  if (today > p.end) return p.days;
  return diffDays(today, p.start) + 1;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDay(iso: ISODate, today = todayISO()): string {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = parts(iso);
  const [ty] = parts(today);
  return `${WEEKDAYS[weekday(iso)]}, ${d} ${MONTHS[m - 1]}${y !== ty ? ` ${y}` : ''}`;
}

export function formatShort(iso: ISODate): string {
  const [, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

export function formatLong(iso: ISODate): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "October" for a calendar-aligned period, "5 Oct – 4 Nov" otherwise. */
export function periodLabel(p: Period): string {
  const [y, m, d] = parts(p.start);
  if (d === 1) return `${MONTHS_LONG[m - 1]} ${y}`;
  return `${formatShort(p.start)} – ${formatShort(p.end)}`;
}

export function monthShort(iso: ISODate): string {
  return MONTHS[parts(iso)[1] - 1];
}

export function isoWeekStart(iso: ISODate): ISODate {
  const wd = (weekday(iso) + 6) % 7; // Monday = 0
  return addDays(iso, -wd);
}
