---
'@endora-commerce/admin-kit': minor
---

`ListPage` takes three optional additions (issue #1749), so the lists that refresh over their own rows can use it:

- `busy` — a refresh over rows already on screen. The rows stay, the results region is `aria-busy` and the count's live region says *Loading…*. `load: { kind: 'loading' }` still draws the skeleton, for the first load.
- `resultsRef` — a ref to the results region, which then takes `tabIndex={-1}`, for a screen that moves focus to the results.
- `ListPageLoad`'s `error` variant takes `action`, a way out shown in place of *Retry* (for example *Remove filter* when the server refuses a filter).

Existing callers are unaffected.
