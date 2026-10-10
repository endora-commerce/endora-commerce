import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { BackendServerHandle } from './test-server.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** The host tables whose rows a non-administrator reads custom-field values from. */
const HOST_TABLE = { order: 'orders', quote_request: 'quote_requests' } as const;

export interface CustomFieldAudienceFixture {
  /** Defined with `audience: 'customer'`. */
  readonly visibleKey: string;
  /** Defined with `audience: 'internal'`. */
  readonly internalKey: string;
  /** Defined without the attribute — must behave as `internal`. */
  readonly implicitKey: string;
  /** Stored on the row with no definition at all. */
  readonly orphanKey: string;
  /** What is stored on the host row: one value under each of the four keys. */
  readonly stored: Record<string, unknown>;
  /** What a non-administrator may read of {@link stored}. */
  readonly customerVisible: Record<string, unknown>;
}

/**
 * One row carrying a value for each audience case, for the tests that hold
 * "a non-admin reply carries only customer-visible custom-field values".
 *
 * The definitions are created through the admin API (so the default a missing
 * attribute gets is the route's, not this helper's), and the bag is written
 * straight to the host row — an orphaned key cannot be written any other way,
 * and what is under test is the read.
 */
export async function seedCustomFieldAudienceCases(
  h: BackendServerHandle,
  entityType: keyof typeof HOST_TABLE,
  rowId: string,
): Promise<CustomFieldAudienceFixture> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const visibleKey = `aud_visible_${suffix}`;
  const internalKey = `aud_internal_${suffix}`;
  const implicitKey = `aud_implicit_${suffix}`;
  const orphanKey = `aud_orphan_${suffix}`;

  const define = async (key: string, audience?: 'customer' | 'internal'): Promise<void> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
        ...(audience ? { audience } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { data: { audience: string } }).data.audience).toBe(
      audience ?? 'internal',
    );
  };
  await define(visibleKey, 'customer');
  await define(internalKey, 'internal');
  await define(implicitKey);

  const stored = {
    [visibleKey]: 'shown to the customer',
    [internalKey]: 'internal: call before shipping',
    [implicitKey]: 'risk: high',
    [orphanKey]: 'left behind by a deleted field',
  };
  const updated = await h
    .em()
    .getConnection()
    .execute(
      `update "${HOST_TABLE[entityType]}" set custom_field_values = ?::jsonb where id = ? returning id`,
      [JSON.stringify(stored), rowId],
    );
  expect(updated).toHaveLength(1);

  return {
    visibleKey,
    internalKey,
    implicitKey,
    orphanKey,
    stored,
    customerVisible: { [visibleKey]: stored[visibleKey] },
  };
}
