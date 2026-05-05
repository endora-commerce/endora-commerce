/**
 * Legacy `cms_pages` module barrel — feature 014 absorbs this into the
 * new `cms` module. Kept as a thin shim so any pre-014 import path keeps
 * compiling for one release.
 *
 * @deprecated Import from `../cms/...` instead.
 */
export { CmsPage } from './entities/cms-page.entity.js';
