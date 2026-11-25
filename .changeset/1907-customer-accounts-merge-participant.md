---
'@endora-commerce/mod-customer-accounts': minor
---

The membership move and the members of an Organization merge (issue #1907).

- New port `membershipPort` (`changeOrganization`, `changeCommand`): moves a customer account to
  another organization as one audited, hookable Command, `customer_account.organization.change`
  (declared hookable for `beforeCommit` and `afterCommit`), publishing
  `customer_account.organization_changed.v1`. Mode `move`: the target's Member role by default, and
  the last active administrator of a company may not leave (`409 ORG_OWNER_DEPLETION`). Mode
  `merge`: only inside the running merge that moves the account, with the role the merge's role map
  names, exempt from the last-administrator refusal. No permission is checked; the caller is the gate.
- In an Organization merge the duplicate's members — removed and blocked ones included — move to the
  organization that stays in the `members` phase, one membership Command per account.
