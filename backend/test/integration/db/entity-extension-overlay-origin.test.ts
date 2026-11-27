import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeEntityExtensionContext,
  migrateUpVerified,
  verifyEntityExtensions,
} from '@endora-commerce/platform/db';

import { openAcmeLinksInstance, type AcmeLinksInstance } from '../../helpers/acme-links-instance.js';

/**
 * `specs/187-side-table-extensions/` US1 scenario 4, FR-005, SC-006 (tasks.md
 * T022) — the same module shipped as a deployment's overlay module migrates,
 * verifies and lists exactly as the installed package does in
 * `entity-extension-verifier.test.ts`, with `origin: overlay` the one
 * difference. Its migration runs through the foreign-schema guard with no
 * exemption (spec 190 OR-4), and the side table's foreign key to its host is
 * not a foreign write (research R-15).
 */

let instance: AcmeLinksInstance;

beforeAll(async () => {
  instance = await openAcmeLinksInstance('overlay');
}, 180_000);

afterAll(async () => {
  await instance?.dispose();
});

describe('an overlay module’s side tables', () => {
  it('are resolved under origin overlay', () => {
    expect(
      activeEntityExtensionContext()
        .extensions.filter((extension) => extension.moduleId === 'acme_links')
        .map((extension) => `${extension.origin}:${extension.declaration.table}`),
    ).toEqual(['overlay:acme_links_organization_refs', 'overlay:acme_links_order_notes']);
  });

  it('migrate, verify in one statement and list with origin overlay — nothing else differs', async () => {
    const applied = await migrateUpVerified(instance.orm, undefined, () => {});
    expect(applied.map((migration) => migration.name)).toEqual(['Migration20261201T100000AcmeLinksInit']);

    const statements: string[] = [];
    const report = await verifyEntityExtensions(
      (sql, params = []) => {
        statements.push(sql);
        return instance.orm.em.getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>;
      },
      activeEntityExtensionContext(),
      () => {},
    );
    expect(statements).toHaveLength(1);
    expect(report.rows.filter((row) => row.moduleId === 'acme_links')).toEqual([
      {
        kind: 'entity-extension',
        moduleId: 'acme_links',
        origin: 'overlay',
        host: 'orders.Order',
        hostTable: 'orders',
        table: 'acme_links_order_notes',
        constraint: 'acme_links_order_notes_order_fk',
        status: 'verified',
      },
      {
        kind: 'entity-extension',
        moduleId: 'acme_links',
        origin: 'overlay',
        host: 'organizations.Organization',
        hostTable: 'organizations',
        table: 'acme_links_organization_refs',
        constraint: 'acme_links_organization_refs_organization_fk',
        status: 'verified',
      },
    ]);
  });
});
