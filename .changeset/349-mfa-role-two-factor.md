---
'@endora-commerce/mod-mfa': minor
---

Issue #349 — `AdminRole.requiresTwoFactor` is enforced at administrator sign-in. `MfaPolicyResolver` adds the role's flag to `mfa.admin.totp_enforced`, so password sign-in, Google and Microsoft sign-in and the self-service status (`totpEnforcedForScope`) all apply it. A role that cannot be read counts as requiring a second factor.

- `mfa` now depends on `admin_roles` (`nonDeactivatable`, no dependencies of its own, so no operator flip is affected).
- `mfaDeactivationGuardPort` blocks switching `mfa` off while any role sets the flag, and names the roles (`errors.MFA_DEACTIVATION_BLOCKED.role_requirement` and `.setting_and_role_requirement`, EN and PL).
- New port `mfaAdminEnforcementPort`: ends the sessions and pending logins of administrators a requirement newly binds who have no active enrolment, audited as `mfa.admin_sessions_ended_for_requirement`.
- Without `MFA_SECRET_ENCRYPTION_KEY`, a warning is logged at every boot naming each role that requires a second factor and how many of its administrators have none.

**Behaviour change on upgrade.** An operator may have ticked a role's two-step verification box believing it already worked. After the upgrade, each holder of such a role who has not set up two-step verification is asked to set it up at their next sign-in, and an enrolled holder is challenged. The upgrade signs nobody out. Switching `mfa` off is refused while any role sets the flag. Without an encryption key such holders cannot finish setup: untick the box on those roles before upgrading, or set the key. See *A role's two-step verification requirement is enforced* in the upgrade guide.
