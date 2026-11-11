/**
 * Categorical palette (validated with the dataviz validator, light surface #fcfcfb):
 * fixed slot order, assigned to the SORTED category list of the full dataset so colour follows
 * the entity, never its rank in a filtered view. Marker symbols provide secondary encoding
 * because scatter plots exceed the three-slot all-pairs limit.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up', 'x', 'triangle-down', 'star', 'cross'];
export const OTHER = '#8a8f98';

export function categoryStyle(all: string[]): Map<string, { color: string; symbol: string }> {
  const sorted = [...new Set(all)].sort();
  const m = new Map<string, { color: string; symbol: string }>();
  sorted.forEach((v, i) => m.set(v, i < SERIES.length ? { color: SERIES[i], symbol: SYMBOLS[i] } : { color: OTHER, symbol: 'circle-open' }));
  return m;
}

export const STATUS_COLOR = {
  accepted: '#0d9488',
  rejected: '#b45309',
  not_available: '#94a3b8',
  ambiguous: '#7c3aed',
} as const;
