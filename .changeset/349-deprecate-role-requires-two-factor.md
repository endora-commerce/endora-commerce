---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-i18n': patch
---

The per-role "requires two-step verification" flag is deprecated (#349). `AdminRole.requiresTwoFactor` was stored and editable but nothing read it at sign-in, so ticking it never required a second factor. The *Roles* screen no longer offers the checkbox (and the `adminRoles.field.requires2fa` message is gone); a save from the screen no longer sends the field, so the stored value is kept. The contract fields stay and are marked `@deprecated`, and the API is unchanged. To require two-step verification for administrators, switch on `mfa.admin.totp_enforced`, which applies platform-wide. The field and its column are removed in the next breaking release.
