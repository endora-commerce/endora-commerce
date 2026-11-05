import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type PatchProductScopesRequest } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CatalogBulkUpdateService, scopedStatusPatch, type BulkScopedStatusWriter } from './catalog-bulk-update.service.js';
import type { CatalogAdminService } from './catalog-admin.service.js';

/**
 * Feature 163, Phase 10 (T074, FR-050, FR-051) — bulk scoped status: the request a
 * product's scope write is translated into, and the per-product outcome each answer of
 * the scope write maps to. The database half is
 * `backend/test/contract/catalog/products-bulk-scoped-status.test.ts` [PG].
 */

const C = '11111111-2222-4333-8444-555555555555';
const P1 = '21111111-2222-4333-8444-555555555555';
const P2 = '31111111-2222-4333-8444-555555555555';

describe('scopedStatusPatch', () => {
  it('a channel scope writes the channel row status', () => {
    expect(scopedStatusPatch({ channelId: C, languageCode: null, value: 'inactive' })).toEqual({
      channels: [{ channelId: C, status: 'inactive' }],
    });
  });

  it('a channel × language scope writes one language status', () => {
    expect(scopedStatusPatch({ channelId: C, languageCode: 'de-DE', value: 'active' })).toEqual({
      channels: [{ channelId: C, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }],
    });
  });

  it('inherit removes the override at that scope, in the write encoding (FR-012, FR-116)', () => {
    expect(scopedStatusPatch({ channelId: C, languageCode: null, value: 'inherit' })).toEqual({
      channels: [{ channelId: C, status: { inherit: true } }],
    });
    expect(scopedStatusPatch({ channelId: C, languageCode: 'pl-PL', value: 'inherit' })).toEqual({
      channels: [{ channelId: C, languageStatuses: [{ languageCode: 'pl-PL', status: { inherit: true } }] }],
    });
  });
});

describe('CatalogBulkUpdateService — fields.scopedStatus', () => {
  function service(write: BulkScopedStatusWriter['writeStatus']): {
    svc: CatalogBulkUpdateService;
    calls: Array<{ productId: string; request: PatchProductScopesRequest }>;
  } {
    const calls: Array<{ productId: string; request: PatchProductScopesRequest }> = [];
    const em = { findOne: async (_entity: unknown, where: { id: string }) => ({ id: where.id, attributeSetId: 'set' }) };
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      { completenessMode: async () => 'warn' } as unknown as CatalogAdminService,
      undefined,
      undefined,
      {
        writeStatus: async (productId, request, options) => {
          calls.push({ productId, request });
          return write(productId, request, options);
        },
      },
    );
    return { svc, calls };
  }

  it('writes the one scope per product and reports changedFields [scopedStatus]', async () => {
    const { svc, calls } = service(async () => ({ changedFields: ['scopedStatus'], warnings: [] }));
    const result = await svc.bulkUpdate({
      productIds: [P1, P2],
      fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'inactive' } },
    });
    expect(calls.map((call) => call.productId)).toEqual([P1, P2]);
    expect(calls[0]!.request).toEqual({
      channels: [{ channelId: C, languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }] }],
    });
    expect(result.results).toEqual([
      { productId: P1, status: 'succeeded', changedFields: ['scopedStatus'] },
      { productId: P2, status: 'succeeded', changedFields: ['scopedStatus'] },
    ]);
  });

  it('a product already holding the value succeeds with changedFields []', async () => {
    const { svc } = service(async () => ({ changedFields: [], warnings: [] }));
    const result = await svc.bulkUpdate({
      productIds: [P1],
      fields: { scopedStatus: { channelId: C, languageCode: null, value: 'active' } },
    });
    expect(result.results).toEqual([{ productId: P1, status: 'succeeded', changedFields: [] }]);
  });

  it.each([
    ['not_a_member', { channelId: C, reason: 'not_a_member' }],
    ['language_not_offered', { channelId: C, languageCode: 'de-DE', reason: 'language_not_offered' }],
  ])('a product the scope does not fit (%s) is skipped as scope_invalid, never added (FR-051)', async (_name, details) => {
    const { svc } = service(async () => {
      throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', details);
    });
    const result = await svc.bulkUpdate({
      productIds: [P1],
      fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'active' } },
    });
    expect(result.results).toEqual([
      {
        productId: P1,
        status: 'skipped',
        reason: 'scope_invalid',
        details: { code: ERROR_CODES.SCOPE_INVALID, message: 'The product is not a member of this sales channel.' },
      },
    ]);
    expect(result.summary).toEqual({ succeeded: 0, skipped: 1, failed: 0, total: 1 });
  });

  it('a concurrent write on the product reports concurrent_modification', async () => {
    const { svc } = service(async () => {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'changed by another request');
    });
    const result = await svc.bulkUpdate({
      productIds: [P1],
      fields: { scopedStatus: { channelId: C, languageCode: null, value: 'inactive' } },
    });
    expect(result.results[0]).toMatchObject({ status: 'failed', reason: 'concurrent_modification' });
  });

  it('without a scope writer the request fails per product rather than silently doing nothing', async () => {
    const em = { findOne: async (_entity: unknown, where: { id: string }) => ({ id: where.id, attributeSetId: 'set' }) };
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      { completenessMode: async () => undefined } as unknown as CatalogAdminService,
    );
    const result = await svc.bulkUpdate({
      productIds: [P1],
      fields: { scopedStatus: { channelId: C, languageCode: null, value: 'inactive' } },
    });
    expect(result.results[0]).toMatchObject({ status: 'failed', reason: 'validation_failed' });
  });
});

