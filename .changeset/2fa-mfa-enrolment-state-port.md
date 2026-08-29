---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-customer-accounts': minor
---

Publish `MfaEnrolmentStatePort`, and make `twoFactorEnabled` the live enrolment.

`activeSubjectIds(subjectType: MfaSubjectType, subjectIds: readonly string[]):
Promise<string[]>` answers which of the given subjects hold an active second
factor, on the `mfaEnrolmentStatePort` container. Batched rather than per row,
because every caller is a list surface; the answer is plain ids, because
`MfaEnrolment` carries the encrypted TOTP secret and no consumer has business
holding it.

New surface on `mfa` — nothing is removed there. A consumer resolves it with
`lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort')` and declares the
edge; both consumers in this repository declare it `degrades-without`, because
`mfa` is deactivatable and a locked consumer binding it would make the operator's
MFA switch a dead one.

**Two mappers gained a required parameter, and that is a breaking change to a
call, not to a wire shape.** `toAdminUserRecord(admin, twoFactorEnabled)` and
`toCustomerAccountRecord(account, twoFactorEnabled)` no longer derive the field
themselves; each package also exports a batching helper
(`toAdminUserRecords` / `toCustomerAccountRecords`, plus
`toOneCustomerAccountRecord`) that takes the reader and does one `mfa` read per
response. The parameter has no default deliberately: it replaces a derivation
that was silently wrong, and a default would let the next call site reintroduce
it. Two service constructors take the reader as a new argument —
`CustomerAccountReadService(emFactory, twoFactorEnrolments)` and
`AdminUserReadService(emFactory, twoFactorEnrolments)`, with the same addition on
`CustomerAccountMemberWriteService`, `CustomerAccountLifecycleWriteService` and
`CustomerAccountAdminSearchService`.

`twoFactorEnabled: boolean` is unchanged on every response and on both published
records; what changed is where the value comes from. It was
`Boolean(x.twoFactorConfirmedAt)` — a column with no writer on either identity
table, whose last non-null writer was the superseded customer TOTP path deleted
on 2026-08-25 — so the field was a provably constant `false`. `/admin-users`
reported no second factor for an administrator who had enrolled an hour earlier,
and `GET /api/v1/me/customer` told a buyer their own account was unprotected
while it was not.

`two_factor_confirmed_at` is now read by nothing on either table. Dropping the
two columns is a separate migration and is not in this change.
