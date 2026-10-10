---
'@endora-commerce/platform': minor
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-customer-accounts': patch
---

Sign-in does the same password-hash work whether or not the address belongs to an account.

Administrator and customer sign-in looked the account up first and verified the password only when
there was one. An address nobody holds, a deleted customer and an inactive administrator were
therefore refused tens of milliseconds sooner than a wrong password for a real account, and the
difference told a caller which addresses have an account. Both now verify the submitted password
once in every case — against a dummy hash made once per process with the parameters of a stored
hash when there is no usable account — and answer exactly as for a wrong password.

`@endora-commerce/platform/kernel` exports `verifyPasswordOrDummy(hash, password)` for this.

**Behaviour change for customer sign-in.** `403 ACCOUNT_BLOCKED` used to be answered before the
password was looked at, so it told anybody that the address has an account and that it is blocked.
It is now answered only when the password is correct; a wrong password for a blocked account is
`401 INVALID_CREDENTIALS` like any other.
