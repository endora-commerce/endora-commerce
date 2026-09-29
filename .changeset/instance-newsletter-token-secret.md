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

and a freshly generated value to the `.env` beside it, e.g. `openssl rand -base64 32`:

```dotenv
NEWSLETTER_TOKEN_SECRET=<generated value>
```

Links already mailed stay signed with the session key and stop verifying once the new secret is in
place; ask affected subscribers to request a new link if that matters to you.
