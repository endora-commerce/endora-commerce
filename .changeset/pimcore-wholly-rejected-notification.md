---
'@endora-commerce/mod-pim-pimcore': minor
---

Notify administrators when a Pimcore **full** delivery rejects every record it
accepted (FR-164, owner ruling of 2026-09-01).

`PIMCORE_DELIVERY_WHOLLY_REJECTED_NOTIFICATION_KIND`
(`pim_pimcore.delivery_wholly_rejected`) is a **distinct** kind from
`pim_pimcore.run_failed` and deliberately not a widening of it: FR-107's subject
is a fault, and here nothing broke — the records were rejected according to the
rules the operator configured, and the run's outcome is the finished-while-
rejecting one, never `failed`. A wholly-rejected delivery raises no run-failed
entry, and FR-107's rule that residual per-record issues must not each notify is
untouched.

The trigger is exactly 100% and is never lowered to a threshold. It is silent
for a full delivery that accepted no record, for an incremental (live) delivery
whatever proportion of its records failed, for a delivery whose records applied
— including one whose every field was protected — and for a delivery a newer
full delivery superseded under FR-163. It goes through the same
presence-aware recorder as the run-failed notification, so an absent
`admin_notifications` skips the notify and leaves the run's outcome, counts and
issues exactly as they would otherwise be.

It stores nothing: no column, no enum member, no migration. The decision is
counted off the delivery's own records — no record applied and at least one was
rejected — rather than off its counters, which a concurrent ingress batch
advances.

**Raised at both of a full delivery's terminal sites**, which is a correction to
the handover rather than an extension of it: `complete` finding every record
already terminal is the *usual* order in production, because the apply worker
drains records as the batches arrive, and wiring the trigger only to the last
record landing after `complete` would have made it fire on a race rather than on
the requirement.

Consecutive wholly-rejected full deliveries notify **each time** — the plain
reading of the ruling, which deliberately left that question open. No
suppression is added here.

Operator strings ship in the module's `i18n/en.json` and `i18n/pl.json`.
