import { describe, expect, it } from 'vitest';
import {
  organizationPickerListItemSchema,
  organizationPickerPageSchema,
  organizationStatusSchema,
} from '../src/organizations.js';

/**
 * The Organization picker's projection is a contract (feature 091, P2).
 *
 * The picker moved into `@endora-commerce/admin-kit` and rebuilt its request
 * from the published `apiClient`, so the row shape it hands a consumer crosses
 * a package boundary and Principle II puts it here. It is a **projection** over
 * `GET /api/v1/admin/organizations` and not that endpoint's envelope: the
 * picker needs an id, a label, a status pill and the optimistic-concurrency
 * version, and nothing else on an Organization is its business.
 */
describe('organizationPickerListItemSchema', () => {
  it('accepts the row the picker renders', () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Bauhaus Polska',
      legalName: null,
      status: 'active',
      version: 3,
    };
    expect(organizationPickerListItemSchema.parse(row)).toEqual(row);
  });

  it('takes its status from the one published Organization status enum', () => {
    // There is no second picker-only status enum: the four members the picker
    // filters on are exactly `organizationStatusSchema`'s, measured, so
    // publishing a `OrganizationStatusPickerFilter` beside it would be two
    // names for one set that could drift.
    expect(organizationStatusSchema.options).toEqual([
      'pending_verification',
      'active',
      'blocked',
      'rejected',
    ]);
    expect(
      organizationPickerListItemSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'X',
        legalName: null,
        status: 'suspended',
        version: 0,
      }).success,
    ).toBe(false);
  });

  it('carries the optional fields the picker may render and never requires them', () => {
    const parsed = organizationPickerListItemSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'X',
      legalName: 'X sp. z o.o.',
      status: 'blocked',
      countryCode: 'PL',
      salesRepAdminUserIds: ['22222222-2222-4222-8222-222222222222'],
      memberCount: 4,
      version: 1,
    });
    expect(parsed.countryCode).toBe('PL');
    expect(parsed.memberCount).toBe(4);
  });
});

describe('organizationPickerPageSchema', () => {
  it('is a cursor page over those rows', () => {
    const page = { items: [], nextCursor: null };
    expect(organizationPickerPageSchema.parse(page)).toEqual(page);
  });
});
