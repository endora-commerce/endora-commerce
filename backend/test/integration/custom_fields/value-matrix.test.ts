import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isCustomFieldValidationFailure, type SupportedEntityType } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';

/**
 * Feature 055 US2 (T026/T027/T028) — value-type × entity matrix, rejection
 * matrix, and dormant-value stripping [real DB].
 *
 * Definitions are created through the real admin route (so the Command Bus has
 * an actor); validation is asserted through the value service; the JSONB column
 * round-trip is proven directly on a host table (Category).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const ENTITIES: SupportedEntityType[] = ['category', 'order', 'organization', 'customer', 'quote_request'];

const VALUE_TYPE_DEFS = (prefix: string) => [
  { key: `${prefix}_text`, valueType: 'text', options: [] as string[] },
  { key: `${prefix}_number`, valueType: 'number', options: [] },
  { key: `${prefix}_boolean`, valueType: 'boolean', options: [] },
  { key: `${prefix}_date`, valueType: 'date', options: [] },
  { key: `${prefix}_select`, valueType: 'select', options: ['a', 'b'] },
  { key: `${prefix}_multi`, valueType: 'multiselect', options: ['x', 'y', 'z'] },
];

describe('Custom Fields — value matrix across entities [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Define one field of every value type on every supported entity type.
    for (const entityType of ENTITIES) {
      for (const d of VALUE_TYPE_DEFS(entityType)) {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/custom-fields/definitions',
          payload: {
            entityType,
            key: d.key,
            label: {},
            labelDefault: d.key,
            valueType: d.valueType,
            required: false,
            sortOrder: 0,
            config: {},
            options: d.options.map((v, i) => ({
              value: v,
              label: {},
              labelDefault: v,
              isDefault: false,
              sortOrder: i,
            })),
          },
          ...ADMIN,
        });
        expect(res.statusCode, `${entityType}.${d.key}`).toBe(201);
      }
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('validates + round-trips every value type on every entity (SC-002)', async () => {
    for (const entityType of ENTITIES) {
      const p = entityType;
      const merged = await h.customFields.valueService.validateAndMerge(entityType, {}, {
        [`${p}_text`]: 'hello',
        [`${p}_number`]: '42',
        [`${p}_boolean`]: 'true',
        [`${p}_date`]: '2026-07-18',
        [`${p}_select`]: 'a',
        [`${p}_multi`]: ['x', 'z'],
      });
      expect(merged, entityType).toEqual({
        [`${p}_text`]: 'hello',
        [`${p}_number`]: 42,
        [`${p}_boolean`]: true,
        [`${p}_date`]: '2026-07-18',
        [`${p}_select`]: 'a',
        [`${p}_multi`]: ['x', 'z'],
      });
    }
  });

  it('rejects invalid values per entity with field-specific errors (SC-003)', async () => {
    for (const entityType of ENTITIES) {
      const p = entityType;
      await expect(
        h.customFields.valueService.validateAndMerge(entityType, {}, {
          [`${p}_number`]: 'not-a-number',
          [`${p}_select`]: 'unknown',
        }),
        // `isCustomFieldValidationFailure` rather than `toBeInstanceOf`, and the
        // published guard's own doc block predicted why: the thrower is the
        // **composed** service — `h.customFields.valueService` comes off the
        // harness's container, which resolves `custom_fields` through
        // `@endora-commerce/mod-custom-fields/backend`, i.e. out of `dist` — so
        // a class imported here by filesystem path into the package's *source*
        // is a second evaluation and `instanceof` is false against an error of
        // exactly the right kind (feature 080, T040b, batch four; D-160.6.1 —
        // the shape batch three met as `KsefUnavailableError`). Feature 075's
        // Phase C published the structural guard for the five host modules that
        // catch this error, saying in as many words that testing `name` and the
        // `errors` array "is what makes it survive the error crossing a package
        // boundary once each module is its own npm package (F4)". This is that
        // day, and the test uses the seam the hosts use.
      ).rejects.toSatisfy(isCustomFieldValidationFailure);
    }
  });

  it('round-trips the JSONB value bag on a host table (Category)', async () => {
    const id = randomUUID();
    const em1 = h.em();
    em1.create(Category, {
      id,
      name: { en: 'CF Test Category' },
      slug: `cf-test-${id.slice(0, 8)}`,
      sortOrder: 0,
      customFieldValues: { category_text: 'stored', category_number: 7 },
    });
    await em1.flush();

    const em2 = h.em();
    const reloaded = await em2.findOneOrFail(Category, { id });
    expect(reloaded.customFieldValues).toEqual({ category_text: 'stored', category_number: 7 });
  });

  it('strips dormant values after a definition is deleted (FR-010 / US2 scenario 4)', async () => {
    // Find the organization_text definition id and delete it.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=organization',
      ...ADMIN,
    });
    const def = (list.json().data as { id: string; key: string }[]).find(
      (d) => d.key === 'organization_text',
    )!;
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${def.id}`,
      ...ADMIN,
    });
    expect(del.statusCode).toBe(204);

    // A bag still carrying the deleted key is projected away on read.
    const projected = await h.customFields.valueService.project('organization', {
      organization_text: 'dormant',
      organization_number: 5,
    });
    expect(projected).toEqual({ organization_number: 5 });
  });
});
