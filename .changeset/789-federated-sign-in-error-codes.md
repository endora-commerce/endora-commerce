---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-customer-accounts': patch
---

The customer federated sign-in redirect contract changes (issue #789). A refused customer sign-in is now sent back to `/login?error=<code>` with a code from the new `federatedSignInErrorCodeSchema` / `FederatedSignInErrorCode` in `@endora-commerce/contracts`. It no longer carries an English sentence. The codes are `unknown_provider`, `provider_unavailable`, `sign_in_cancelled`, `sign_in_expired`, `sign_in_failed`, `email_unverified`, `no_matching_account`, `account_blocked`, `registration_disabled_in_channel`, `mfa_setup_required`, `sales_channel_sign_in_required` and `sales_channel_not_permitted`.

A storefront that matched the old sentences must map these codes and treat any other value as its generic sign-in failure. `registration_disabled_in_channel` is new. It replaces "No account found. Please create an account first." for a sign-up refused because the sign-in channel does not allow registration (`customers.allow_registration_without_organization` off). In `@endora-commerce/mod-mfa`, `SocialSignInResult`'s `registration_required` reason is renamed `registration_disabled_in_channel`. The Admin UI surface still receives its sentences, unchanged.
