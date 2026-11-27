import type { EntityManager, FilterQuery } from '@mikro-orm/core';
import { ERROR_CODES, type OrganizationDetailsPort, type Pagination } from '@endora-commerce/contracts';
import { HttpError, decodeCursor, encodeCursor } from '@endora-commerce/platform/http';

import { ExampleErpOrganizationKey } from '../entities/example-erp-organization-key.entity.js';
import { ERP_KEY_PATTERN, normalizeErpKey, type ExampleErpKeyExtension, type ExampleErpKeyRow, type ExampleErpKeysPort } from '../ports.js';

/**
 * The extension-attribute loader `organizationDetailsPort` calls for
 * `include: ['extensions.example_erp_keys']`
 * (`specs/187-side-table-extensions/contracts/extension-attributes-read-ports.md` §2, §5).
 *
 * One `in` statement whatever the number of ids, on the host port's entity
 * manager and in the caller's tenant context: it is handed only the records the
 * host already authorised and never widens scope, so an Organization whose key
 * the caller may not see reads as `null`. Ids with no key are left out; the
 * platform turns them into `null`.
 */
export async function loadErpKeys(
  ids: readonly string[],
  { em }: { readonly em: EntityManager },
): Promise<ReadonlyMap<string, ExampleErpKeyExtension>> {
  if (ids.length === 0) return new Map();
  const rows = await em.find(ExampleErpOrganizationKey, { organizationId: { $in: [...ids] } });
  return new Map(rows.map((row) => [row.organizationId, { erpKey: row.erpKey }]));
}

/** `exampleErpKeysPort` — see {@link ExampleErpKeysPort}. */
export class ExampleErpKeysService implements ExampleErpKeysPort {
  readonly #emFactory: () => EntityManager;

  // No parameter property: overlay code compiles under `erasableSyntaxOnly`
  // (`backend/tsconfig.apps.json`, spec 190 FR-010).
  constructor(emFactory: () => EntityManager) {
    this.#emFactory = emFactory;
  }

  async keyOf(organizationId: string): Promise<string | null> {
    const row = await this.#emFactory().findOne(ExampleErpOrganizationKey, { organizationId });
    return row?.erpKey ?? null;
  }

  async organizationIdOf(erpKey: string): Promise<string | null> {
    const row = await this.#emFactory().findOne(ExampleErpOrganizationKey, { erpKey: normalizeErpKey(erpKey) });
    return row?.organizationId ?? null;
  }
}

/** The largest page the admin list answers; a lookup by key answers one row. */
export const ERP_KEY_LIST_LIMIT = 100;

/** The page size when the caller names none. */
export const ERP_KEY_LIST_DEFAULT_LIMIT = 50;

/** One page of the admin list, in the repository's cursor envelope (`collectionEnvelope`). */
export interface ErpKeyListPage {
  readonly data: ExampleErpKeyRow[];
  readonly pagination: Pagination;
}

/**
 * The admin list: the keys the caller may see, by key, a page at a time, with
 * each Organization's name read through the owner's port — never this module's
 * own join on `organizations`, which is not its table.
 *
 * Keyset-paged on `erp_key`, which is unique, so the cursor is the last key of
 * the page (opaque to the client) and a page never repeats or skips a row while
 * keys are added. One row past `limit` is read to answer `hasMore`. A cursor
 * this list did not issue is a `400`.
 */
export async function listErpKeys(
  em: EntityManager,
  organizations: Pick<OrganizationDetailsPort, 'findByIds'>,
  query: { readonly erpKey?: string | undefined; readonly cursor?: string | undefined; readonly limit: number },
): Promise<ErpKeyListPage> {
  const erpKey = query.erpKey === undefined ? '' : normalizeErpKey(query.erpKey);
  const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  if (query.cursor !== undefined && (after === undefined || !ERP_KEY_PATTERN.test(after))) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this list issued.');
  }
  const keyFilter = { ...(erpKey === '' ? {} : { $eq: erpKey }), ...(after === undefined ? {} : { $gt: after }) };
  const where: FilterQuery<ExampleErpOrganizationKey> = Object.keys(keyFilter).length === 0 ? {} : { erpKey: keyFilter };
  const found = await em.find(ExampleErpOrganizationKey, where, { orderBy: { erpKey: 'asc' }, limit: query.limit + 1 });
  const hasMore = found.length > query.limit;
  const rows = hasMore ? found.slice(0, query.limit) : found;
  const last = rows[rows.length - 1];
  const pagination: Pagination = {
    cursor: hasMore && last !== undefined ? encodeCursor(last.erpKey) : null,
    hasMore,
    limit: query.limit,
  };
  if (rows.length === 0) return { data: [], pagination };
  const names = new Map(
    (await organizations.findByIds(rows.map((row) => row.organizationId))).map((record) => [record.id, record.name]),
  );
  const data = rows.flatMap((row) => {
    const organizationName = names.get(row.organizationId);
    return organizationName === undefined
      ? []
      : [{ organizationId: row.organizationId, organizationName, erpKey: row.erpKey }];
  });
  return { data, pagination };
}
