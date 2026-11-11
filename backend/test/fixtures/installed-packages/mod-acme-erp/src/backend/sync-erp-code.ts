import {
  columnExtensionPatchSchema,
  extensionColumns,
  type ColumnExtensionValues,
} from '@endora-commerce/platform/kernel';
import type { Command } from '@endora-commerce/platform/commands';
import { acmeOrganizationColumns } from './columns.js';

/** What the module reads back: `{ erpCode: string | null; creditTier: number; onboardedVia: string | null }`. */
export type AcmeOrganizationColumns = ColumnExtensionValues<typeof acmeOrganizationColumns>;

/** The ERP sync writes one column, inside a Command, so the write is audited (names only). */
export function syncErpCode(organizationId: string, erpCode: string): Command<void> {
  return {
    action: 'acme_erp.organization.sync',
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, em).set(
        organizationId,
        columnExtensionPatchSchema(acmeOrganizationColumns).parse({ erpCode }),
      );
      // audit-state D-288: names, never values.
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  };
}
