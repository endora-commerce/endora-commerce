---
'@endora-commerce/mod-transactional-emails': minor
---

The e-mail branding — the header logo and the accent colour every transactional e-mail renders with — has an admin screen again (issue #1466). `/transactional-emails/branding` is a route, a sidebar entry under Messaging and the palette action `open-email-branding`, all gated on `transactional_emails:read`; its one Save needs `transactional_emails:write`. A Save sends only the fields changed for the selected scope, so a sales channel keeps inheriting the all-channels value of anything it does not override. The unused `BrandingPanel` component, which no screen imported, is removed; it was not exported from the package.
