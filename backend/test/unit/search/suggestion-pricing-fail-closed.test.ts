import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  createSuggestionPricingEnricher,
  type SuggestionPriceResolverPort,
} from '../../../src/modules/search/services/suggestion-pricing-enricher.js';

/**
 * The typeahead's pricing tolerance stops at the presence answer (issue #84).
 *
 * The enricher deliberately degrades a hit to its plain summary when the
 * pricing engine refuses it — a popup that 500s because one product has an
 * unresolvable bracket is worse than a popup without a price on it. That is a
 * real decision and it stays.
 *
 * What it must not absorb is `ModuleDisabledError`. A buyer reading a suggest
 * popup with no prices on it does not conclude "`price_lists` is switched
 * off"; they conclude the shop shows no prices, which for a B2B catalogue is
 * indistinguishable from "ask for a quote". The caller has to see the 503.
 */

const PRODUCT = { id: 'p1' } as never;

function fakeEm(): EntityManager {
  return {
    findOne: async () => null,
    find: async () => [PRODUCT],
  } as unknown as EntityManager;
}

const CTX = {
  organizationId: null,
  resolvedChannel: { id: 'ch1', defaultCurrency: 'PLN' },
} as never;

const ITEMS = [{ id: 'p1', name: 'Widget', slug: 'widget' }] as never;

function enricherWith(resolveEngine: SuggestionPriceResolverPort['resolveEngine']) {
  return createSuggestionPricingEnricher({ emFactory: fakeEm, pricingService: { resolveEngine } });
}

describe('suggestion pricing enricher', () => {
  it('degrades a hit to the plain summary when the pricing engine refuses it', async () => {
    const enrich = enricherWith(async () => {
      throw new Error('no bracket for this quantity');
    });
    const out = await enrich(ITEMS, CTX);
    expect(out).toHaveLength(1);
    expect(out[0]?.basePrice).toBeUndefined();
  });

  it('propagates ModuleDisabledError instead of showing a priceless suggestion', async () => {
    const enrich = enricherWith(async () => {
      throw new ModuleDisabledError('price_lists');
    });
    let thrown: unknown;
    try {
      await enrich(ITEMS, CTX);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ModuleDisabledError);
    expect((thrown as ModuleDisabledError).statusCode).toBe(503);
    expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
  });
});
