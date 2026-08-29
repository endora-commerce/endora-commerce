/**
 * `@endora-commerce/admin-kit/lib` — The helpers an admin screen calls — the API client, the auth and module-presence
 * contexts, the permission predicate, formatting and the one `slugify`/fold owner.
 *
 * The membership is **derived, never designed**
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` §1): every
 * `from '…'` specifier in the admin's module directories that resolves inside the admin
 * source root and outside the importing file's own module directory, plus the transitive
 * closure of those files, which is what has to live in one place for there to be one copy.
 *
 * The barrel is **explicit and holds no `export *`** (R2): a short published set reports
 * more findings than a complete one, and its obvious repair is to widen the barrel
 * silently. `check:admin-surface` refuses one and exits 2.
 *
 * Every binding here is the **only** copy in the process. `admin/src` keeps a re-export
 * shim at each old path, so a `@/…` specifier and this subpath name one module record —
 * proved by reference equality in `admin/test/kit/admin-kit-shims.test.ts`, not by a
 * structural comparison, which a second React context would pass.
 */
export { resolveIcon } from './admin-actions/icon-map.js';
export { ApiError, apiClient, onUnauthorized } from './api-client.js';
export { formatDateTime } from './format.js';
export { formatMoney, localeForCurrency } from './money.js';
export { PAGE_SIZE_OPTIONS } from './page-size-options.js';
export type { PageSizeOption } from './page-size-options.js';
export { normalize } from './text-normalization.js';
export { useUnsavedChangesPrompt } from './use-unsaved-changes-prompt.js';
export { cn } from './utils.js';
export { randomUUID } from './uuid.js';
