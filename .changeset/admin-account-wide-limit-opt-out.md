---
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/cli': patch
---

An instance can switch the account-wide administrator password limit off, by environment variable.

The account-wide limit — twenty wrong passwords for one account from all addresses that are not a
known device — assumes the password is a secret. On an instance that publishes an administrator
password on purpose, a public demo, every visitor is a first-time device, so anybody could keep all
of them out of the account with twenty wrong passwords and a few more each half hour.

`ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` in the backend's environment switches off the account-wide
count of wrong **passwords** and nothing else: the limit per address on one account, the limit per
known device, both limits on second-factor codes and the delays are unchanged, and an attempt that
arrives with no client address is still counted for the account. It is read once at start, it is
not a Setting and cannot be changed from the Admin UI, and while it is off the backend logs
`account-wide administrator attempt limit is OFF — intended for demo instances with published
credentials` on every start. Any value other than `off` leaves the limit on.

Do not set it on an instance whose administrator passwords are not public. Without the variable
nothing changes.

A scaffolded instance can set it too: the compose file `endora new instance` writes forwards
`ADMIN_AUTH_ACCOUNT_WIDE_LIMIT` to the backend, and its `.env.example` lists it, empty.
