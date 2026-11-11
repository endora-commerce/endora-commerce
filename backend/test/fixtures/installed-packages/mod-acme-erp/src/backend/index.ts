import { acmeOrganizationColumns } from './columns.js';

export { acmeOrganizationColumns } from './columns.js';
export { syncErpCode, type AcmeOrganizationColumns } from './sync-erp-code.js';

/** Read by the platform beside `entities` (`specs/178-extensible-columns/` FR-008). */
export const schemaExtensions = [acmeOrganizationColumns];
export const entities = [];

/** The module's composition; the worked example registers nothing else. */
export function registerModule(): void {}
