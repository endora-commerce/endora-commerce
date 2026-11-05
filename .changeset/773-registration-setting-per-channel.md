---
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-customer-accounts': minor
---

`customers.allow_registration_without_organization` is now read for the request's sales channel (issue #773). `POST /api/v1/customers/register` and `GET /api/v1/storefront/settings/customer-registration` (through `CustomerRegistrationService.allowsStandalone()`) resolve the value set for the channel the request resolves to, then the all-channels value, then the manifest default (`false`). Until now both read the system-default channel's value and applied it to every channel, so a value set only for another channel had no effect.

**Behaviour change on upgrade.** An installation that enabled the setting only for its default channel had B2C registration on every channel; after this release it has it only on the default channel, and its other channels refuse standalone registration with `REGISTRATION_REQUIRES_ORGANIZATION`. To keep the previous behaviour, set the value for all channels, or for each channel that should offer it, on the admin settings screen.

**Federated sign-up (`mod-customer-accounts`).** A first sign-in through an external identity provider (`GET /api/v1/auth/customer/oauth/:provider/callback`) creates an account through `customerSocialLoginPort.autoCreate`, which now reads the same setting for the channel the sign-in was started on (the channel `SocialIdentityService` carries out of the OAuth transaction) instead of the system-default channel. Where the setting is off for that channel the sign-in answers `registration_required` and creates no account; a caller that names no channel gets no account either. The same upgrade note applies: federated sign-up stops on every channel that does not have the setting on.

**Outside a request** (no resolved sales channel), the `mod-customers` registration gate now answers `false` rather than the system-default channel's value. `customers.deletion_retention_days` and `customers.presence_freshness_minutes` still read the system-default channel.
