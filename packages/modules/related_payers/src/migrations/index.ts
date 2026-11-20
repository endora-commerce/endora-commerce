/**
 * The `./migrations` subpath — every migration class this module owns, as one ordered
 * `migrations` array (D-168), plus the named classes the generated registry imports.
 * Where this block runs relative to other modules' is decided by the manifest
 * `dependencies` graph; this module references no other module's table.
 */

import { Migration20261118T144820RelatedPayersLinksAndRequests } from './20261118T144820_related_payers_links_and_requests.js';

export const migrations = [Migration20261118T144820RelatedPayersLinksAndRequests];

export { Migration20261118T144820RelatedPayersLinksAndRequests };
