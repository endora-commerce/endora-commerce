---
'@endora-commerce/mod-newsletter': minor
---

Issue #470 (D-288) — subscriber audit entries hold no e-mail address and no free-text reason. A subscriber is `@CustomerScoped`, and the platform audit log is read under `audit_log:read` without that reach.

- `newsletter_subscribe` / `newsletter_resubscribe` no longer record `email`. They keep `status` and `source`.
- `newsletter_unsubscribe` records `hasReason` instead of `reason`. The reason stays on the subscriber (`unsubscribeReason`) and its suppression.
- A bounce or complaint suppression records only the reason code.
- `newsletter_delete` records the subscriber's `status` instead of its `email`.
- Entries name the subscriber by `objectId`. A suppression of an address with no subscriber still uses the address as `objectId`, unchanged.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new newsletter entries show no addresses or reasons. See *Subscriber addresses leave the platform audit log* in the upgrade guide.
