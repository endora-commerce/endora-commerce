import { describe, expect, it } from 'vitest';
import {
  channelScopeRows,
  familyOverrideRows,
  galleryRoleRows,
  languageStatusRows,
  valueOverrideRows,
} from './scoped-store-adapters.js';

/**
 * Feature 172 (T028; research R1, data-model §2–§7) — every store of a scoped value reads as the
 * one `ScopedRow` shape `resolveScoped` takes: a row's **presence** is the override, `{"v": null}`
 * (or a role held by no image, or an overridden minimum with none) is the **empty** override, and
 * an inheriting store row contributes nothing. Orphan rows (a channel the product left, a language
 * the channel no longer offers) are passed through: dropping them is the caller's decision.
 */

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const OTHER_ITEM = '44444444-4444-4444-8444-444444444444';

describe('scoped store adapters', () => {
  it('value overrides: wrapped values, {"v": null} as empty, filtered by key', () => {
    const rows = [
      { attributeKey: 'name', channelId: C1, languageCode: 'pl-PL', value: { v: 'Wiertarka' } },
      { attributeKey: 'name', channelId: C1, languageCode: null, value: { v: 'Drill (C)' } },
      { attributeKey: 'description', channelId: C1, languageCode: 'pl-PL', value: { v: null } },
      { attributeKey: 'colour', channelId: C2, languageCode: null, value: { v: ['red', 'blue'] } },
    ];
    expect(valueOverrideRows(rows, 'name')).toEqual([
      { channelId: C1, languageCode: 'pl-PL', value: { kind: 'value', value: 'Wiertarka' } },
      { channelId: C1, languageCode: null, value: { kind: 'value', value: 'Drill (C)' } },
    ]);
    expect(valueOverrideRows(rows, 'description')).toEqual([
      { channelId: C1, languageCode: 'pl-PL', value: { kind: 'empty' } },
    ]);
    expect(valueOverrideRows(rows, 'colour')).toEqual([
      { channelId: C2, languageCode: null, value: { kind: 'value', value: ['red', 'blue'] } },
    ]);
    expect(valueOverrideRows(rows, 'size')).toEqual([]);
  });

  it('value overrides: a row whose value is not wrapped is read as empty, never as a value', () => {
    expect(valueOverrideRows([{ attributeKey: 'name', channelId: C1, languageCode: null, value: 'bare' as never }], 'name')).toEqual([
      { channelId: C1, languageCode: null, value: { kind: 'empty' } },
    ]);
  });

  it('channel scope rows: inheriting columns contribute nothing; the MOQ flag decides presence', () => {
    const from = new Date('2031-01-01T00:00:00.000Z');
    const rows = [
      {
        salesChannelId: C1,
        status: 'inactive' as const,
        windowOverridden: true,
        publishFrom: from,
        publishUntil: null,
        visibility: 'organization_restricted' as const,
        allowedOrganizationIds: ['o1'],
        minOrderQuantityOverridden: true,
        minOrderQuantity: null,
        returnable: false,
      },
      {
        salesChannelId: C2,
        status: null,
        windowOverridden: false,
        publishFrom: null,
        publishUntil: null,
        visibility: null,
        allowedOrganizationIds: null,
        minOrderQuantityOverridden: true,
        minOrderQuantity: 5,
        returnable: null,
      },
    ];
    expect(channelScopeRows(rows, 'status')).toEqual([{ channelId: C1, languageCode: null, value: { kind: 'value', value: 'inactive' } }]);
    expect(channelScopeRows(rows, 'window')).toEqual([
      { channelId: C1, languageCode: null, value: { kind: 'value', value: { from: from.toISOString(), until: null } } },
    ]);
    expect(channelScopeRows(rows, 'audience')).toEqual([
      {
        channelId: C1,
        languageCode: null,
        value: { kind: 'value', value: { visibility: 'organization_restricted', allowedOrganizationIds: ['o1'] } },
      },
    ]);
    // An overridden minimum with no value = "no minimum in this channel" (the empty override).
    expect(channelScopeRows(rows, 'minOrderQuantity')).toEqual([
      { channelId: C1, languageCode: null, value: { kind: 'empty' } },
      { channelId: C2, languageCode: null, value: { kind: 'value', value: 5 } },
    ]);
    expect(channelScopeRows(rows, 'returnable')).toEqual([{ channelId: C1, languageCode: null, value: { kind: 'value', value: false } }]);
  });

  it('channel × language status rows', () => {
    expect(
      languageStatusRows([
        { salesChannelId: C1, languageCode: 'pl-PL', status: 'active' as const },
        { salesChannelId: C2, languageCode: 'de-DE', status: 'inactive' as const },
      ]),
    ).toEqual([
      { channelId: C1, languageCode: 'pl-PL', value: { kind: 'value', value: 'active' } },
      { channelId: C2, languageCode: 'de-DE', value: { kind: 'value', value: 'inactive' } },
    ]);
  });

  it('family overrides: gallery item, attachment and packaging-unit rows per subject and field', () => {
    const rows = [
      { subjectId: ITEM, salesChannelId: C1, languageCode: 'pl-PL', field: 'alt_text', value: { v: 'Wiertarka z boku' } },
      { subjectId: ITEM, salesChannelId: C1, languageCode: null, field: 'alt_text', value: { v: null } },
      { subjectId: ITEM, salesChannelId: C1, languageCode: null, field: 'hidden', value: { v: true } },
      { subjectId: OTHER_ITEM, salesChannelId: C1, languageCode: null, field: 'alt_text', value: { v: 'other' } },
    ];
    expect(familyOverrideRows(rows, ITEM, 'alt_text')).toEqual([
      { channelId: C1, languageCode: 'pl-PL', value: { kind: 'value', value: 'Wiertarka z boku' } },
      { channelId: C1, languageCode: null, value: { kind: 'empty' } },
    ]);
    expect(familyOverrideRows(rows, ITEM, 'hidden')).toEqual([{ channelId: C1, languageCode: null, value: { kind: 'value', value: true } }]);
    expect(familyOverrideRows(rows, OTHER_ITEM, 'hidden')).toEqual([]);
  });

  it('gallery roles: a row naming no item is the empty override', () => {
    const rows = [
      { label: 'base_image' as const, salesChannelId: C1, languageCode: null, galleryItemId: ITEM },
      { label: 'base_image' as const, salesChannelId: C1, languageCode: 'pl-PL', galleryItemId: null },
      { label: 'thumbnail' as const, salesChannelId: C2, languageCode: null, galleryItemId: OTHER_ITEM },
    ];
    expect(galleryRoleRows(rows, 'base_image')).toEqual([
      { channelId: C1, languageCode: null, value: { kind: 'value', value: ITEM } },
      { channelId: C1, languageCode: 'pl-PL', value: { kind: 'empty' } },
    ]);
    expect(galleryRoleRows(rows, 'small_image')).toEqual([]);
  });

  it('passes orphan rows through for the caller to drop', () => {
    const orphan = { attributeKey: 'name', channelId: C2, languageCode: 'fr-FR', value: { v: 'Perceuse' } };
    expect(valueOverrideRows([orphan], 'name')).toHaveLength(1);
  });
});
