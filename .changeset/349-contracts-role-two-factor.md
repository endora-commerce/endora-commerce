---
'@endora-commerce/contracts': minor
---

Issue #349 — the contract side of enforcing `AdminRole.requiresTwoFactor` at administrator sign-in.

- `ERROR_CODES.MFA_REQUIRED_FOR_ROLE_TWO_FACTOR` (409): a role write turned `requiresTwoFactor` on where no second factor can be enrolled. `details.reason` is `mfa_off` or `encryption_key_missing`. A consumer switching exhaustively over `ErrorCode` has one more case.
- `MfaDeactivationGuardPort.isAdminSecondFactorRequired()` now means "a second factor is required of any administrator", by the setting `mfa.admin.totp_enforced` **or** by any role's flag; same signature. The port gains a `requirement()` method answering `MfaAdminSecondFactorRequirement` (`{ setting, roleCodes }`), so a caller can name what to turn off; an implementer of the port must add it.
- New port `MfaAdminEnforcementPort` (container name `mfaAdminEnforcementPort`, owner `mfa`): `endUnprotectedAdminSessions(adminUserIds, options)`, `countUnprotected(adminUserIds)` and `canEnforceAdminSecondFactor()`, with `MfaEndUnprotectedAdminSessionsOptions` and `MfaAdminEnforcementTrigger`.
- `adminRoleWriteResultSchema` / `AdminRoleWriteResult`: the role write's answer, the role plus `signedOutAdministrators`. `adminRoleTwoFactorImpactSchema` / `AdminRoleTwoFactorImpact`: `{ unprotectedAdministrators: number | null }`.
- `adminRoleSchema.requiresTwoFactor` and `upsertAdminRoleRequestSchema.requiresTwoFactor` carry a description saying who reads the flag and when, and the `AdminRolePort` / `AdminRoleRecord` docblocks no longer claim that `admin_users` enforces it.
