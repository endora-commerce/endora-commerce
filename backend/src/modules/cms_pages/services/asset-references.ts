/**
 * Legacy path — feature 014 / T032. The CMS asset-references descriptor
 * has been moved to `backend/src/modules/cms/services/asset-references.ts`
 * and rewritten to scan the new shape (content per language) plus the
 * legacy body column. This shim re-exports the new function so any
 * pre-014 import keeps compiling.
 *
 * @deprecated Import from `../../cms/services/asset-references.js`.
 */
export { registerCmsAssetReferences } from '../../cms/services/asset-references.js';
