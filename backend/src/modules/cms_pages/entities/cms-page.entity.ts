/**
 * Legacy entity path — feature 014 absorbs cms_pages into the new `cms`
 * module. This shim re-exports the new entity so the legacy plugin +
 * services keep compiling for one release.
 *
 * @deprecated Import from `../../cms/entities/cms-page.entity.js`.
 */
export { CmsPage } from '../../cms/entities/cms-page.entity.js';
