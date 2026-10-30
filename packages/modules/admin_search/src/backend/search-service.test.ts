import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProvider, AdminSearchProviderQuery } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { AdminSearchProviderRegistry } from './provider-registry.js';
import { AdminSearchService, type AdminSearchSettingsSnapshot } from './search-service.js';

/** A provider descriptor for unit tests; `search` answers nothing unless overridden. */
function fakeProvider(over: Partial<AdminSearchProvider> = {}): AdminSearchProvider {
  return {
    entityType: 'orders.order',
    moduleId: 'orders',
    labelKey: 'adminSearch.group.label',
    icon: 'Receipt',
    requiredPermission: 'orders:read',
    weight: 100,
    fields: [
      { code: 'number', labelKey: 'adminSearch.field.number', defaultSelected: true, identifier: true },
      {
        code: 'organizationName',
        labelKey: 'adminSearch.field.organizationName',
        defaultSelected: true,
        identifier: false,
      },
      {
        code: 'billingTaxId',
        labelKey: 'adminSearch.field.billingTaxId',
        defaultSelected: false,
        identifier: true,
      },
    ],
    search: async () => ({ hits: [], hasMore: false }),
    ...over,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ALL_PERMISSIONS = ['orders:read', 'crm:read', 'catalog:read'];

function settings(over: Partial<AdminSearchSettingsSnapshot> = {}): AdminSearchSettingsSnapshot {
  return {
    minimumQueryLength: 3,
    resultsPerEntity: 5,
    stored: { version: 1, entities: {} },
    ...over,
  };
}

function build(
  providers: AdminSearchProvider[],
  opts: {
    snapshot?: AdminSearchSettingsSnapshot;
    permissions?: string[];
    deadlineMs?: number;
  } = {},
) {
  const registry = new AdminSearchProviderRegistry();
  for (const p of providers) registry.register(p);
  const logger = { warn: vi.fn(), error: vi.fn() };
  const translate = vi.fn(async (moduleId: string, key: string, language: string) => `${language}:${moduleId}.${key}`);
  const service = new AdminSearchService({
    registry,
    permissions: { listPermissions: async () => opts.permissions ?? ALL_PERMISSIONS },
    i18n: { translate },
    settings: { read: async () => opts.snapshot ?? settings() },
    logger,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  });
  return { service, logger, translate };
}

const request = { language: 'en' as const, adminUserId: 'admin-1', requestId: 'req-1' };

function hit(id: string) {
  return { id, title: id, subtitle: null, status: null, targetRoute: `/orders/${id}` };
}

describe('AdminSearchService.search', () => {
  it('runs no provider below the minimum length', async () => {
    const search = vi.fn(async () => ({ hits: [hit('a')], hasMore: false }));
    const { service } = build([fakeProvider({ search })]);
    const result = await service.search({ ...request, q: '  ab  ' });
    expect(search).not.toHaveBeenCalled();
    expect(result.data).toEqual({ query: 'ab', groups: [] });
    expect(result.meta).toMatchObject({ belowMinimumLength: true, minimumQueryLength: 3 });
  });

  it('runs providers concurrently', async () => {
    const slow = (entityType: string, moduleId: string) =>
      fakeProvider({
        entityType,
        moduleId,
        requiredPermission: 'orders:read',
        search: async () => {
          await sleep(200);
          return { hits: [hit(entityType)], hasMore: false };
        },
      });
    const { service } = build([slow('orders.order', 'orders'), slow('crm.opportunity', 'crm')]);
    const started = Date.now();
    const result = await service.search({ ...request, q: 'acme' });
    expect(Date.now() - started).toBeLessThan(350);
    expect(result.data.groups).toHaveLength(2);
  });

  it('isolates a late and a throwing provider; the others are ok', async () => {
    const { service, logger } = build(
      [
        fakeProvider({ search: async () => ({ hits: [hit('o1')], hasMore: true }) }),
        fakeProvider({
          entityType: 'crm.opportunity',
          moduleId: 'crm',
          requiredPermission: 'crm:read',
          weight: 300,
          search: async () => {
            await sleep(200);
            return { hits: [hit('late')], hasMore: false };
          },
        }),
        fakeProvider({
          entityType: 'catalog.product',
          moduleId: 'catalog',
          requiredPermission: 'catalog:read',
          weight: 600,
          search: async () => {
            throw new Error('relation does not exist');
          },
        }),
      ],
      { deadlineMs: 50 },
    );
    const result = await service.search({ ...request, q: 'secret-text' });
    expect(result.data.groups.map((g) => [g.entityType, g.status, g.hits.length, g.hasMore])).toEqual([
      ['orders.order', 'ok', 1, true],
      ['crm.opportunity', 'timed_out', 0, false],
      ['catalog.product', 'failed', 0, false],
    ]);
    // FR-017 — the failure is logged with the request id, and the text is not.
    expect(logger.warn).toHaveBeenCalled();
    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls]);
    expect(logged).toContain('req-1');
    expect(logged).not.toContain('secret-text');
  });

  it('aborts the late provider’s signal', async () => {
    let seen: AdminSearchProviderQuery | undefined;
    const { service } = build(
      [
        fakeProvider({
          search: async (query) => {
            seen = query;
            await sleep(100);
            return { hits: [], hasMore: false };
          },
        }),
      ],
      { deadlineMs: 20 },
    );
    await service.search({ ...request, q: 'acme' });
    expect(seen?.signal.aborted).toBe(true);
  });

  it('re-throws a ModuleDisabledError rather than reporting it as a failed group', async () => {
    const { service } = build([
      fakeProvider({
        search: async () => {
          throw new ModuleDisabledError('organizations');
        },
      }),
    ]);
    await expect(service.search({ ...request, q: 'acme' })).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('omits groups with no hits', async () => {
    const { service } = build([
      fakeProvider(),
      fakeProvider({
        entityType: 'crm.opportunity',
        moduleId: 'crm',
        requiredPermission: 'crm:read',
        search: async () => ({ hits: [hit('c1')], hasMore: false }),
      }),
    ]);
    const result = await service.search({ ...request, q: 'acme' });
    expect(result.data.groups.map((g) => g.entityType)).toEqual(['crm.opportunity']);
  });

  it('narrows to the requested entity types, silently skipping unknown ones', async () => {
    const orders = vi.fn(async () => ({ hits: [hit('o')], hasMore: false }));
    const crm = vi.fn(async () => ({ hits: [hit('c')], hasMore: false }));
    const { service } = build([
      fakeProvider({ search: orders }),
      fakeProvider({ entityType: 'crm.opportunity', moduleId: 'crm', requiredPermission: 'crm:read', search: crm }),
    ]);
    const result = await service.search({ ...request, q: 'acme', entityTypes: ['crm.opportunity', 'x.y'] });
    expect(orders).not.toHaveBeenCalled();
    expect(result.data.groups.map((g) => g.entityType)).toEqual(['crm.opportunity']);
  });

  it('defaults the limit to the setting and clamps it to 25', async () => {
    const search = vi.fn(async (_input: unknown) => ({ hits: [], hasMore: false }));
    const { service } = build([fakeProvider({ search })], { snapshot: settings({ resultsPerEntity: 7 }) });
    const first = await service.search({ ...request, q: 'acme' });
    expect(search.mock.calls[0]?.[0]).toMatchObject({ limit: 7 });
    expect(first.meta.limit).toBe(7);
    const second = await service.search({ ...request, q: 'acme', limit: 99 });
    expect(search.mock.calls[1]?.[0]).toMatchObject({ limit: 25 });
    expect(second.meta.limit).toBe(25);
  });

  it('does not call a type disabled by configuration, and passes the resolved fields', async () => {
    const orders = vi.fn(async (_input: unknown) => ({ hits: [], hasMore: false }));
    const crm = vi.fn(async () => ({ hits: [], hasMore: false }));
    const { service } = build(
      [
        fakeProvider({ search: orders }),
        fakeProvider({ entityType: 'crm.opportunity', moduleId: 'crm', requiredPermission: 'crm:read', search: crm }),
      ],
      {
        snapshot: settings({
          stored: {
            version: 1,
            entities: {
              'orders.order': { enabled: true, fields: ['billingTaxId'] },
              'crm.opportunity': { enabled: false, fields: ['number'] },
            },
          },
        }),
      },
    );
    await service.search({ ...request, q: 'a%_b' });
    expect(crm).not.toHaveBeenCalled();
    expect(orders.mock.calls[0]?.[0]).toMatchObject({
      text: 'a%_b',
      likeEscaped: 'a\\%\\_b',
      isUuid: false,
      fields: ['billingTaxId'],
      language: 'en',
      adminUserId: 'admin-1',
    });
  });

  it('skips a provider whose permission the caller lacks', async () => {
    const crm = vi.fn(async () => ({ hits: [hit('c')], hasMore: false }));
    const { service } = build(
      [fakeProvider({ entityType: 'crm.opportunity', moduleId: 'crm', requiredPermission: 'crm:read', search: crm })],
      { permissions: ['orders:read'] },
    );
    const result = await service.search({ ...request, q: 'acme' });
    expect(crm).not.toHaveBeenCalled();
    expect(result.data.groups).toEqual([]);
  });

  it('resolves group labels through the translate port in the request language', async () => {
    const { service, translate } = build([
      fakeProvider({ search: async () => ({ hits: [hit('o')], hasMore: false }) }),
    ]);
    const result = await service.search({ ...request, language: 'pl', q: 'acme' });
    expect(translate).toHaveBeenCalledWith('orders', 'adminSearch.group.label', 'pl');
    expect(result.data.groups[0]?.label).toBe('pl:orders.adminSearch.group.label');
  });

  it('drops a provider hit beyond the limit and one with an unsafe target route', async () => {
    const { service } = build([
      fakeProvider({
        search: async () => ({
          hits: [hit('a'), { ...hit('b'), targetRoute: 'https://evil.example' }, hit('c')],
          hasMore: false,
        }),
      }),
    ], { snapshot: settings({ resultsPerEntity: 1 }) });
    const result = await service.search({ ...request, q: 'acme' });
    expect(result.data.groups[0]?.hits.map((h) => h.id)).toEqual(['a']);
    expect(result.data.groups[0]?.hasMore).toBe(true);
  });
});

describe('AdminSearchService.capability', () => {
  it('lists present, permitted and enabled types with labels', async () => {
    const { service } = build(
      [
        fakeProvider(),
        fakeProvider({ entityType: 'crm.opportunity', moduleId: 'crm', requiredPermission: 'crm:read', icon: 'CircleDollarSign' }),
        fakeProvider({ entityType: 'catalog.product', moduleId: 'catalog', requiredPermission: 'catalog:read', icon: 'Package' }),
      ],
      {
        permissions: ['orders:read', 'catalog:read'],
        snapshot: settings({
          minimumQueryLength: 4,
          resultsPerEntity: 6,
          stored: { version: 1, entities: { 'catalog.product': { enabled: false, fields: ['number'] } } },
        }),
      },
    );
    const capability = await service.capability(request);
    expect(capability).toEqual({
      minimumQueryLength: 4,
      resultsPerEntity: 6,
      entityTypes: [{ entityType: 'orders.order', label: 'en:orders.adminSearch.group.label', icon: 'Receipt' }],
    });
  });
});
