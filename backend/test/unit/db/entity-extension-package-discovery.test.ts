import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { configuredMigrationsFrom } from '@endora-commerce/platform/db';
import { packageSchemaContributionsUnder } from '@endora-commerce/platform/packages';

/**
 * `specs/187-side-table-extensions/` FR-001, FR-005 (T016) — an installed
 * package's manifest `extends` is read by the `node_modules` scan an instance
 * boots through, and resolved by the migration merge over the composed graph.
 *
 * The integration tests assemble the same package's contribution from its
 * `lib/` by path (`test/helpers/acme-links-instance.ts` says why); this is the
 * half they do not walk: the package found on disk, as a client's instance finds
 * it, with no wiring of its own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', '..', 'fixtures', 'installed-packages', 'mod-acme-links');
const scratch = join(here, '..', '..', '.installed-package-instances');

describe('the installed mod-acme-links', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('carries its manifest’s extends, which the merge resolves for an instance with no committed half', async () => {
    mkdirSync(scratch, { recursive: true });
    root = mkdtempSync(join(scratch, 'instance-'));
    const destination = join(root, 'node_modules', '@acme', 'mod-acme-links');
    mkdirSync(destination, { recursive: true });
    cpSync(fixture, destination, { recursive: true });

    const [contribution] = await packageSchemaContributionsUnder([join(root, 'node_modules')]);
    expect(contribution?.id).toBe('acme_links');
    expect(contribution?.entities.map((cls) => cls.name)).toEqual(['AcmeLinksOrganizationRef', 'AcmeLinksOrderNote']);
    expect(contribution?.entityExtensions).toEqual([
      { entity: 'organizations.Organization', table: 'acme_links_organization_refs' },
      { entity: 'orders.Order', table: 'acme_links_order_notes' },
    ]);

    const merged = configuredMigrationsFrom({
      coreEntries: [],
      coreModuleDependencies: new Map<string, readonly string[]>([
        ['core', []],
        ['organizations', []],
        ['orders', ['organizations']],
      ]),
      packages: [contribution!],
      baseline: [],
    });
    expect(merged.names).toEqual(['Migration20261201T100000AcmeLinksInit']);
    expect(
      merged.entityExtensions?.map((resolved) => `${resolved.origin}:${resolved.moduleId}:${resolved.host.table}`),
    ).toEqual(['package:acme_links:organizations', 'package:acme_links:orders']);
  });
});
