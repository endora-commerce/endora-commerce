---
'@endora-commerce/platform': minor
---

Issue #349 — `POST /api/v1/admin/modules/mfa/activation` also refuses switching `mfa` off while any admin role requires two-step verification. `MFA_DEACTIVATION_BLOCKED` keeps its code and its sentence when only `mfa.admin.totp_enforced` requires it; `details` gains `roleCodes: string[]`, and when roles require it `details.roles` (the codes as text) and `details.code` (`role_requirement` or `setting_and_role_requirement`) pick and fill a sentence naming them.
