---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-auth': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-organizations': patch
---

More credential changes withdraw the sessions and pending sign-ins obtained before them.

- **`admin_users create` run again for an existing account** replaces the password, so it now
  ends every session of that account and withdraws its pending second-factor challenges and
  setup tickets, through the same path as a peer reset. The write is audited as
  `admin_user.change_password` with `via: 'cli'` and no acting administrator. Creating a new
  account is unchanged.
- **Removing a second factor.** Disabling your own two-factor authentication
  (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`) ends every other
  session of the account and keeps the one the request was made from. An administrator's reset of
  a customer's second factor (`POST /api/v1/admin/customers/:customerId/mfa/reset`, and the bulk
  route for each account it actually resets) ends every session of that customer. Both withdraw
  the account's pending challenges and setup tickets. Enrolling a factor ends no session, and a
  disable or reset that removes nothing ends none either.
- **Customer password change** (`POST /api/v1/me/customer/change-password`,
  `POST /api/v1/me/password`) ends every other session of the account and keeps the calling one.
  **Redeeming a reset token** (`POST /api/v1/auth/password-reset/confirm`) ends all of them. Both
  mark every other outstanding reset token of the account as consumed and withdraw its pending
  second-factor challenges and setup tickets.

In every case the new state is persisted first and the sessions are revoked after it.

Port changes, all additive: `AuthSessionPort.destroyAllForCustomer` takes an optional
`{ exceptSessionId }` (`AuthDestroyAllForCustomerOptions`), mirroring `destroyAllForAdmin`;
`CustomerAuthPort.changePassword` takes an optional fourth argument
`{ sessionCookieValue }` (`CustomerChangePasswordContext`) naming the session to keep — a caller
that omits it keeps none. No port member was removed or changed incompatibly.

Not ports, but changed for anyone constructing these classes directly: `PasswordResetService`'s
constructor takes the session port as its second argument (the audit port moved to third), and
`MfaEnrolmentService.disable` returns whether a factor was removed.
