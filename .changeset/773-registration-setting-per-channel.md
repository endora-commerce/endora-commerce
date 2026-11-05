---
'@endora-commerce/mod-customers': minor
---

`customers.allow_registration_without_organization` is now read for the request's sales channel (issue #773). `POST /api/v1/customers/register` and `GET /api/v1/storefront/settings/customer-registration` (through `CustomerRegistrationService.allowsStandalone()`) resolve the value set for the channel the request resolves to, then the all-channels value, then the manifest default (`false`). Until now both read the system-default channel's value and applied it to every channel, so a value set only for another channel had no effect.

**Behaviour change on upgrade.** An installation that enabled the setting only for its default channel had B2C registration on every channel; after this release it has it only on the default channel, and its other channels refuse standalone registration with `REGISTRATION_REQUIRES_ORGANIZATION`. To keep the previous behaviour, set the value for all channels, or for each channel that should offer it, on the admin settings screen.
