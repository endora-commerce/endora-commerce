# Contract: error codes

Each new code lands **in one commit** with: its `ERROR_CODES` member (`packages/contracts/src/errors.ts`), its
`MINTED_ERROR_CODES` entry (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), the owner manifest's
`errorCodes`, `errors.<CODE>` in the owner's `i18n/en.json` **and** `pl.json`, and the `composer:generate` output
(the rule of 163's `contracts/error-codes.md`).

| Code | Owner | HTTP | Raised by | `details` |
| --- | --- | --- | --- | --- |
| `FIELD_NOT_AT_SCOPE` | catalog | 422 | a write naming a field at a scope outside its set (FR-012), incl. a C×L write of audience / window / MOQ / returnable / non-text attribute | `{ fields: [{ field, levels: ('G'\|'C'\|'CL')[] }] }` |
| `SCOPED_VALUE_INVALID` | catalog | 422 | `validateScopedWrite` refusals in the save, copy, PATCH scopes and the scope write port (FR-062, FR-113) | `{ fields: [{ field, scope, reason: 'required_empty' \| 'not_emptyable' \| 'inherit_at_global' \| 'source_inherits' \| 'subject_not_found' \| 'not_supported' \| 'invalid' }] }` |
| `GLOBAL_ONLY_FIELD` | catalog | 422 | `changes.product` outside Global (FR-081) | `{ fields: string[] }` |
| `IMPORT_PROFILE_REQUIRED` | import_export | 422 | products import without `profileId` (FR-048) | none |
| `IMPORT_PROFILE_NOT_FOUND` | import_export | 404 | profile routes, import | `{ profileId }` |
| `IMPORT_PROFILE_NAME_TAKEN` | import_export | 409 | profile create / rename | `{ name }` |

Reused unchanged: `VALIDATION_FAILED` (a Language-only scope, FR-010; `details.field = 'scope'`), `SCOPE_INVALID`,
`SCOPE_INCOMPLETE`, `URL_KEY_TAKEN` / `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` (details now carry `channelId` and
`languageCode: string | null` per conflict instead of `languageCode` alone), `VERSION_CONFLICT`,
`MODULE_DISABLED`.

Non-envelope report codes (CSV / connector reports, no `ERROR_CODES` entry): `IMPORT_CELL_CONFLICT`,
`unmapped_locale` (warning), `not_a_member` / `language_not_offered` (skipped targets), and the
`ScopedWriteRefusal` values per field.
