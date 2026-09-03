import { describe, expect, it } from 'vitest';

import { contextAdmits } from './define-component.js';
import type { PageBuilderContext } from './types/responsive.js';

/**
 * `contextAdmits` is the one implementation of *"does a block declared for these
 * contexts appear in this palette"* (feature 096, D-10).
 *
 * The rule was written twice in `define-component.ts` before this extraction —
 * once positively in `filterConfigByContext`, once negated in
 * `getDisallowedComponentNames` — and T305's derived palette would have been the
 * third. These tests are the extraction's proof rather than its description: the
 * first case enumerates the whole domain against **both** original spellings, so
 * a future edit that changes the rule fails here rather than in whichever of the
 * three callers a reader happens to run.
 */
const CONTEXTS: readonly PageBuilderContext[] = ['cms', 'email', 'invoice', 'newsletter'];

function subsets<T>(xs: readonly T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);
}

describe('contextAdmits', () => {
  it('agrees with both spellings it replaced, over every subset and context', () => {
    // The two originals, transcribed verbatim from the code they replaced.
    const positive = (declared: PageBuilderContext[], target: PageBuilderContext): boolean =>
      declared.includes(target) || (target === 'newsletter' && declared.includes('email'));
    const negated = (declared: PageBuilderContext[], target: PageBuilderContext): boolean =>
      target === 'newsletter'
        ? !(!declared.includes('email') && !declared.includes('newsletter'))
        : !!declared.includes(target);

    const divergences: string[] = [];
    for (const declared of subsets(CONTEXTS)) {
      for (const target of CONTEXTS) {
        const got = contextAdmits(declared, target);
        if (got !== positive(declared, target) || got !== negated(declared, target)) {
          divergences.push(`[${declared.join(',')}] -> ${target}`);
        }
      }
    }
    expect(divergences).toEqual([]);
  });

  it('admits an e-mail block into the newsletter palette, which is the whole rule', () => {
    expect(contextAdmits(['email'], 'newsletter')).toBe(true);
  });

  it('does not admit a newsletter block into the e-mail palette — the admission is one-way', () => {
    expect(contextAdmits(['newsletter'], 'email')).toBe(false);
  });

  it('admits nothing across the other three, so the rule cannot silently widen', () => {
    expect(contextAdmits(['cms'], 'email')).toBe(false);
    expect(contextAdmits(['email'], 'cms')).toBe(false);
    expect(contextAdmits(['invoice'], 'cms')).toBe(false);
    expect(contextAdmits(['cms'], 'invoice')).toBe(false);
  });

  it('admits a block declaring the target outright, including newsletter', () => {
    for (const c of CONTEXTS) expect(contextAdmits([c], c)).toBe(true);
  });

  it('declares nothing, admits nothing', () => {
    for (const c of CONTEXTS) expect(contextAdmits([], c)).toBe(false);
  });
});
