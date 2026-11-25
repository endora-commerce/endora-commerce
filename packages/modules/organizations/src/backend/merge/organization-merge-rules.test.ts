import { describe, expect, it } from 'vitest';
import {
  customFieldDifferences,
  fieldDifferences,
  organizationMergeRefusals,
  resolvedCustomFieldValues,
  type MergeableOrganization,
} from './organization-merge-rules.js';

/**
 * `specs/192-organization-merge/` T026 (FR-020 – FR-023, FR-030 – FR-032,
 * D-299 OQ-1, OQ-3): the host's own refusals and its value differences, as
 * pure functions of the two rows. The same function answers the preview and
 * the start (inside the start Command, on locked rows), so the start can never
 * accept what the preview refused (SC-005). The tax-ID scope does not enter the
 * tree rule: OQ-3 is decided by position alone, under `global` and
 * `per-tree-root` alike.
 */

const S = '00000000-0000-4000-8000-0000000192a1';
const L = '00000000-0000-4000-8000-0000000192a2';
const ROOT = '00000000-0000-4000-8000-0000000192a3';
const OTHER_ROOT = '00000000-0000-4000-8000-0000000192a4';

function org(id: string, over: Partial<MergeableOrganization> = {}): MergeableOrganization {
  return {
    id,
    name: `Org ${id.slice(-2)}`,
    legalName: null,
    taxId: `PL${id.slice(-6)}`,
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    customerGroupId: null,
    creditInheritanceMode: null,
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    orderConfirmationEmails: [],
    customFieldValues: {},
    status: 'active',
    isPersonal: false,
    parentId: null,
    path: `/${id}/`,
    deletedAt: null,
    mergedIntoOrganizationId: null,
    ...over,
  };
}

const codes = (s: MergeableOrganization | null, l: MergeableOrganization | null) =>
  organizationMergeRefusals(s, l, { survivorId: S, loserId: L }).map((r) => `${r.code}${r.details?.['code'] ? `:${String(r.details['code'])}` : ''}`);

describe('organizationMergeRefusals', () => {
  it('allows two company roots', () => {
    expect(codes(org(S), org(L))).toEqual([]);
  });

  it('refuses a merge into itself before anything else', () => {
    expect(organizationMergeRefusals(org(S), org(S), { survivorId: S, loserId: S }).map((r) => r.code)).toEqual([
      'RECORD_MERGE_SAME_RECORD',
    ]);
  });

  it.each([
    ['a missing survivor', null, org(L)],
    ['a missing loser', org(S), null],
    ['a deleted survivor', org(S, { deletedAt: new Date() }), org(L)],
    ['a deleted loser', org(S), org(L, { deletedAt: new Date() })],
    ['a merged loser', org(S), org(L, { mergedIntoOrganizationId: ROOT, deletedAt: new Date() })],
    ['a rejected survivor', org(S, { status: 'rejected' }), org(L)],
  ])('refuses %s as unavailable', (_label, s, l) => {
    expect(codes(s, l)).toEqual(['RECORD_MERGE_RECORD_UNAVAILABLE']);
  });

  it.each(['pending_verification', 'blocked'] as const)('lets a %s survivor receive a merge (edge case)', (status) => {
    expect(codes(org(S, { status }), org(L))).toEqual([]);
  });

  it.each(['pending_verification', 'blocked', 'rejected'] as const)('lets a %s loser be merged', (status) => {
    expect(codes(org(S), org(L, { status }))).toEqual([]);
  });

  it('refuses a personal Organization on either side (D-299, OQ-1)', () => {
    expect(codes(org(S, { isPersonal: true, taxId: null }), org(L))).toEqual(['ORGANIZATION_MERGE_PERSONAL']);
    expect(codes(org(S), org(L, { isPersonal: true, taxId: null }))).toEqual(['ORGANIZATION_MERGE_PERSONAL']);
  });

  it('refuses a loser that is an ancestor of the survivor (FR-021)', () => {
    const loser = org(L);
    const survivor = org(S, { parentId: L, path: `/${L}/${S}/` });
    expect(codes(survivor, loser)).toEqual(['ORGANIZATION_MERGE_TREE_INVALID:ancestor']);
  });

  it('allows two members of one tree, and a survivor that is an ancestor of the loser (FR-022)', () => {
    expect(codes(org(S, { parentId: ROOT, path: `/${ROOT}/${S}/` }), org(L, { parentId: ROOT, path: `/${ROOT}/${L}/` }))).toEqual([]);
    expect(codes(org(S), org(L, { parentId: S, path: `/${S}/${L}/` }))).toEqual([]);
  });

  it('refuses non-roots of two different trees, and a root with a non-root of another tree (D-299, OQ-3)', () => {
    expect(
      codes(org(S, { parentId: ROOT, path: `/${ROOT}/${S}/` }), org(L, { parentId: OTHER_ROOT, path: `/${OTHER_ROOT}/${L}/` })),
    ).toEqual(['ORGANIZATION_MERGE_TREE_INVALID:different_trees']);
    expect(codes(org(S), org(L, { parentId: OTHER_ROOT, path: `/${OTHER_ROOT}/${L}/` }))).toEqual([
      'ORGANIZATION_MERGE_TREE_INVALID:different_trees',
    ]);
  });
});

