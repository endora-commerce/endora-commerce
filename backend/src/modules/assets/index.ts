/**
 * Legacy `assets` module — feature 013 / FR-034 absorbs this module into
 * `assets_library`. This shim re-exports the new entity so any pre-013
 * import path keeps compiling for one release.
 *
 * @deprecated Import directly from `../assets_library/entities/asset.entity.js`.
 */
export { Asset } from '../assets_library/entities/asset.entity.js';
