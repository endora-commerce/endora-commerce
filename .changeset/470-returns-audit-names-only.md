---
'@endora-commerce/mod-returns': minor
---

Issue #470 (D-288) — return-case audit entries hold no amount and no free-text reason. A return case is `@OrgScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

- `return.settled` no longer records `amount`, `charges` (each charge's cap and approved amount), `recomputedDefaults` (line, from, to) or `lineCeilings` (line, default, ceiling). It records `refundedCharges` (charge kinds), `recomputedDefaultItemIds` and `ceilingBoundItemIds` instead. `resolutionType`, `currency`, `settlementState`, `correctiveInvoice` and the withdrawal flags stay.
- `return.status_changed` no longer records `reason`. It records `hasReason`. The reason is still passed to the status events. It is no longer stored anywhere.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new return entries show no amounts, and a status change no longer shows the reason typed with it. See *Return amounts and reasons leave the platform audit log* in the upgrade guide.
