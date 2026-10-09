import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { demoContextWithin } from './reset-transaction.js';

describe("a module's demo context inside the reset's transaction (issue #143)", () => {
  const pooled = { name: 'pooled' } as unknown as EntityManager;
  const transactional = { name: 'transactional' } as unknown as EntityManager;
  const context = {
    module: { id: 'catalog', version: '1.0.0' },
    cradle: () => ({ emFactory: () => pooled, catalogService: 'the composed service' }),
  };

  it("answers the body's emFactory with the run's EntityManager", () => {
    const within = demoContextWithin(transactional, () => context)('catalog') as typeof context;
    expect(within.cradle().emFactory()).toBe(transactional);
  });

  it('leaves every other registration, and the rest of the context, as composed', () => {
    const within = demoContextWithin(transactional, () => context)('catalog') as typeof context;
    expect(within.cradle().catalogService).toBe('the composed service');
    expect(within.module).toBe(context.module);
  });

  it('does not change the context it was given', () => {
    demoContextWithin(transactional, () => context)('catalog');
    expect(context.cradle().emFactory()).toBe(pooled);
  });

  it('asks for the context of the module it was asked about', () => {
    const asked: string[] = [];
    demoContextWithin(transactional, (moduleId) => {
      asked.push(moduleId);
      return context;
    })('inventory');
    expect(asked).toEqual(['inventory']);
  });
});
