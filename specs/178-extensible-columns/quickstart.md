# Quickstart: the worked example `acme_erp` (also the integration fixture)

Fixture location: `backend/test/fixtures/installed-packages/mod-acme-erp/` (compiled JS, like the
sibling `mod-widgets`), discovered by pointing `ENDORA_INSTANCE_ROOT` at a temp directory whose
`node_modules/@acme/mod-acme-erp` is a copy of it (the pattern of
`backend/test/unit/packages/package-schema.test.ts`). Its TypeScript source, as an author writes
it, is reproduced on the developer page (FR-093) and type-checked by a `tsc --noEmit` test over
`backend/test/fixtures/installed-packages/mod-acme-erp/src/` so the docs cannot drift.

## package.json

```json
{
  "name": "@acme/mod-acme-erp", "version": "1.0.0", "type": "module",
  "endora": { "type": "module", "id": "acme_erp", "platform": "0.x" },
  "exports": { ".": "./dist/manifest.js", "./backend": "./dist/backend/index.js",
               "./migrations": "./dist/migrations/index.js", "./package.json": "./package.json" }
}
```

Manifest: `dependencies: ['organizations']`.

## src/backend/columns.ts

```ts
import { defineColumnExtension } from '@endora-commerce/platform/kernel';

export const acmeOrganizationColumns = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  adminReads: true,
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
    onboardedVia: { type: 'text', nullable: true },
  },
});
```

## src/backend/index.ts

```ts
export { acmeOrganizationColumns } from './columns.js';
export const schemaExtensions = [acmeOrganizationColumns];
export const entities = [];
```

## A Command that writes (ERP sync)

```ts
import { extensionColumns, columnExtensionPatchSchema } from '@endora-commerce/platform/kernel';
import type { Command } from '@endora-commerce/platform/commands';

export function syncErpCode(organizationId: string, erpCode: string): Command<void> {
  return {
    action: 'acme_erp.organization.sync', objectType: 'organization', objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, em)
        .set(organizationId, columnExtensionPatchSchema(acmeOrganizationColumns).parse({ erpCode }));
      // audit-state D-288: names, never values
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  };
}
```

## Hooks (Phase B, needs spec 176)

Registered in the module's composition with `ctx.commandHooks([...])`; the example (a custom
`organization.create` hook and the standard `columnExtensionHook` on `organization.admin_patch`) is
`contracts/command-hooks-dependency.md` §3.

## A back-fill migration of its own

```ts
export class Migration20261201T090000AcmeErpBackfillCreditTier extends Migration {
  async up() {
    this.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`);
  }
}
```

Allowed by the guard (own `x_` columns on a declared host). It runs after the generated step,
which is at the head of `acme_erp`'s block.

## Operator view

```bash
node dist/db/migrate.js up                 # applies the generated step, verifies
pnpm --filter backend run module:schema-extensions list
curl '/api/v1/admin/organizations/<id>?extensions=acme_erp'
pnpm --filter backend run module:uninstall acme_erp --hard   # columns kept, rows orphaned
pnpm --filter backend run module:schema-extensions drop acme_erp           # plan
pnpm --filter backend run module:schema-extensions drop acme_erp --confirm # drop, audited
```
