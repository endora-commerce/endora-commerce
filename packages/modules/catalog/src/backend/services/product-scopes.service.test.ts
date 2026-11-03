import { describe, expect, it } from 'vitest';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES, type ProductChannelScopeRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Product } from '../entities/product.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import {
  writeScopedStatus,
  nonMemberOrganizationIds,
  planProductScopeWrite,
  ProductScopesService,
  type ProductScopeWriteState,
} from './product-scopes.service.js';

/**
 * Feature 163, Phase 4 (T021) — the decision core of `ProductScopesService.apply`:
 * what a `PATCH /admin/catalog/products/:id/scopes` writes, what it refuses, and the
 * audit projection it records (`contracts/admin-scopes-api.md` §2; FR-012–FR-015,
 * FR-030, FR-080, C4).
 *
 * `planProductScopeWrite` is pure: it takes the product's current scope rows and its
 * member channels, and answers the rows to upsert or delete. The service runs it
 * inside the Command's transaction, so a refusal here is a refusal of the whole
 * request with nothing written.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const GONE = '00000000-0000-4000-8000-0000000000c9';
const ORG_A = '00000000-0000-4000-8000-0000000000e1';
const ORG_B = '00000000-0000-4000-8000-0000000000e2';

function state(over: Partial<ProductScopeWriteState> = {}): ProductScopeWriteState {
  return {
    productId: P,
    productType: 'simple',
    globalWindow: { from: null, until: null },
    channelRows: [],
    languageRows: [],
    memberChannels: new Map([
      [B2B, ['pl-PL', 'de-DE']],
      [B2C, ['pl-PL', 'en-GB']],
    ]),
    ...over,
  };
}

function row(over: Partial<ProductChannelScopeRecord> = {}): ProductChannelScopeRecord {
  return {
    productId: P,
    channelId: B2B,
    status: null,
    window: null,
    audience: null,
    minOrderQuantityOverridden: false,
    minOrderQuantity: null,
    returnable: null,
    ...over,
  };
}

function refusal(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error('expected a refusal');
}

describe('planProductScopeWrite — upsert and inherit (FR-012)', () => {
  it('a channel status creates the channel row', () => {
    const plan = planProductScopeWrite(state(), { channels: [{ channelId: B2B, status: 'inactive' }] });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ status: 'inactive' }) }]);
    expect(plan.changedFields).toEqual(['scopedStatus']);
  });

  it('an absent key leaves the stored value untouched', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'inactive', returnable: false })] }), {
      channels: [{ channelId: B2B, minOrderQuantity: 5 }],
    });
    expect(plan.channelRows).toEqual([
      { channelId: B2B, next: row({ status: 'inactive', returnable: false, minOrderQuantityOverridden: true, minOrderQuantity: 5 }) },
    ]);
    expect(plan.changedFields).toEqual(['orderRules']);
  });

  it('null removes one override and keeps the others', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'inactive', returnable: false })] }), {
      channels: [{ channelId: B2B, status: { inherit: true } }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ returnable: false }) }]);
  });

  it('a row whose every field inherits is deleted, never stored empty', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'inactive' })] }), {
      channels: [{ channelId: B2B, status: { inherit: true } }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: null }]);
  });

  it('a language status upserts and null deletes the C×L row', () => {
    const plan = planProductScopeWrite(
      state({ languageRows: [{ productId: P, channelId: B2B, languageCode: 'pl-PL', status: 'inactive' }] }),
      {
        channels: [
          {
            channelId: B2B,
            languageStatuses: [
              { languageCode: 'de-DE', status: 'active' },
              { languageCode: 'pl-PL', status: { inherit: true } },
            ],
          },
        ],
      },
    );
    expect(plan.languageRows).toEqual([
      { channelId: B2B, languageCode: 'de-DE', next: 'active' },
      { channelId: B2B, languageCode: 'pl-PL', next: null },
    ]);
    expect(plan.channelRows).toEqual([]);
    expect(plan.changedFields).toEqual(['scopedStatus']);
  });

  it('a language is matched case-insensitively and stored in the channel spelling', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-de', status: 'active' }] }],
    });
    expect(plan.languageRows).toEqual([{ channelId: B2B, languageCode: 'de-DE', next: 'active' }]);
  });

  it('writing the value already stored changes nothing', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'inactive' })] }), {
      channels: [{ channelId: B2B, status: 'inactive' }],
    });
    expect(plan.changedFields).toEqual([]);
  });

  it('a window, an audience and order rules each name their own changed field', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [
        {
          channelId: B2B,
          window: { from: '2026-12-01T00:00:00.000Z', until: null },
          audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
          returnable: true,
        },
      ],
    });
    expect([...plan.changedFields].sort()).toEqual(['audience', 'orderRules', 'publicationWindow']);
    expect(plan.channelRows[0]?.next).toEqual(
      row({
        window: { from: new Date('2026-12-01T00:00:00.000Z'), until: null },
        audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
        returnable: true,
      }),
    );
  });

  it('an overridden fully-open window is stored as an override, not as inherit', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, window: { from: null, until: null } }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ window: { from: null, until: null } }) }]);
  });
});

describe('planProductScopeWrite — the global window, and FR-013', () => {
  it('a global window change never touches an override', () => {
    const current = state({ channelRows: [row({ status: 'inactive' })] });
    const plan = planProductScopeWrite(current, {
      channels: [],
      global: { publishFrom: '2026-12-01T00:00:00.000Z' },
    });
    expect(plan.channelRows).toEqual([]);
    expect(plan.languageRows).toEqual([]);
    expect(plan.globalWindow).toEqual({ from: new Date('2026-12-01T00:00:00.000Z'), until: null });
    expect(plan.changedFields).toEqual(['publicationWindow']);
  });

  it('a partial global window keeps the other bound', () => {
    const plan = planProductScopeWrite(
      state({ globalWindow: { from: new Date('2026-12-01T00:00:00.000Z'), until: null } }),
      { channels: [], global: { publishUntil: '2026-12-31T00:00:00.000Z' } },
    );
    expect(plan.globalWindow).toEqual({
      from: new Date('2026-12-01T00:00:00.000Z'),
      until: new Date('2026-12-31T00:00:00.000Z'),
    });
  });
});

describe('planProductScopeWrite — refusals (FR-014) and their one exception (FR-015)', () => {
  it('a value for a channel the product is not a member of is SCOPE_INVALID not_a_member', () => {
    const err = refusal(() => planProductScopeWrite(state(), { channels: [{ channelId: GONE, status: 'active' }] }));
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
  });

  it('a language status in a non-member channel is not_a_member too', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [{ channelId: GONE, languageStatuses: [{ languageCode: 'pl-PL', status: 'active' }] }],
      }),
    );
    expect(err.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
  });

  it('a language the channel does not offer is SCOPE_INVALID language_not_offered, naming it', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr-FR', status: 'active' }] }],
      }),
    );
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' });
  });

  it('removing an orphaned channel row is always allowed', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ channelId: GONE, status: 'inactive' })] }), {
      channels: [{ channelId: GONE, status: { inherit: true } }],
    });
    expect(plan.channelRows).toEqual([{ channelId: GONE, next: null }]);
  });

  it('removing an orphaned language row is always allowed', () => {
    const current = state({
      languageRows: [{ productId: P, channelId: B2B, languageCode: 'fr-FR', status: 'active' }],
    });
    const plan = planProductScopeWrite(current, {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr-FR', status: { inherit: true } }] }],
    });
    expect(plan.languageRows).toEqual([{ channelId: B2B, languageCode: 'fr-FR', next: null }]);
  });

  it('a channel window whose start is not before its end is VALIDATION_FAILED, field window', () => {
    for (const until of ['2026-12-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z']) {
      const err = refusal(() =>
        planProductScopeWrite(state(), {
          channels: [{ channelId: B2B, window: { from: '2026-12-01T00:00:00.000Z', until } }],
        }),
      );
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(err.details).toMatchObject({ field: 'window', channelId: B2B });
    }
  });

  it('a global window whose start is not before its end is VALIDATION_FAILED, field window', () => {
    const err = refusal(() =>
      planProductScopeWrite(state({ globalWindow: { from: null, until: new Date('2026-12-01T00:00:00.000Z') } }), {
        channels: [],
        global: { publishFrom: '2026-12-02T00:00:00.000Z' },
      }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toEqual({ field: 'window' });
  });

  it('a minimum on a product type that takes none is VALIDATION_FAILED, field minOrderQuantity', () => {
    const err = refusal(() =>
      planProductScopeWrite(state({ productType: 'bundle' }), { channels: [{ channelId: B2B, minOrderQuantity: 5 }] }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toMatchObject({ field: 'minOrderQuantity' });
  });

  it('the same channel named twice is VALIDATION_FAILED, field channels', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [
          { channelId: B2B, status: 'inactive' },
          { channelId: B2B, status: 'active' },
        ],
      }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toMatchObject({ field: 'channels' });
  });

  it('the same language named twice in one channel, in any letter case, is VALIDATION_FAILED, field languageStatuses', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [
          {
            channelId: B2B,
            languageStatuses: [
              { languageCode: 'de-DE', status: 'inactive' },
              { languageCode: 'de-de', status: 'active' },
            ],
          },
        ],
      }),
    );
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toEqual({ field: 'languageStatuses', channelId: B2B, languageCode: 'de-DE' });
  });

  it('the same language in two different channels is not a duplicate', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [
        { channelId: B2B, languageStatuses: [{ languageCode: 'pl-PL', status: 'inactive' }] },
        { channelId: B2C, languageStatuses: [{ languageCode: 'pl-PL', status: 'active' }] },
      ],
    });
    expect(plan.languageRows).toHaveLength(2);
  });
});

describe('planProductScopeWrite — audience (C4)', () => {
  it('the override replaces the whole rule; null inherits the whole rule', () => {
    const current = state({
      channelRows: [row({ audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A] } })],
    });
    const replaced = planProductScopeWrite(current, {
      channels: [
        { channelId: B2B, audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_B] } },
      ],
    });
    expect(replaced.channelRows[0]?.next?.audience).toEqual({
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_B],
    });
    const inherited = planProductScopeWrite(current, { channels: [{ channelId: B2B, audience: { inherit: true } }] });
    expect(inherited.channelRows).toEqual([{ channelId: B2B, next: null }]);
  });

  it('nonMemberOrganizationIds names the organizations the channel does not offer', async () => {
    const membership = {
      filterEntityIdsAvailableInChannel: async (channelId: string, entityType: string, ids: readonly string[]) => {
        expect(channelId).toBe(B2B);
        expect(entityType).toBe('organization');
        return ids.filter((id) => id === ORG_A);
      },
    };
    expect(await nonMemberOrganizationIds(membership, B2B, [ORG_A, ORG_B])).toEqual([ORG_B]);
    expect(await nonMemberOrganizationIds(membership, B2B, [])).toEqual([]);
  });
});

describe('planProductScopeWrite — the audit projection (FR-080, Q-D → A)', () => {
  it('before and after hold every touched row completely, in the request shape', () => {
    const current = state({
      channelRows: [row({ status: 'inactive', returnable: false })],
      languageRows: [{ productId: P, channelId: B2B, languageCode: 'de-DE', status: 'inactive' }],
      globalWindow: { from: null, until: new Date('2027-01-01T00:00:00.000Z') },
    });
    const plan = planProductScopeWrite(current, {
      channels: [
        { channelId: B2B, status: 'active', languageStatuses: [{ languageCode: 'de-DE', status: { inherit: true } }] },
        { channelId: B2C, minOrderQuantity: 3 },
      ],
      global: { publishFrom: '2026-12-01T00:00:00.000Z' },
    });
    const I = { inherit: true };
    expect(plan.before).toEqual({
      channels: [
        {
          channelId: B2B,
          status: 'inactive',
          window: I,
          audience: I,
          minOrderQuantity: I,
          returnable: false,
          languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }],
        },
        { channelId: B2C, status: I, window: I, audience: I, minOrderQuantity: I, returnable: I, languageStatuses: [] },
      ],
      global: { publishFrom: null, publishUntil: '2027-01-01T00:00:00.000Z' },
    });
    expect(plan.after).toEqual({
      channels: [
        {
          channelId: B2B,
          status: 'active',
          window: I,
          audience: I,
          minOrderQuantity: I,
          returnable: false,
          languageStatuses: [{ languageCode: 'de-DE', status: I }],
        },
        { channelId: B2C, status: I, window: I, audience: I, minOrderQuantity: 3, returnable: I, languageStatuses: [] },
      ],
      global: { publishFrom: '2026-12-01T00:00:00.000Z', publishUntil: '2027-01-01T00:00:00.000Z' },
    });
  });

  it('re-applying before restores the rows the write replaced', () => {
    const current = state({ channelRows: [row({ status: 'inactive', returnable: false })] });
    const forward = planProductScopeWrite(current, { channels: [{ channelId: B2B, status: 'active', returnable: { inherit: true } }] });
    const afterState = state({
      channelRows: forward.channelRows.flatMap((r) => (r.next ? [r.next] : [])),
    });
    const back = planProductScopeWrite(afterState, forward.before as never);
    expect(back.channelRows).toEqual([{ channelId: B2B, next: row({ status: 'inactive', returnable: false }) }]);
  });

  it('a channel touched only through its languages records only the language rows', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }],
    });
    expect(plan.before).toEqual({
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-DE', status: { inherit: true } }] }],
    });
  });
});

describe('ProductScopesService.apply — concurrent writes (security review, 163 Block A)', () => {
  function rig(flush: () => Promise<void> = async () => {}) {
    const reads: Array<{ entity: unknown; lockMode: LockMode | undefined }> = [];
    const product = {
      id: P,
      type: 'simple',
      status: 'inactive',
      publishFrom: null,
      publishUntil: null,
      visibility: 'public',
      allowedOrganizationIds: [],
      minOrderQuantity: null,
      returnable: true,
    };
    const em = {
      findOne: async (entity: unknown, _where: unknown, options?: { lockMode?: LockMode }) => {
        reads.push({ entity, lockMode: options?.lockMode });
        return product;
      },
      find: async () => [],
      // Feature 170 (R7) — the scope_version bump, the write's first statement.
      execute: async () => [{ v: '1' }],
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: () => undefined,
      remove: () => undefined,
      flush,
      transactional: async (fn: (tx: unknown) => Promise<unknown>) => fn(em),
    };
    const membership = {
      listChannelsForEntity: async () => [{ id: B2B, code: 'b2b', languages: ['pl-PL', 'de-DE'] }],
      filterEntityIdsAvailableInChannel: async () => [],
    };
    return { service: new ProductScopesService(() => em as never, membership as never), reads };
  }

  it('reads the product under a write lock inside the write, so before is the true predecessor', async () => {
    const { service, reads } = rig();
    await service.apply(P, { channels: [{ channelId: B2B, status: 'active' }] });
    expect(reads[0]).toEqual({ entity: Product, lockMode: LockMode.PESSIMISTIC_WRITE });
    // The response read after the commit takes no lock.
    expect(reads.slice(1).every((read) => read.lockMode === undefined)).toBe(true);
  });

  it('a residual unique violation is 409 VERSION_CONFLICT, never a 500', async () => {
    const { service } = rig(async () => {
      throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'));
    });
    const err = await service.apply(P, { channels: [{ channelId: B2B, status: 'active' }] }).then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(409);
    expect((err as HttpError).code).toBe(ERROR_CODES.VERSION_CONFLICT);
  });
});

// Owner decision U1 — the answer names the organizations its rules name, so the admin
// needs no `customers:read` to show them; an unreadable one is simply absent.
describe('ProductScopesService.read — organization names (U1)', () => {
  const ORG_GONE = '00000000-0000-4000-8000-0000000000e9';
  function rig(organizations?: { findByIds: (ids: readonly string[]) => Promise<Array<{ id: string; name: string }>> }) {
    const product = {
      id: P,
      type: 'simple',
      status: 'active',
      publishFrom: null,
      publishUntil: null,
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_A],
      minOrderQuantity: null,
      returnable: true,
    };
    const channelRow = {
      productId: P,
      salesChannelId: B2B,
      status: null,
      windowOverridden: false,
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_B, ORG_GONE, ORG_A],
      minOrderQuantity: null,
      returnable: null,
    };
    const em = {
      findOne: async () => product,
      find: async (entity: unknown) => (entity === ProductChannelScope ? [channelRow] : []),
    };
    const membership = {
      listChannelsForEntity: async () => [{ id: B2B, code: 'b2b', languages: ['pl-PL'] }],
      filterEntityIdsAvailableInChannel: async () => [ORG_A],
    };
    return new ProductScopesService(() => em as never, membership as never, undefined, organizations as never);
  }

  it('names every organization the channel rules name, once; an unknown one is absent; the global rule is not named', async () => {
    const asked: string[][] = [];
    const service = rig({
      findByIds: async (ids) => {
        asked.push([...ids]);
        return [
          { id: ORG_A, name: 'Acme' },
          { id: ORG_B, name: 'Westfield Ltd' },
        ].filter((org) => ids.includes(org.id));
      },
    });
    const scopes = await service.read(P);
    // ORG_A is also the global rule's; it is named because the channel rule names it.
    expect(asked).toEqual([[ORG_B, ORG_GONE, ORG_A]]);
    expect(scopes.organizations).toEqual([
      { id: ORG_B, name: 'Westfield Ltd' },
      { id: ORG_A, name: 'Acme' },
    ]);
    expect(scopes.channels[0]?.audience?.nonMemberOrganizationIds).toEqual([ORG_B, ORG_GONE]);
  });

  it('answers without names, never an error, when the organizations port refuses or is not wired', async () => {
    const failing = rig({
      findByIds: async () => {
        throw new HttpError(503, ERROR_CODES.MODULE_DISABLED, 'organizations is off');
      },
    });
    expect((await failing.read(P)).organizations).toEqual([]);
    expect((await rig().read(P)).organizations).toEqual([]);
  });
});

/**
 * Final QA Q-M5 (FR-013, A-9) — a change of the product's **global** audience or order
 * rules (written by the product update, not by this service) neither alters nor removes
 * a channel override, and raises no warning: the scopes read answers the same channel
 * entries, and the C4 non-member warning is computed from the channel rule alone, never
 * from the global one. A global window change through this service likewise leaves
 * every override as it was.
 */
