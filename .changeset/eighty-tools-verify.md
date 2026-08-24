---
'@endora-commerce/contracts': minor
---

Publish two credential-verification ports, so a caller can ask "is this the
right password for this subject" without holding the hash.

New exports:

- `AdminPasswordVerificationPort` — container name `adminPasswordVerificationPort`,
  owner `admin_users`. `verifyPassword(adminUserId, password): Promise<boolean>`.
- `CustomerPasswordVerificationPort` — container name
  `customerPasswordVerificationPort`, owner `customer_accounts`.
  `verifyPassword(customerAccountId, password): Promise<boolean>`.

Both answer `false` for an unknown id rather than throwing, and both are a
lookup by id alone: whether the caller may act as that subject at all is the
session layer's question, asked before this one.

Additive — nothing existing changes shape. `AdminUserRecord` and
`CustomerAccountRecord` still carry no `passwordHash`, and that is what these
ports exist to keep true: the previous caller (a composition root) read the
column off the ORM entity and ran the comparison itself.

`CustomerPasswordVerificationPort` is deliberately neither
`CustomerAuthPort.login` (which mints a session and runs the login side
effects) nor `CustomerPasswordStatePort.passwordSetAt` (which takes no secret).
