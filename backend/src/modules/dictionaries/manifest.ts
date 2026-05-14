// Dictionary module manifest — feature 017 / R10 / T012.
//
// Single contribution: the `dictionary.write` permission code, used by
// every admin endpoint under `/api/v1/admin/dictionary/**`. The bootstrap
// "Platform Administrator" role holds the wildcard `*` permission and
// therefore auto-inherits this code; operators who need a narrower role
// can add `dictionary.write` to a custom role via the existing
// `/api/v1/admin/admin-roles` surface (feature 003).
//
// Reads of the Dictionary registry — both storefront (`/api/v1/dictionary`)
// and the cross-module DictionaryValidator port — DO NOT require this
// permission. They are public service surfaces.

import { defineModuleManifest } from '@b2b/contracts';

export const DICTIONARY_PERMISSIONS = {
  WRITE: 'dictionary.write',
} as const;

export type DictionaryPermission =
  (typeof DICTIONARY_PERMISSIONS)[keyof typeof DICTIONARY_PERMISSIONS];

/**
 * Module-lifecycle manifest (feature 018) — Pass B retrofit. The
 * `dictionaries` schema is platform-foundational (migration 038),
 * owned cross-cuttingly rather than by an install hook, so this entry
 * declares no `installHook`. Its purpose is to register the module's
 * presence in the static registry so other modules (notably `inventory`
 * and `blog`) can declare `dictionaries` as a dependency without the
 * registry warning "depends on … which is not in the static registry".
 */
export const manifest = defineModuleManifest({
  id: 'dictionaries',
  name: 'Dictionary',
  description:
    'Cross-module registry of countries, languages, and currencies — backs every dropdown, validator, and address-form picker on the storefront and admin.',
  version: '1.0.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
});
