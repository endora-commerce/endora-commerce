/**
 * Resolving a permission label — feature 091, Phase 3.
 *
 * `/admin-roles` renders one row per grantable code and translates it through
 * `adminRoles.permission.<code>`. That key used to be looked up in exactly one
 * namespace, the synthetic `core` that `_i18n`'s bundle is served under, and
 * that is what made a module owning its own labels impossible: a module's
 * bundle is served under the module's own id, so a label written there was
 * **read by nobody**.
 *
 * It was not hypothetical. `mfa`, `pwa`, `stripe` and `prompt_actions` each
 * shipped their permission labels in their own bundle *and* in `_i18n`'s, and
 * the copy in their own bundle had never rendered — the screen took `core`'s.
 * Four authors did the right thing and the platform silently ignored it.
 *
 * So the lookup is over the merged bundle rather than over one namespace:
 * `core` first, because that is where the legacy block still lives and a
 * migrating label must not flicker between two answers, then the module
 * namespaces. The key carries the permission code, which is unique across the
 * catalogue, so a namespace scan cannot collide two different labels — and
 * which module may write one is a question for the ratchet in
 * `backend/test/helpers/permission-labels.ts`, not for the renderer. Being
 * permissive here and strict there is deliberate: the alternative is resolving
 * by the catalogue row's `module` field, which is a **display grouping** and is
 * `module_lifecycle` for a module whose id is `_lifecycle`.
 */
import { resolve } from '@endora-commerce/admin-kit/i18n';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';

/** The key `/admin-roles` builds for every catalogue row. */
export const PERMISSION_LABEL_PREFIX = 'adminRoles.permission.';

/** The namespace `_i18n`'s bundle is served under — the legacy block's home. */
export const LEGACY_PERMISSION_LABEL_SCOPE = 'core';

/**
 * The namespace that carries `key`, preferring the legacy block, or `null`.
 *
 * Sorted, so two bundles that both carried the key would resolve to the same
 * one on every render rather than to whichever the server serialised first.
 */
export function scopeCarrying(bundle: Bundle | undefined, key: string): string | null {
  if (bundle === undefined) return null;
  if (bundle[LEGACY_PERMISSION_LABEL_SCOPE]?.[key] != null) {
    return LEGACY_PERMISSION_LABEL_SCOPE;
  }
  const carrying = Object.keys(bundle)
    .filter((scope) => bundle[scope]?.[key] != null)
    .sort();
  return carrying[0] ?? null;
}

export interface PermissionLabelArgs {
  readonly code: string;
  /** The manifest `label` — English-only, and the last resort. */
  readonly fallbackLabel: string;
  readonly language: SupportedAdminLanguage;
  readonly bundle: Bundle;
  readonly fallbackBundle?: Bundle | undefined;
}

/**
 * The label for one permission code: the operator's language, then English,
 * then the manifest label the API already sent.
 */
export function resolvePermissionLabel(args: PermissionLabelArgs): string {
  const key = `${PERMISSION_LABEL_PREFIX}${args.code}`;
  const scope = scopeCarrying(args.bundle, key) ?? scopeCarrying(args.fallbackBundle, key);
  if (scope === null) return args.fallbackLabel;
  const result = resolve({
    scope,
    key,
    language: args.language,
    bundle: args.bundle,
    ...(args.fallbackBundle !== undefined ? { fallbackBundle: args.fallbackBundle } : {}),
  });
  return result.outcome === 'placeholder' ? args.fallbackLabel : result.value;
}