describe('CatalogBulkUpdateService — the completeness gate (FR-061, US6 #4)', () => {
  const em = { findOne: async (_entity: unknown, where: { id: string }) => ({ id: where.id, attributeSetId: 'set' }) };
  const incomplete = (): HttpError =>
    new HttpError(422, ERROR_CODES.SCOPE_INCOMPLETE, 'missing', {
      pairs: [{ channelId: C, languageCode: 'de-DE', missing: ['name'] }],
    });

  it('reads the mode once per run and passes it to every scope write', async () => {
    let reads = 0;
    const modes: unknown[] = [];
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      {
        completenessMode: async () => {
          reads += 1;
          return 'refuse';
        },
      } as unknown as CatalogAdminService,
      undefined,
      undefined,
      {
        writeStatus: async (_id, _request, options) => {
          modes.push(options?.completeness);
          return { changedFields: ['scopedStatus'], warnings: [] };
        },
      },
    );
    await svc.bulkUpdate({
      productIds: [P1, P2],
      fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'active' } },
    });
    expect(reads).toBe(1);
    expect(modes).toEqual(['refuse', 'refuse']);
  });

  it('refuse: a failing product is skipped as completeness_gate, the passing one changes', async () => {
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      { completenessMode: async () => 'refuse' } as unknown as CatalogAdminService,
      undefined,
      undefined,
      {
        writeStatus: async (id) => {
          if (id === P1) throw incomplete();
          return { changedFields: ['scopedStatus'], warnings: [] };
        },
      },
    );
    const result = await svc.bulkUpdate({
      productIds: [P1, P2],
      fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'active' } },
    });
    expect(result.results).toEqual([
      {
        productId: P1,
        status: 'skipped',
        reason: 'completeness_gate',
        details: { code: ERROR_CODES.SCOPE_INCOMPLETE, message: 'missing' },
      },
      { productId: P2, status: 'succeeded', changedFields: ['scopedStatus'] },
    ]);
  });

  it('warn: the product succeeds and its result carries details.code SCOPE_INCOMPLETE', async () => {
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      { completenessMode: async () => 'warn' } as unknown as CatalogAdminService,
      undefined,
      undefined,
      {
        writeStatus: async () => ({
          changedFields: ['scopedStatus'],
          warnings: [{ kind: 'completeness', channelId: C, languageCode: 'de-DE', missing: ['name'] }],
        }),
      },
    );
    const result = await svc.bulkUpdate({
      productIds: [P1],
      fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value: 'active' } },
    });
    expect(result.results).toEqual([
      { productId: P1, status: 'succeeded', changedFields: ['scopedStatus'], details: { code: ERROR_CODES.SCOPE_INCOMPLETE } },
    ]);
  });

  it('a bulk global status runs the gate through the product update, with the mode read once', async () => {
    let reads = 0;
    const gates: unknown[] = [];
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      {
        completenessMode: async () => {
          reads += 1;
          return 'refuse';
        },
        updateProduct: async (id: string, _req: unknown, _ctx: unknown, gate: { completeness?: string }) => {
          gates.push(gate?.completeness);
          if (id === P1) throw incomplete();
          return {};
        },
      } as unknown as CatalogAdminService,
    );
    const result = await svc.bulkUpdate({ productIds: [P1, P2], fields: { status: 'active' } });
    expect(reads).toBe(1);
    expect(gates).toEqual(['refuse', 'refuse']);
    expect(result.results[0]).toMatchObject({ productId: P1, status: 'skipped', reason: 'completeness_gate' });
    expect(result.results[1]).toMatchObject({ productId: P2, status: 'succeeded', changedFields: ['status'] });
  });

  it('a bulk edit touching no status reads no mode', async () => {
    let reads = 0;
    const svc = new CatalogBulkUpdateService(
      () => em as unknown as EntityManager,
      {
        completenessMode: async () => {
          reads += 1;
          return 'refuse';
        },
        updateProduct: async () => ({}),
      } as unknown as CatalogAdminService,
    );
    await svc.bulkUpdate({ productIds: [P1], fields: { visibility: 'public' } });
    expect(reads).toBe(0);
  });
});
