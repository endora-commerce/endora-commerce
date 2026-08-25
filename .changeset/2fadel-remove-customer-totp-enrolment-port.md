---
'@endora-commerce/contracts': major
---

Removed `CustomerTotpEnrolmentPort` and `CustomerTotpEnrolmentResult`.

The `totpEnrolmentService` port they described has no provider any more:
`customer_accounts` no longer registers it, and the three routes that resolved it —
`POST /api/v1/me/two-factor/{enable,confirm,disable}` — are gone. They could never
succeed. `enable` wrote a 682-character `secret|<10 sha256 hashes>` string into
`customer_accounts.two_factor_secret`, a `varchar(64)`, on which PostgreSQL raises
`22001` rather than truncating, so the route answered 500 for every customer from the day
it was written; `confirm` and `disable` refused with 400 and 409 for the same reason, an
enrolment never being storable.

**If you named either type**, there is no replacement port and no replacement HTTP path.
Customer two-factor authentication is the `mfa` module's, over `/api/v1/account/mfa/*` —
setup, confirm, disable, status and recovery codes — with the secret encrypted at rest,
a replay guard and single-use recovery-code rows.

```diff
-import type { CustomerTotpEnrolmentPort } from '@endora-commerce/contracts';
-const totp = lazyPort<CustomerTotpEnrolmentPort>(ctx, 'totpEnrolmentService');
-await totp.enable(customerAccountId);
+// No port. Direct the caller at the `mfa` module's own self-service routes:
+// POST /api/v1/account/mfa/setup, /confirm, /disable.
```

`customer_accounts.two_factor_secret` and `admin_users.two_factor_secret` are dropped with
them. `two_factor_confirmed_at` stays on both tables, so `CustomerAccountRecord`,
`AdminUserRecord` and every response carrying `twoFactorEnabled` are unchanged.
