import { describe, expect, it } from 'vitest';
import {
  bulkUpdateProductResultSchema,
  bulkUpdateProductsRequestSchema,
  updateProductRequestSchema,
} from './catalog.js';
import {
  patchProductScopesRequestSchema,
  productScopesResponseSchema,
  scopeIncompleteDetailsSchema,
  scopeInvalidDetailsSchema,
  scopeMissingValueSchema,
  scopeOverviewResponseSchema,
  scopeWarningSchema,
} from './product-scopes.js';

/**
 * Feature 163 — the admin shapes of `contracts/admin-scopes-api.md` §1–§4 and the
 * additive edits to `catalog.ts` (T007, T010).
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const C = '00000000-0000-4000-8000-0000000000c1';
const ORG = '00000000-0000-4000-8000-0000000000e1';

describe('patchProductScopesRequestSchema', () => {
  it('168 write encoding: absent = untouched, {inherit:true} = use inherited, null = empty', () => {
    const parsed = patchProductScopesRequestSchema.parse({
      channels: [{ channelId: C, status: { inherit: true }, minOrderQuantity: null, returnable: '' }],
    });
    const [row] = parsed.channels;
    expect(row).toBeDefined();
    expect(row!.status).toEqual({ inherit: true });
    expect(row!.window).toBeUndefined();
    expect(row!.audience).toBeUndefined();
    expect(row!.returnable).toBeUndefined();
    expect(row!.minOrderQuantity).toBeNull();
  });

  it('refuses {inherit:false} and unknown keys inside a window', () => {
    expect(patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, status: { inherit: false } }] }).success).toBe(false);
    expect(
      patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, window: { from: null, until: null, x: 1 } }] }).success,
    ).toBe(false);
  });

  it('accepts every scoped field', () => {
    const parsed = patchProductScopesRequestSchema.safeParse({
      channels: [
        {
          channelId: C,
          status: 'active',
          window: { from: '2026-12-01T00:00:00.000Z', until: null },
          audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG] },
          minOrderQuantity: 1,
          returnable: false,
          languageStatuses: [
            { languageCode: 'de-DE', status: 'inactive' },
            { languageCode: 'pl-PL', status: { inherit: true } },
          ],
        },
      ],
      global: { publishFrom: '2026-12-01T00:00:00.000Z', publishUntil: null },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a global window alone and an empty channel list', () => {
    expect(patchProductScopesRequestSchema.safeParse({ channels: [], global: { publishUntil: null } }).success).toBe(
      true,
    );
  });

  it('does NOT refuse from >= until — the service answers VALIDATION_FAILED with details.field = window', () => {
    const parsed = patchProductScopesRequestSchema.safeParse({
      channels: [{ channelId: C, window: { from: '2026-12-31T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' } }],
    });
    expect(parsed.success).toBe(true);
  });

  it.each([0, 1_000_001, 1.5, -1])('refuses minOrderQuantity %s (1…1 000 000)', (value) => {
    expect(
      patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, minOrderQuantity: value }] }).success,
    ).toBe(false);
  });

  it.each([1, 1_000_000, null])('accepts minOrderQuantity %s', (value) => {
    expect(
      patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, minOrderQuantity: value }] }).success,
    ).toBe(true);
  });

  it('refuses an unknown status, a non-uuid channel and more than 64 channels', () => {
    for (const status of ['archived', 'draft']) {
      expect(patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, status }] }).success).toBe(false);
      expect(
        patchProductScopesRequestSchema.safeParse({
          channels: [{ channelId: C, languageStatuses: [{ languageCode: 'de-DE', status }] }],
        }).success,
      ).toBe(false);
    }
    expect(patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: 'b2b' }] }).success).toBe(false);
    const many = Array.from({ length: 65 }, () => ({ channelId: C }));
    expect(patchProductScopesRequestSchema.safeParse({ channels: many }).success).toBe(false);
  });

  it('refuses a window bound that is not an ISO instant', () => {
    expect(
      patchProductScopesRequestSchema.safeParse({ channels: [{ channelId: C, window: { from: '2026-12-01', until: null } }] })
        .success,
    ).toBe(false);
  });

  it('caps an audience at 1000 organizations', () => {
    const parse = (n: number) =>
      patchProductScopesRequestSchema.safeParse({
        channels: [
          {
            channelId: C,
            audience: {
              visibility: 'organization_restricted',
              allowedOrganizationIds: Array.from({ length: n }, () => ORG),
            },
          },
        ],
      }).success;
    expect(parse(1000)).toBe(true);
    expect(parse(1001)).toBe(false);
  });

  it('caps one channel at 64 language statuses', () => {
    const parse = (n: number) =>
      patchProductScopesRequestSchema.safeParse({
        channels: [
          { channelId: C, languageStatuses: Array.from({ length: n }, () => ({ languageCode: 'pl-PL', status: 'active' })) },
        ],
      }).success;
    expect(parse(64)).toBe(true);
    expect(parse(65)).toBe(false);
  });

  it('takes a language code in the BCP-47 shape, in any letter case', () => {
    const parse = (languageCode: string) =>
      patchProductScopesRequestSchema.safeParse({
        channels: [{ channelId: C, languageStatuses: [{ languageCode, status: 'active' }] }],
      }).success;
    for (const ok of ['pl', 'pl-PL', 'de-de', 'fil-PH']) expect(parse(ok), ok).toBe(true);
    for (const bad of ['', 'p', 'pl_PL', 'pl-PL-x', 'pl-PL; drop', 'x'.repeat(17)]) expect(parse(bad), bad).toBe(false);
  });
});

describe('productScopesResponseSchema', () => {
  it('parses the §1 shape', () => {
    const parsed = productScopesResponseSchema.safeParse({
      data: {
        global: {
          status: 'active',
          publishFrom: null,
          publishUntil: '2026-12-31T23:59:59.999Z',
          visibility: 'public',
          allowedOrganizationIds: [],
          minOrderQuantity: null,
          returnable: true,
        },
        channels: [
          {
            channelId: C,
            isMember: true,
            languages: ['pl-PL', 'de-DE'],
            status: 'inactive',
            window: null,
            audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG], nonMemberOrganizationIds: [ORG] },
            minOrderQuantityOverridden: true,
            minOrderQuantity: null,
            returnable: null,
            languageStatuses: [{ languageCode: 'fr-FR', status: 'active', orphaned: true }],
            orphaned: false,
          },
        ],
        organizations: [{ id: ORG, name: 'Westfield Ltd' }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  // Owner decision U1 — the names of the organizations the audience rules name travel
  // with the answer, so an operator without `customers:read` still reads who they are.
  it('carries the named organizations as { id, name }, required, never a bare id list', () => {
    const base = productScopesResponseSchema.parse({
      data: {
        global: {
          status: 'active',
          publishFrom: null,
          publishUntil: null,
          visibility: 'organization_restricted',
          allowedOrganizationIds: [ORG],
          minOrderQuantity: null,
          returnable: true,
        },
        channels: [],
        organizations: [{ id: ORG, name: 'Westfield Ltd' }],
      },
    });
    expect(base.data.organizations).toEqual([{ id: ORG, name: 'Westfield Ltd' }]);
    const { organizations: _omitted, ...withoutNames } = base.data;
    expect(productScopesResponseSchema.safeParse({ data: withoutNames }).success).toBe(false);
    expect(
      productScopesResponseSchema.safeParse({ data: { ...base.data, organizations: [{ id: 'not-a-uuid', name: 'X' }] } }).success,
    ).toBe(false);
  });
});

describe('scopeMissingValueSchema — one vocabulary for warning, refusal and overview', () => {
  it.each(['name', 'urlKey', 'attribute:color'])('accepts %s', (value) => {
    expect(scopeMissingValueSchema.safeParse(value).success).toBe(true);
  });

  it.each(['sku', 'attribute:', 'Name', ''])('refuses %s', (value) => {
    expect(scopeMissingValueSchema.safeParse(value).success).toBe(false);
  });

  it('is what ScopeWarning and SCOPE_INCOMPLETE carry', () => {
    expect(
      scopeWarningSchema.safeParse({ kind: 'completeness', channelId: C, languageCode: 'de-DE', missing: ['sku'] }).success,
    ).toBe(false);
    expect(
      scopeWarningSchema.safeParse({ kind: 'completeness', channelId: C, languageCode: 'de-DE', missing: ['name'] })
        .success,
    ).toBe(true);
    expect(
      scopeWarningSchema.safeParse({ kind: 'audience_non_members', channelId: C, organizationIds: [ORG] }).success,
    ).toBe(true);
    expect(
      scopeIncompleteDetailsSchema.safeParse({ pairs: [{ channelId: C, languageCode: 'de-DE', missing: ['urlKey'] }] })
        .success,
    ).toBe(true);
    expect(
      scopeIncompleteDetailsSchema.safeParse({ pairs: [{ channelId: C, languageCode: 'de-DE', missing: ['sku'] }] })
        .success,
    ).toBe(false);
  });
});

describe('scopeInvalidDetailsSchema', () => {
  it('names the channel, the reason and, for a language, the language', () => {
    expect(scopeInvalidDetailsSchema.safeParse({ channelId: C, reason: 'not_a_member' }).success).toBe(true);
    expect(
      scopeInvalidDetailsSchema.safeParse({ channelId: C, languageCode: 'fr-FR', reason: 'language_not_offered' }).success,
    ).toBe(true);
    expect(scopeInvalidDetailsSchema.safeParse({ channelId: C, reason: 'other' }).success).toBe(false);
  });
});

describe('scopeOverviewResponseSchema', () => {
  function overview(missing: unknown) {
    const cell: Record<string, unknown> = {
      channelId: C,
      languageCode: 'de-DE',
      available: false,
      effectiveStatus: 'inactive',
      statusSource: 'channel_language',
      overriddenFields: [{ field: 'status', level: 'channel_language' }],
    };
    if (missing !== undefined) cell['missing'] = missing;
    return {
      data: {
        channels: [{ channelId: C, name: { en: 'B2B' }, isMember: true, languages: ['pl-PL', 'de-DE'] }],
        languages: ['pl-PL', 'de-DE'],
        cells: [cell],
        channelRows: [{ channelId: C, overriddenFields: ['status'] }],
        orphans: [{ field: 'status', channelId: C, languageCode: 'fr-FR', reason: 'language_not_offered' }],
      },
    };
  }

  it('accepts a cell without missing (not evaluable)', () => {
    expect(scopeOverviewResponseSchema.safeParse(overview(undefined)).success).toBe(true);
  });

  it('accepts missing: [] (complete)', () => {
    expect(scopeOverviewResponseSchema.safeParse(overview([])).success).toBe(true);
  });

  it("accepts missing: ['name', 'urlKey', 'attribute:color']", () => {
    expect(scopeOverviewResponseSchema.safeParse(overview(['name', 'urlKey', 'attribute:color'])).success).toBe(true);
  });

  it("refuses an unknown token such as 'sku'", () => {
    expect(scopeOverviewResponseSchema.safeParse(overview(['sku'])).success).toBe(false);
  });
});

describe('bulk update — scopedStatus (admin-scopes-api.md §4)', () => {
  const base = { productIds: [P] };

  it('counts scopedStatus as a field on its own', () => {
    const parsed = bulkUpdateProductsRequestSchema.safeParse({
      ...base,
      fields: { scopedStatus: { channelId: C, languageCode: null, value: 'active' } },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(['active', 'inactive', 'inherit'])('accepts value %s', (value) => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({
        ...base,
        fields: { scopedStatus: { channelId: C, languageCode: 'de-DE', value } },
      }).success,
    ).toBe(true);
  });

  it.each(['draft', 'archived', 'deleted'])('refuses the value %s (FR-112, O-1)', (value) => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({
        ...base,
        fields: { scopedStatus: { channelId: C, languageCode: null, value } },
      }).success,
    ).toBe(false);
  });

  it('refuses scopedStatus combined with status, on the scopedStatus path', () => {
    const parsed = bulkUpdateProductsRequestSchema.safeParse({
      ...base,
      fields: { status: 'active', scopedStatus: { channelId: C, languageCode: null, value: 'inactive' } },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.includes('scopedStatus'))).toBe(true);
  });

  it('result reasons gain scope_invalid and completeness_gate', () => {
    for (const reason of ['scope_invalid', 'completeness_gate']) {
      expect(bulkUpdateProductResultSchema.safeParse({ productId: P, status: 'skipped', reason }).success).toBe(true);
    }
  });
});


describe('updateProductRequestSchema — the global publication window (T026)', () => {
  it('accepts publishFrom / publishUntil as ISO instants or null', () => {
    const parsed = updateProductRequestSchema.parse({ publishFrom: '2026-12-01T00:00:00.000Z', publishUntil: null });
    expect(parsed.publishFrom).toBe('2026-12-01T00:00:00.000Z');
    expect(parsed.publishUntil).toBeNull();
  });

  it('refuses a bound that is not an ISO instant', () => {
    expect(updateProductRequestSchema.safeParse({ publishFrom: 'tomorrow' }).success).toBe(false);
  });
});
