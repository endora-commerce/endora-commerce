---
"@endora-commerce/cli": patch
---

`endora new instance`'s deployment examples now pass `NEWSLETTER_TOKEN_SECRET` to the backend.

The compose examples under `deploy/` and their `.env.example` files omitted it, so a deployed
backend never received it and signed newsletter confirmation and unsubscribe links with the
session key: rotating `SESSION_COOKIE_SECRET` invalidated every confirmation link still waiting
in an inbox. The backend's environment block now names it, and also passes through any other
generable secret the platform's environment declaration scopes to the backend, so a secret the
platform adds later reaches the container without a CLI change.

**If you scaffolded an instance with an earlier version**, add the line to the `x-backend-env`
block of `deploy/compose.prod.yml` (or `deploy/three-host/compose.backend.yml`):

```yaml
  NEWSLETTER_TOKEN_SECRET: ${NEWSLETTER_TOKEN_SECRET}
```

and a freshly generated value to the `.env` beside it, e.g. `openssl rand -base64 32` (leaving it
empty signs newsletter links with the session key, on a platform that includes the matching
`@endora-commerce/platform` fix):

```dotenv
NEWSLETTER_TOKEN_SECRET=<generated value>
```

Links already mailed stay signed with the session key and stop verifying once the new secret is in
place; ask affected subscribers to request a new link if that matters to you.

The same `.env.example` files now leave `NEWSLETTER_TOKEN_SECRET` and `MFA_SECRET_ENCRYPTION_KEY`
empty instead of carrying `change-me-generate-one`. Empty is a working state for both, and the
placeholder is not: it decodes to 16 bytes, so a backend with `mfa` installed refused to boot on
the example as copied. **If your deployment `.env` still holds `change-me-generate-one` for either**,
replace it with a generated value (`openssl rand -base64 32`) or leave it empty.
