---
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-currencies': minor
'@endora-commerce/mod-languages': minor
'@endora-commerce/contracts': patch
---

Creating a country, currency or language whose code exists, and making an inactive one the
default, have error codes of their own instead of `VALIDATION_FAILED`, and a sentence in English and
Polish (issue #643, part of #86). **A caller that matches on `VALIDATION_FAILED` for these refusals
now sees the specific code.** The HTTP status is unchanged. Until now each was answered with an
English sentence in every language, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/dictionary/countries` (code exists) | `409 VALIDATION_FAILED`, *"Country XX already exists."* | `409 DICTIONARY_ENTRY_CODE_TAKEN` | `code: "country"`, `entryCode` |
| `POST /api/v1/admin/dictionary/countries/:code/default` (inactive) | `409 VALIDATION_FAILED`, *"Cannot mark an inactive country as default."* | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "country"`, `entryCode` |
| `POST /api/v1/admin/dictionary/currencies` (code exists) | `409 VALIDATION_FAILED`, *"Currency XXX already exists."* | `409 DICTIONARY_ENTRY_CODE_TAKEN` | `code: "currency"`, `entryCode` |
| `POST /api/v1/admin/dictionary/currencies/:code/default`, `POST /api/v1/admin/currencies/:code/default` (inactive) | `409 VALIDATION_FAILED`, *"Cannot mark an inactive currency as default."* | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "currency"`, `entryCode` |
| `POST /api/v1/admin/dictionary/languages` (code exists) | `409 VALIDATION_FAILED`, *"Language xx already exists."* | `409 DICTIONARY_ENTRY_CODE_TAKEN` | `code: "language"`, `entryCode` |
| `POST /api/v1/admin/dictionary/languages/:code/default`, `POST /api/v1/admin/languages/:code/default` (inactive) | `409 VALIDATION_FAILED`, *"Cannot mark an inactive language as default."* | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "language"`, `entryCode` |

`details.code` is a token naming the dictionary, and each token has its own sentence. The entry's
own code travels as `entryCode`, because the envelope reads `details.code` as the token. Both codes
are members of `ERROR_CODES` in `@endora-commerce/contracts` and are declared once, by the
`dictionaries` manifest, which owns the `DICTIONARY_*` family the three dictionaries share;
`currencies` and `languages` raise them. The documentation pages of all three modules name them.
The `decimalPlaces` range refusal of a currency update stays `VALIDATION_FAILED`. No setting,
permission or migration changes.
