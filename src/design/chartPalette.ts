/**
 * Validated categorical palette (dataviz validator: all checks pass in light on #FFFFFF
 * and dark on #18181B; light slots 3/4/5 are under 3:1 so every chart ships labels + table view).
 * Values live in tokens.css so dark mode swaps automatically.
 */
export const SERIES_SLOTS = 8;

export function seriesVar(slot: number): string {
  if (slot <= 0) return 'var(--series-other)';
  return `var(--series-${((slot - 1) % SERIES_SLOTS) + 1})`;
}

export const OTHER_COLOUR = 'var(--series-other)';

/** Sequential single-hue ramp (Ledger Green), for heatmaps. Index 0 = no spend. */
export function sequentialAccent(t: number): string {
  if (t <= 0) return 'rgb(var(--shelf))';
  const alpha = 0.18 + Math.min(1, t) * 0.82;
  return `rgb(var(--accent) / ${alpha.toFixed(2)})`;
}
