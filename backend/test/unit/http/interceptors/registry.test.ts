import { describe, expect, it } from 'vitest';
import { ApiInterceptorRegistry } from '../../../../src/http/interceptors/registry.js';

const noop = async (): Promise<void> => {};

describe('ApiInterceptorRegistry (feature 060 / T002)', () => {
  it('accepts pre and post registrations and lists them', () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'compliance',
      id: 'gate',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: noop,
    });
    registry.register({
      module: 'loyalty',
      id: 'enrich',
      target: 'GET /api/v1/orders/:id',
      phase: 'post',
      order: 100,
      handler: async () => undefined,
    });
    registry.seal();
    const items = registry.list();
    expect(items).toHaveLength(2);
    expect(items.map((i) => `${i.module}/${i.id}`)).toContain('compliance/gate');
    expect(items.map((i) => `${i.module}/${i.id}`)).toContain('loyalty/enrich');
  });

  it('rejects a duplicate (module, id) at call time', () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'loyalty',
      id: 'enrich',
      target: 'GET /api/v1/orders/:id',
      phase: 'post',
      handler: async () => undefined,
    });
    expect(() =>
      registry.register({
        module: 'loyalty',
        id: 'enrich',
        target: 'GET /api/v1/products/:id',
        phase: 'post',
        handler: async () => undefined,
      }),
    ).toThrow(/loyalty.*enrich/);
  });

  it('orders execution ascending by `order`, tie-broken by (module, id), independent of registration order', () => {
    const registry = new ApiInterceptorRegistry();
    const target = 'POST /api/v1/orders';
    // Registered deliberately out of the expected execution order.
    registry.register({ module: 'zeta', id: 'a', target, phase: 'pre', order: 0, handler: noop });
    registry.register({ module: 'alpha', id: 'z', target, phase: 'pre', order: 0, handler: noop });
    registry.register({ module: 'mid', id: 'later', target, phase: 'pre', order: 10, handler: noop });
    registry.register({ module: 'alpha', id: 'a', target, phase: 'pre', order: -5, handler: noop });
    registry.seal();
    const sequence = registry
      .preFor(target)
      .map((e) => `${e.module}/${e.id}`);
    expect(sequence).toEqual(['alpha/a', 'alpha/z', 'zeta/a', 'mid/later']);
  });

  it('normalizes a target array to one resolved entry per identity with uppercase method', () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'audit',
      id: 'multi',
      target: ['post /api/v1/orders', 'PUT /api/v1/orders/:id'],
      phase: 'pre',
      handler: noop,
    });
    registry.seal();
    expect(registry.preFor('POST /api/v1/orders')).toHaveLength(1);
    expect(registry.preFor('PUT /api/v1/orders/:id')).toHaveLength(1);
    expect(registry.preFor('post /api/v1/orders')).toHaveLength(0);
  });

  it('rejects a malformed target', () => {
    const registry = new ApiInterceptorRegistry();
    expect(() =>
      registry.register({
        module: 'audit',
        id: 'bad',
        target: '/api/v1/orders',
        phase: 'pre',
        handler: noop,
      }),
    ).toThrow(/target/i);
  });

  it('rejects registration after seal()', () => {
    const registry = new ApiInterceptorRegistry();
    registry.seal();
    expect(() =>
      registry.register({
        module: 'late',
        id: 'too-late',
        target: 'GET /api/v1/orders',
        phase: 'pre',
        handler: noop,
      }),
    ).toThrow(/seal/i);
  });

  it('exposes the injected isModuleEnabled predicate and defaults to enabled', () => {
    const withPredicate = new ApiInterceptorRegistry({
      isModuleEnabled: (id) => id === 'loyalty',
    });
    expect(withPredicate.isModuleEnabled('loyalty')).toBe(true);
    expect(withPredicate.isModuleEnabled('compliance')).toBe(false);
    const bare = new ApiInterceptorRegistry();
    expect(bare.isModuleEnabled('anything')).toBe(true);
  });

  it('list() presents entries in execution order (target, pre before post, then order)', () => {
    const registry = new ApiInterceptorRegistry();
    const target = 'GET /api/v1/orders/:id';
    registry.register({ module: 'b', id: 'post-one', target, phase: 'post', order: 1, handler: async () => undefined });
    registry.register({ module: 'a', id: 'pre-one', target, phase: 'pre', order: 5, handler: noop });
    registry.seal();
    const forTarget = registry.list().filter((i) => i.target === target);
    expect(forTarget.map((i) => i.phase)).toEqual(['pre', 'post']);
  });
});
