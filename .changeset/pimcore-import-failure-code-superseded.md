---
'@endora-commerce/contracts': minor
---

`pimcoreImportFailureCodeSchema` gains a sixth member, `superseded`.

A Pimcore full delivery is a complete snapshot, so when one arrives while another full
delivery is still applying, the arriving one takes the connection's apply claim and the
incumbent stops where it is (owner ruling, 2026-09-01). Until now that takeover was
silent: the superseded run stayed `running` for ever, and nothing on the runs screen
distinguished it from a run that was simply still going.

`superseded` is the code that run now carries. It is the one member of the enum that is
**not a fault** — the delivery did not break, the sender replaced it — so a consumer that
maps failure codes onto an error presentation should give this one a neutral tone:

```ts
const tone: Record<PimcoreImportFailureCode, 'danger' | 'neutral'> = {
  delivery_protocol_error: 'danger',
  apply_failed: 'danger',
  worker_lost: 'danger',
  internal_error: 'danger',
  other_pim_enabled: 'danger',
  superseded: 'neutral',
};
```

A `minor` rather than a `patch`, and which direction breaks is the point: a consumer
*producing* a `PimcoreImportFailureCode` is unaffected, while a consumer *exhausting* one
— a `Record<PimcoreImportFailureCode, …>`, or a `switch` with no `default` — stops
compiling until it names the new member. That is the intended failure: rendering a code
the operator cannot read is what this member exists to prevent.

The value is also the i18n key suffix. `@endora-commerce/mod-pim-pimcore` ships
`runs.failureCode.superseded` in `en` and `pl`; a consumer with a bundle of its own needs
the same key.
