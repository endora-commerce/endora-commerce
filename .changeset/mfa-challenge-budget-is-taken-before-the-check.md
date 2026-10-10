---
'@endora-commerce/mod-mfa': patch
---

The second sign-in step checks no more codes per challenge than its budget, however they arrive.

A challenge carries a budget of five codes. The budget was read, the code checked, and the budget
written back afterwards — so codes sent at the same time were all checked against the same unspent
budget: thirty parallel requests had thirty codes checked on one challenge. This applied to
customers and administrators alike; for administrators the account's authentication throttle
bounded it, for customers nothing did.

An attempt is now taken from the budget in one atomic step (a script that counts it and arms the counter's expiry) before the code is looked at. Of any
number of codes sent together exactly five are checked; the rest are refused with
`429 MFA_TOO_MANY_ATTEMPTS` and the challenge is burned; a challenge that is no longer there still answers `400 MFA_INVALID_CHALLENGE`. An attempt that was refused before its
code was checked — the administrator throttle's 429 — is given back, as before.

`ChallengeStore.recordFailedAttempt` is replaced by `takeAttempt` and `returnAttempt`.
