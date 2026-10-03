import { describe, expect, it } from 'vitest';
import {
  AdminBlockContributionSchema,
  type AdminBlockContribution,
  type AdminContributions,
} from '@endora-commerce/contracts';

/**
 * `specs/141-module-block-renderers/contracts/block-renderers.md` §4 — the data
 * half of an editor renderer a module's `./admin` layer contributes.
 *
 * The schema is what a generator or a check validates without evaluating the
 * module's UI; the factory is typed and not parsed, as every other admin
 * contribution's is.
 */
describe('AdminBlockContributionSchema', () => {
  it('accepts a namespaced block for the cms and the email editor', () => {
    for (const context of ['cms', 'email'] as const) {
      const parsed = AdminBlockContributionSchema.safeParse({ name: 'crm.Badge', context });
      expect(parsed.success, context).toBe(true);
    }
  });

  it('refuses a name that is not <module>.<Name>', () => {
    for (const name of ['Badge', 'crm.badge', 'Crm.Badge', 'crm.', 'crm.Badge.Extra', '']) {
      expect(AdminBlockContributionSchema.safeParse({ name, context: 'cms' }).success, name).toBe(
        false,
      );
    }
  });

  it('refuses the contexts that have no editor renderer of their own', () => {
    // `invoice` is out of scope (spec Non-goals); `newsletter` is admitted by
    // the `email` context and has no renderer set of its own (FR-002).
    for (const context of ['invoice', 'newsletter', 'storefront', '']) {
      expect(
        AdminBlockContributionSchema.safeParse({ name: 'crm.Badge', context }).success,
        context,
      ).toBe(false);
    }
  });

  it('is additive: contributions without blocks, and with them, both type-check', () => {
    const without: AdminContributions = { routes: [], nav: [], zones: [] };
    const block: AdminBlockContribution = {
      name: 'crm.Badge',
      context: 'cms',
      component: () => Promise.resolve({ default: {} }),
    };
    const withBlocks: AdminContributions = { blocks: [block] };
    expect(without.blocks).toBeUndefined();
    expect(withBlocks.blocks).toHaveLength(1);
  });
});
