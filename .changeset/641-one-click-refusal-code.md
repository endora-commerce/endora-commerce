---
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/contracts': patch
---

One-click buy refused by the operator setting or the buyer's defaults has an error code of its own
instead of `VALIDATION_FAILED`, and a sentence in English and Polish for each reason (issue #641,
part of #86). **A caller that matches on `VALIDATION_FAILED` or on
`details.code: "one_click_unavailable"` for this refusal now sees the specific code.** The HTTP
status is unchanged. Until now it was answered with the English *"One-click buy is not
available."* in every language, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/quick-order/one-click` (setting off for the channel) | `422 VALIDATION_FAILED`, `details: { code: "one_click_unavailable", reason: "setting_disabled" }` | `422 ONE_CLICK_UNAVAILABLE` | `code: "setting_disabled"`, `reason: "setting_disabled"` |
| `POST /api/v1/quick-order/one-click` (a default is missing or not offered in the channel) | `422 VALIDATION_FAILED`, `details: { code: "one_click_unavailable", reason: "missing_defaults" }` | `422 ONE_CLICK_UNAVAILABLE` | `code: "missing_defaults"`, `reason: "missing_defaults"` |

`details.code` is now the eligibility reason, so each reason reads as its own sentence, and
`details.reason` keeps the value a client may already branch on. `ONE_CLICK_UNAVAILABLE` is a
member of `ERROR_CODES` in `@endora-commerce/contracts` and the `quick_order` manifest's first
declared code, with the tokens `setting_disabled` and `missing_defaults`. The storefront's cart page
names the new code and both reasons where the product page's one-click action lands. The module's
documentation page names the code. No setting, permission or migration changes.
