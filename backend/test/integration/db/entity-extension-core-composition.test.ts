import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_HOST_BINDINGS,
} from '@endora-commerce/contracts';
import {
  activeEntityExtensionContext,
  verifyEntityExtensions,
  type EntityExtensionReport,
} from '@endora-commerce/platform/db';

import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';

/**
 * `specs/187-side-table-extensions/` FR-032, SC-005 (tasks.md T021) — this
 * repository's own composition: `quote_requests` declares its two side tables,
 * so the core composition carries **no** undeclared or unowned side table and
 * no violation; and M0 holds every custom-field host binding against the
 * entities this build discovers (FR-003).
 *
 * Read-only, over the invocation's migrated run database: the verifier is the
 * call `composeApp` makes at boot.
 */

let orm: MikroORM;
let report: EntityExtensionReport;
const warnings: string[] = [];

beforeAll(async () => {
  // M0 – M5 run in `afterDiscovered`: an initialisation that returns is one that passed them.
  orm = await MikroORM.init(await mikroOrmConfig());
  report = await verifyEntityExtensions(
    (sql, params = []) => orm.em.getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>,
    activeEntityExtensionContext(),
    (line) => warnings.push(line),
  );
}, 120_000);

afterAll(async () => {
  await orm?.close(true);
});

describe('the core composition’s side tables', () => {
  it('declares exactly quote_requests’ two side tables', () => {
    expect(
      activeEntityExtensionContext().extensions.map(
        (extension) => `${extension.origin}:${extension.moduleId}:${extension.declaration.entity}:${extension.declaration.table}`,
      ),
    ).toEqual([
      'core:quote_requests:organizations.Organization:quote_request_org_policies',
      'core:quote_requests:customer_accounts.CustomerAccount:quote_request_account_policies',
    ]);
  });

  it('verifies both, with zero violations and zero undeclared or unowned findings (FR-032)', () => {
    expect(report.findings).toEqual([]);
    expect(warnings).toEqual([]);
    expect(report.rows.map((row) => `${row.moduleId}:${row.table}:${row.status}`)).toEqual([
      'quote_requests:quote_request_account_policies:verified',
      'quote_requests:quote_request_org_policies:verified',
    ]);
    expect(report.queries).toBe(1);
  });

  it('holds every host binding to the class discovery found on its table (M0, FR-003)', () => {
    const tables = activeEntityExtensionContext().tables;
    for (const binding of Object.values(CUSTOM_FIELD_HOST_BINDINGS)) {
      expect(tables?.get(binding.table), binding.table).toEqual({
        moduleId: binding.ownerModuleId,
        origin: 'core',
        className: binding.entityClassName,
      });
    }
  });
});
