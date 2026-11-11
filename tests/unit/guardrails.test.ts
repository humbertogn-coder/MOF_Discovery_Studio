import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { G } from '../../src/lib/guardrails';

const md = readFileSync(new URL('../../docs/SCIENCE_GUARDRAILS.md', import.meta.url), 'utf8');

describe('SCIENCE_GUARDRAILS.md', () => {
  for (const [k, v] of Object.entries(G)) {
    it(`quotes "${k}" verbatim`, () => expect(md.includes(v)).toBe(true));
  }
  it('never uses forbidden phrasings in UI text', () => {
    const all = Object.values(G).join(' ').toLowerCase();
    expect(all).not.toMatch(/95% confidence interval|is conductive|proves|guarantee/);
  });
});
