---
'@endora-commerce/mod-mfa': minor
'@endora-commerce/contracts': minor
---

Issue #935 — an account's last second factor can no longer be switched off while a two-step requirement is in force for it.

- `POST /api/v1/admin/account/mfa/disable` and `POST /api/v1/account/mfa/disable` answer `409 MFA_LAST_FACTOR_REQUIRED` when the factor is the account's last one and a requirement applies: `mfa.admin.totp_enforced` or a role's `requiresTwoFactor` for an administrator, `mfa.storefront.totp_enforced` at the request's sales channel or the organization's policy for a customer. The requirement is read through `MfaPolicyResolver`, the reader the sign-in decision uses, so every source counts as it does at sign-in and none is stricter. The refusal comes before the code or password is checked, so it spends neither. Without `MFA_SECRET_ENCRYPTION_KEY` no requirement is in force (#930, #947, #948) and nothing is refused.
- `@endora-commerce/contracts` exports `ERROR_CODES.MFA_LAST_FACTOR_REQUIRED`, and `mfaStatusResponseSchema` gains `canDisable: boolean` and `disableBlockedReason` (`mfaDisableBlockedReasonSchema`, `'factor_required'` or `null`), the verdict the disable route enforces.
- `mfa` declares the code in its manifest and ships its sentence in EN and PL (`errors.MFA_LAST_FACTOR_REQUIRED`). The admin **Account security** screen hides the switch-off form while it is refused and says why (`security.disableBlocked.title`, `security.disableBlocked.body`); so does the storefront's account security page.
- `MfaEnrolmentService.countActiveFactors(subject)` answers how many active second factors the subject holds.

**Behaviour change on upgrade.** Switching one's own two-step verification off is refused where it used to succeed: for an administrator or a customer bound by one of the requirements above. An administrator's reset of somebody else's factor is unchanged. See *The last second factor stays while two-step verification is required* in the upgrade guide.
