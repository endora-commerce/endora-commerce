import type { EntityManager } from '@mikro-orm/core';
import type { OrganizationDetailsPort } from '@endora-commerce/contracts';

import { ExampleErpOrganizationKey } from '../entities/example-erp-organization-key.entity.js';
import { normalizeErpKey, type ExampleErpKeyExtension, type ExampleErpKeyRow, type ExampleErpKeysPort } from '../ports.js';

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

/** How many rows the admin list answers at most; a lookup by key answers one. */
export const ERP_KEY_LIST_LIMIT = 100;

/**
 * The admin list: the keys the caller may see, by key, with each Organization's
 * name read through the owner's port — never this module's own join on
 * `organizations`, which is not its table.
 */
export async function listErpKeys(
  em: EntityManager,
  organizations: Pick<OrganizationDetailsPort, 'findByIds'>,
  query: { readonly erpKey?: string | undefined },
): Promise<ExampleErpKeyRow[]> {
  const erpKey = query.erpKey === undefined ? '' : normalizeErpKey(query.erpKey);
  const rows = await em.find(
    ExampleErpOrganizationKey,
    erpKey === '' ? {} : { erpKey },
    { orderBy: { erpKey: 'asc' }, limit: ERP_KEY_LIST_LIMIT },
  );
  if (rows.length === 0) return [];
  const names = new Map(
    (await organizations.findByIds(rows.map((row) => row.organizationId))).map((record) => [record.id, record.name]),
  );
  return rows.flatMap((row) => {
    const organizationName = names.get(row.organizationId);
    return organizationName === undefined
      ? []
      : [{ organizationId: row.organizationId, organizationName, erpKey: row.erpKey }];
  });
}
