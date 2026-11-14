---
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/contracts': patch
---

A routing write that changes the numbering mode without `confirm: true` is refused with an error
code of its own instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #644,
part of #86). **A caller that matches on `VALIDATION_FAILED` for this refusal now sees the specific
code.** The HTTP status is unchanged. Until now the answer was the English *"Confirm the numbering
mode change."* in every language.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `PUT /api/v1/admin/invoice-ledger/routing` (the submitted `numberingMode` differs from the stored one and `confirm` is not `true`) | `400 VALIDATION_FAILED`, *"Confirm the numbering mode change."* | `400 INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED` | `field: "confirm"`, `from` (stored mode), `to` (submitted mode) |

The sentence does not name the modes; they travel as `details.from` and `details.to`. An override
naming an unknown sales channel stays `VALIDATION_FAILED`. The code is a member of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `invoice_ledger` manifest, and the module's
documentation page names it. No setting, permission or migration changes.
