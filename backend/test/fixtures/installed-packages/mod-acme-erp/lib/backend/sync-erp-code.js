// Compiled from src/backend/sync-erp-code.ts.
import { columnExtensionPatchSchema, extensionColumns } from '@endora-commerce/platform/kernel';
import { acmeOrganizationColumns } from './columns.js';

export function syncErpCode(organizationId, erpCode) {
  return {
    action: 'acme_erp.organization.sync',
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, em).set(
        organizationId,
        columnExtensionPatchSchema(acmeOrganizationColumns).parse({ erpCode }),
      );
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  };
}