describe('ProductScopesService.read — a global change leaves the overrides alone (FR-013, A-9)', () => {
  const channelRow = {
    productId: P,
    salesChannelId: B2B,
    status: 'inactive',
    windowOverridden: false,
    visibility: 'organization_restricted',
    allowedOrganizationIds: [ORG_A],
    minOrderQuantity: 3,
    returnable: false,
  };
  function rig(global: { visibility: string; allowedOrganizationIds: string[]; minOrderQuantity: number | null; returnable: boolean }) {
    const product = { id: P, type: 'simple', status: 'active', publishFrom: null, publishUntil: null, ...global };
    const em = {
      findOne: async () => product,
      find: async (entity: unknown) => (entity === ProductChannelScope ? [{ ...channelRow }] : []),
    };
    const membership = {
      listChannelsForEntity: async () => [{ id: B2B, code: 'b2b', languages: ['pl-PL'] }],
      // ORG_A is offered the channel; ORG_B is not.
      filterEntityIdsAvailableInChannel: async (_c: string, _k: string, ids: readonly string[]) =>
        ids.filter((id) => id === ORG_A),
    };
    return new ProductScopesService(() => em as never, membership as never);
  }

  it('answers the same channel overrides, with no warning, whatever the global audience and order rules', async () => {
    const before = await rig({ visibility: 'public', allowedOrganizationIds: [], minOrderQuantity: null, returnable: true }).read(P);
    // The global rule now names an organization the channel does not offer, and the
    // global order rules moved.
    const after = await rig({
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_B],
      minOrderQuantity: 10,
      returnable: false,
    }).read(P);
    expect(after.global).toMatchObject({ allowedOrganizationIds: [ORG_B], minOrderQuantity: 10, returnable: false });
    expect(after.channels).toEqual(before.channels);
    expect(after.channels[0]).toMatchObject({
      status: 'inactive',
      audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A], nonMemberOrganizationIds: [] },
      minOrderQuantity: 3,
      returnable: false,
    });
  });

  it('a global window change writes no channel row, whatever overrides the channel holds', () => {
    const current = state({
      channelRows: [
        row({
          status: 'inactive',
          window: { from: new Date('2026-11-01T00:00:00.000Z'), until: null },
          audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A] },
          minOrderQuantity: 3,
          returnable: false,
        }),
      ],
    });
    const plan = planProductScopeWrite(current, { channels: [], global: { publishUntil: '2027-01-01T00:00:00.000Z' } });
    expect(plan.channelRows).toEqual([]);
    expect(plan.languageRows).toEqual([]);
    expect(plan.changedFields).toEqual(['publicationWindow']);
  });
});

