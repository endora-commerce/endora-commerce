---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The admin dashboard shows its numbers on the first visit.

After signing in, or after reloading the page on `/`, the four KPI tiles read "—" and the stock
alerts card read "No products are currently low on stock" until the operator opened another screen
and came back. `HomePage` decided which requests to send once, when it mounted, and it mounts in the
same render as `ModulePresenceProvider` — which answers "absent" for every module until its first
response arrives. So every request was skipped, and nothing went back for them when the answer
changed.

- **Each tile and the stock alerts card now owns its request**, and sends it when it is first
  shown. A surface belonging to a module that is off, or to a permission the role does not hold,
  still costs no request.
- **A tile says what state its number is in.** A placeholder while the request is pending, and a
  message with a *Retry* button when it fails — where it used to keep the same "—" for both and for
  a response that carried no number.
- **The stock alerts card no longer reports a failure as an empty warehouse.** It has its own
  loading and error states; "No products are currently low on stock" is shown only when the
  request succeeded and returned none.

Seven strings are added to the `core` bundle, in English and Polish: `home.kpi.error`,
`home.kpi.loading`, `home.kpi.retry`, `home.kpi.retryLabel`, `home.stockAlerts.error`,
`home.stockAlerts.loading` and `home.stockAlerts.retry`.
