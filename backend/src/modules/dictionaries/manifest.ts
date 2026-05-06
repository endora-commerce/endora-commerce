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

export const DICTIONARY_PERMISSIONS = {
  WRITE: 'dictionary.write',
} as const;

export type DictionaryPermission =
  (typeof DICTIONARY_PERMISSIONS)[keyof typeof DICTIONARY_PERMISSIONS];
