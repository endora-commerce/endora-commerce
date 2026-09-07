/**
 * `@endora-commerce/admin-kit/lib` — The helpers an admin screen calls — the API client, the auth and module-presence
 * contexts, the permission predicate, the page-size preference, formatting and the one
 * `slugify`/fold owner.
 *
 * That sentence was written by Phase 1b and was **not true until P3**: the session cluster
 * stayed in `admin/src` and this barrel published none of it, which is a header describing a
 * package by what it was meant to hold. It holds it now.
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
export { ApiError, apiBaseUrl, apiClient, onUnauthorized } from './api-client.js';
export { toAbsoluteAssetUrl } from './asset-url.js';
export { AuthProvider, useAuth } from './auth.js';
export type { AdminMe, AuthProviderProps } from './auth.js';
export { formatDateTime } from './format.js';
export { formatMoney, localeForCurrency } from './money.js';
export { invoiceEmailNotSentReason, issueInvoiceNotice, sendInvoiceEmailMessage } from './invoice-email-outcome.js';
export type { Translate } from './invoice-email-outcome.js';
export { getModulePresence, ModulePresenceProvider, setModuleActivation, useModulePresence } from './module-presence/index.js';
export type { ModulePresenceContextValue, ModulePresenceProviderProps } from './module-presence/index.js';
export { PAGE_SIZE_OPTIONS } from './page-size-options.js';
export type { PageSizeOption } from './page-size-options.js';
export { readableTextColor, statusBadgeStyle } from './status-color.js';
export { isSurfaceVisible, satisfiesPermission, useSurfaceVisibility } from './surface-visibility.js';
export type { GatedSurface, PermissionRequirement } from './surface-visibility.js';
export { normalize } from './text-normalization.js';
export { usePageSizePreference } from './use-page-size-preference.js';
export { useUnsavedChangesPrompt } from './use-unsaved-changes-prompt.js';
export { cn } from './utils.js';
export { randomUUID } from './uuid.js';
