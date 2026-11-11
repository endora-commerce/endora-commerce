// Compiled from src/backend/index.ts.
import { acmeOrganizationColumns } from './columns.js';

export { acmeOrganizationColumns } from './columns.js';
export { syncErpCode } from './sync-erp-code.js';

export const schemaExtensions = [acmeOrganizationColumns];
export const entities = [];

export function registerModule() {}