describe('writeScopedStatus — the one write of a scope row (checkpoint C code review, C-W3)', () => {
  const P = 'p-1';
  const C = 'c-1';
  function fakeEm() {
    const removed: unknown[] = [];
    const persisted: unknown[] = [];
    const em = {
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: (row: unknown) => void persisted.push(row),
      remove: (row: unknown) => void removed.push(row),
    };
    return { em: em as never, removed, persisted };
  }
  const channelRow = (over: Partial<Record<string, unknown>> = {}) =>
    ({ productId: P, salesChannelId: C, status: null, windowOverridden: false, publishFrom: null, publishUntil: null, visibility: null, allowedOrganizationIds: null, minOrderQuantityOverridden: false, minOrderQuantity: null, returnable: null, ...over }) as never;

  it('creates a channel row for a status and answers that it changed', () => {
    const { em, persisted } = fakeEm();
    const rows = { channelRows: [], languageRows: [] };
    expect(writeScopedStatus(em, rows, P, { channelId: C, languageCode: null }, 'inactive')).toBe(true);
    expect(rows.channelRows).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ productId: P, salesChannelId: C, status: 'inactive' });
  });

  it('deletes a channel row left inheriting everything, keeps one with another override', () => {
    const lone = fakeEm();
    const loneRows = { channelRows: [channelRow({ status: 'inactive' })], languageRows: [] };
    writeScopedStatus(lone.em, loneRows, P, { channelId: C, languageCode: null }, null);
    expect(lone.removed).toHaveLength(1);
    expect(loneRows.channelRows).toHaveLength(0);

    const kept = fakeEm();
    const keptRows = {
      channelRows: [channelRow({ status: 'inactive', minOrderQuantityOverridden: true, minOrderQuantity: 5 })],
      languageRows: [],
    };
    writeScopedStatus(kept.em, keptRows, P, { channelId: C, languageCode: null }, null);
    expect(kept.removed).toHaveLength(0);
    expect(keptRows.channelRows[0]).toMatchObject({ status: null, minOrderQuantity: 5 });
  });

  it('matches a language row case-insensitively, and answers false when nothing changes', () => {
    const { em, removed } = fakeEm();
    const rows = { channelRows: [], languageRows: [{ productId: P, salesChannelId: C, languageCode: 'de-DE', status: 'active' }] as never[] };
    expect(writeScopedStatus(em, rows, P, { channelId: C, languageCode: 'de-de' }, 'active')).toBe(false);
    expect(writeScopedStatus(em, rows, P, { channelId: C, languageCode: 'de-de' }, null)).toBe(true);
    expect(removed).toHaveLength(1);
  });
});