describe('fieldDifferences (FR-030, FR-032)', () => {
  it('offers only the differing fields, defaulting to the survivor unless the survivor is empty', () => {
    const diff = fieldDifferences(
      org(S, { name: 'Acme', legalName: null, taxId: 'PL1', customerGroupId: null }),
      org(L, { name: 'ACME Ltd', legalName: 'ACME Ltd sp. z o.o.', taxId: 'PL2', customerGroupId: 'g' }),
    );
    expect(diff.map((d) => `${d.code}:${d.default}`)).toEqual([
      'name:survivor',
      'legalName:loser',
      'taxId:survivor',
      'customerGroupId:loser',
    ]);
  });

  it('never offers status, moderation stamps or the tree position', () => {
    const diff = fieldDifferences(org(S, { status: 'active' }), org(L, { status: 'blocked', parentId: ROOT, path: `/${ROOT}/${L}/` }));
    expect(diff.map((d) => d.code)).not.toContain('status');
    expect(diff.map((d) => d.code)).not.toContain('parentId');
  });

  it('treats the fulfilment strategy and its warehouse order as one field', () => {
    const diff = fieldDifferences(
      org(S, { fulfilmentStrategy: 'any', fulfilmentStrategyWarehouseOrder: null }),
      org(L, { fulfilmentStrategy: 'defined_order', fulfilmentStrategyWarehouseOrder: ['w1'] }),
    );
    expect(diff.filter((d) => d.code.startsWith('fulfilment'))).toEqual([
      {
        code: 'fulfilmentStrategy',
        survivor: { strategy: 'any', warehouseOrder: null },
        loser: { strategy: 'defined_order', warehouseOrder: ['w1'] },
        default: 'survivor',
      },
    ]);
  });
});

describe('custom-field values (FR-031)', () => {
  const survivor = org(S, { customFieldValues: { tier: 'gold', region: '', erp: 'A-1' } });
  const loser = org(L, { customFieldValues: { tier: 'silver', region: 'north', segment: 'b2b', erp: 'A-1' } });

  it('lists the differing keys with the survivor as default unless it is empty', () => {
    expect(customFieldDifferences(survivor, loser).map((d) => `${d.key}:${d.default}`)).toEqual([
      'region:loser',
      'segment:loser',
      'tier:survivor',
    ]);
  });

  it('keeps the survivor’s, fills its empty fields from the loser, and takes the loser’s where chosen', () => {
    expect(resolvedCustomFieldValues(survivor, loser, {})).toEqual({ tier: 'gold', region: 'north', segment: 'b2b', erp: 'A-1' });
    expect(resolvedCustomFieldValues(survivor, loser, { tier: 'loser', region: 'survivor' })).toEqual({
      tier: 'silver',
      region: '',
      segment: 'b2b',
      erp: 'A-1',
    });
  });

  it('never combines multi-valued fields', () => {
    const s = org(S, { customFieldValues: { tags: ['a'] } });
    const l = org(L, { customFieldValues: { tags: ['b', 'c'] } });
    expect(resolvedCustomFieldValues(s, l, {})).toEqual({ tags: ['a'] });
    expect(resolvedCustomFieldValues(s, l, { tags: 'loser' })).toEqual({ tags: ['b', 'c'] });
  });
});
