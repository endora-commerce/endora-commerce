---
title: First Production Deployment Checklist
---

# First Production Deployment Checklist

**Status: open. No item on this list has been executed.** Endora Commerce has no production
deployment yet. The owner dated the first one on **2026-08-18**: the second half of September
2026 at the earliest, more likely October 2026. The decision of record is
`specs/071-modular-packaging/decisions.md` § D-35.

## Why this page exists

Dozens of engineering decisions in this repository were ruled safe on one ground: *there is no
production deployment, so nothing can break*. That ruling (D-35) let the platform drop
compatibility shims, rebuild its migration history, and change permission gates without a
migration path. It was the right call, and it was never free — it borrowed against a date.
The date now exists.

Everything D-35 licensed that the code cannot carry by itself lands here: a grant somebody has
to make, a setting somebody has to choose, a seed that must not run, a value that is silently
wrong until an operator sets it. This page is that ledger. It is written to be executed by
somebody who was not in the conversations that produced the items.

**This page is not the deployment procedure.** Provisioning the VPS, the container registry,
TLS, DNS and the compose stack are in `deploy/README.md`, and it should be followed first. This
page starts where that one stops: the stack is up, the schema is applied, and nobody has yet
decided anything about the business running on it.

**Scope discipline.** An item belongs here only if all three hold: it must happen before real
customers transact, no code change can decide it for the operator, and getting it wrong is
expensive or invisible. Items that failed one of those tests are listed at the bottom, with the
reason — a checklist that silently omits something is worse than no checklist.

## How to use it

Copy this page per deployment and tick items in the copy, not here. Each item names an
**owner**: *operator* (a business decision, made in the Admin UI) or *engineer* (a value in the
environment, or a command on the host). Every item states what to do and how to prove it took —
"we set it" is not evidence, "we read it back" is.

---

## A. Decisions that are baked into the build

These are frozen when CI builds the images. Changing them later means a rebuild and redeploy,
so decide them before the release build runs — not after.

### A1. The sales-channel code, in all three places it is written

**Why.** The channel code appears in three differently-named variables, and nothing checks that
they agree. The backend reconciles the row named by `DEFAULT_SALES_CHANNEL_CODE` as the
system-default channel at boot; the storefront bundle carries
`NEXT_PUBLIC_SALES_CHANNEL_CODE`, baked at image build time from the CI variable
`SALES_CHANNEL_CODE`. If the storefront's code names a channel that does not exist, storefront
requests fall back to the system default and per-channel content silently resolves against the
wrong channel.

**Do (engineer).** Agree one code with the client. Set it in:

- GitLab → Settings → CI/CD → Variables: `SALES_CHANNEL_CODE` (see `.gitlab-ci.yml:17`, used at
  `.gitlab-ci.yml:645`);
- `deploy/.env` on the VPS: `DEFAULT_SALES_CHANNEL_CODE` (see `deploy/.env.prod.example`);
- if the deployment serves more than one domain, `SALES_CHANNEL_HOST_MAP` as
  `host=channelCode` pairs.

**Verify.** After the deploy, `GET /api/v1/admin/sales-channels` lists a channel whose `code`
equals the value baked into the storefront, and it is the one flagged as system default. Exactly
one system-default channel always exists — if none matches, the storefront is talking to a
channel nobody configured.

### A2. The default locale

**Why.** `NEXT_PUBLIC_DEFAULT_LOCALE` is baked from the CI variable `DEFAULT_LOCALE`
(`.gitlab-ci.yml:646`). It must name a row in the `languages` table. The migration
`packages/modules/languages/src/migrations/20260425T161557_languages_currencies_init.ts` seeds
exactly two languages — `en-US` (default) and `pl-PL` — because those were the demo's choice,
not this client's.

**Do (engineer + operator).** Set `DEFAULT_LOCALE` to the client's language. If the client's
default is not `en-US`, an operator must also flip the default flag on the language row, and
add any language the seed does not ship.

**Verify.** The storefront's first page render is in the expected language with no locale
switch, and the Languages screen shows that language as default.

---

## B. Environment and secrets

### B1. Generate every secret freshly for this deployment

**Why.** `deploy/.env.prod.example` ships placeholders (`change-me-hex-32`,
`change-me-base64-32`). They are syntactically valid, so nothing refuses to boot: a deployment
that keeps them runs with a publicly-known session-signing key and a publicly-known
settings-encryption key. Only two things are refused at boot: a missing
`SESSION_COOKIE_SECRET` (`backend/src/index.ts`) and a missing public API origin (B2). A
placeholder secret is not — it is syntactically a secret.

**Do (engineer).** Generate each of `SESSION_COOKIE_SECRET`, `ASSETS_LIBRARY_HMAC_KEY`
(`openssl rand -hex 32`), `SETTINGS_SECRET_ENCRYPTION_KEY`, `MFA_SECRET_ENCRYPTION_KEY`,
`MEILI_MASTER_KEY` (`openssl rand -base64 32`) and a strong `POSTGRES_PASSWORD`. `chmod 600`
the file.

**Verify.** `grep change-me /opt/b2b/.env` returns nothing.

### B2. Set `REVALIDATE_SECRET`, and know why the backend refuses to boot without a public origin

**Why.** Neither `PUBLIC_API_BASE_URL` nor `REVALIDATE_SECRET` used to appear in
`deploy/.env.prod.example` or in the `x-backend-env` block of `deploy/compose.prod.yml`, and
both failed silently. Issue #218 changed both, in different ways:

- `PUBLIC_API_BASE_URL` is the origin every payment-gateway callback (ITN/notification) URL,
  every public product-feed URL and every newsletter confirmation link is built on. It used to
  fall back to `http://localhost:3001`, so the platform handed the gateway a callback nothing
  on the internet can reach and no payment was ever confirmed. `compose.prod.yml` now derives
  it from `API_DOMAIN` alongside `BACKEND_PUBLIC_URL`, and the backend **refuses to boot** when
  `NODE_ENV=production` and neither is set (`packages/platform/src/kernel/public-api-base-url.ts`, called
  first thing in `composeApp()`). Nothing to fill in — but if the backend exits at boot naming
  this variable, `API_DOMAIN` is what is missing.
- `REVALIDATE_SECRET` is the shared secret the backend presents to the storefront's
  `/api/revalidate` endpoint after a content write (`packages/modules/catalog/src/backend/index.ts`,
  plus the analytics and marketing modules). Unset, the revalidator is a silent no-op and the
  storefront endpoint answers 401: content changes do not appear until the fetch cache expires
  on its own. It is now in `deploy/.env.prod.example` and handed to **both** the backend and the
  storefront container — the same value, or the seam does not close.

**Do (engineer).** Generate `REVALIDATE_SECRET` (`openssl rand -hex 32`) into `deploy/.env`.
Confirm `API_DOMAIN` is the real public API domain.

**Verify.** `docker compose --env-file .env -f compose.prod.yml config | grep PUBLIC_API_BASE_URL`
shows the public API origin, not `localhost`. In the Admin UI, a gateway's configuration screen
shows a callback URL on that domain, and that URL is what is registered in the provider's own
portal. Publish a category change and confirm it appears on the storefront without waiting.

### B3. Point `SMTP_URL` at a real relay

**Why.** `SMTP_URL` is empty in `deploy/.env.prod.example` and documented as optional:
"unset falls back to a console mailer" (`deploy/compose.prod.yml:52`). On a production
deployment that means account verification e-mails, invitations, order confirmations and
invoice deliveries are written to the container log and nowhere else. Nothing errors, and
customers simply never receive anything.

**Do (engineer).** Set `SMTP_URL` and `SMTP_FROM` to the client's relay and sender identity, on
a domain with SPF/DKIM aligned to that sender.

**Verify.** Register a test customer against the production storefront and receive the
verification e-mail in a real inbox. Do this before the client's first customer does.

---

## C. Database and first boot

### C1. Rehearse the migration chain on a throwaway database first

**Why.** Feature 072 rebuilt the migration history and retired the frozen-name map on D-35
grounds — the ordering of the pre-`20260801T000000` block is uncorrected by design
(`backend/src/db/migration-order.ts`), and the chain has only ever been applied to databases
that were free to be thrown away. The first production database is the first one that has to
keep its rows.

**Do (engineer).** On the exact commit that will be deployed, apply the whole chain to an empty
throwaway database — `DATABASE_URL=…/b2b_rehearsal pnpm --filter backend run db:fresh`. Never
run `db:fresh` or `db:reset` without an explicit `DATABASE_URL`: unprefixed they rebuild the
developer's own database.

**Verify.** The run completes with no ordering failure, and the resulting schema matches what
the release's `backend-migrate` container produces on the VPS.

### C2. Do not run the demo seed

**Why.** The developer demo seed (`backend/src/seeds/dev-catalog-seed.ts`) **truncates the
public catalog and business tables**. It has a production guard —
`ALLOW_DEV_SEED_IN_PRODUCTION` — which `deploy/compose.prod.yml` used to defeat permanently in
a pre-armed `seed` service that `deploy/README.md` listed as a deployment step. Issue #218
removed the service and took the seed out of the deployment procedure: there is now no way to
run it that does not involve an operator typing `-e ALLOW_DEV_SEED_IN_PRODUCTION=true`
themselves.

That closes the accident, not the decision. The seed is still reachable, and this step is
still the place where an operator says no to it.

**Do (operator + engineer).** Run no seed. Load the client's real catalog through the
Import/Export module or the Ergonode PIM integration instead. A deployment starts with an
empty catalogue on purpose.

**Verify.** No demo products, no demo organizations, no `platform_admin` account you did not
create yourself. `select count(*) from products` returns what the client's own import produced.

### C3. Confirm what the platform seeded for itself

**Why.** Some reference data arrives without anybody asking: the country/currency/language
reconciler runs as a boot hook (`packages/modules/dictionaries/src/backend/index.ts:201`), and the
system-default sales channel is reconciled at boot rather than by a migration. If a boot hook
fails, the process exits — so a running backend is already evidence they ran. What is *not*
evidence is that the seeded values are the right ones for this client.

**Do (operator).** Open the Dictionary screen and confirm the countries the client trades with
are present and active, and that the default country's default currency is right.

**Verify.** The address form on the storefront offers the client's country, and prices render in
the client's currency.

---

## D. Identity, roles and permissions

### D1. Create the bootstrap administrator, then narrow it

**Why.** The only role the platform ever creates for you is `platform_admin`, holding the
wildcard `*` permission. Everything else is the client's own design.

**Do (engineer, then operator).**

```bash
cd /opt/b2b
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  pnpm exec tsx src/cli.ts admin_users create \
  --email=… --password=… --first-name=… --last-name=…
```

Then, in the Admin UI, define the roles the client actually needs on `/admin-roles`, and stop
using the wildcard account for day-to-day work.

**Verify.** `/admin-roles` lists the client's roles, and at least one non-wildcard account can
do its job end to end.

### D2. Grant `customer_groups:read` and `customer_groups:write`

**Why.** Customer-group management moved from `price_lists` to `customer_accounts` (feature 076,
D-79) and gained permission codes of its own. Before the move it was gated by `catalog:write`,
which was plainly wrong — a customer group is customer segmentation, not catalog data. The two
new codes are `customer_groups:read` and `customer_groups:write`
(`packages/modules/customer_accounts/src/manifest.ts:188-189`).

**Nothing grants them automatically.** A compatibility gate that would have accepted the old
`catalog:write` alongside the new codes was offered and deliberately refused: it would have kept
a wrong permission alive past the moment it stopped being right, for the benefit of nobody,
since there was no deployment to protect. The grant belongs here instead. The wildcard `*` role
is unaffected — it already passes every gate.

**Do (operator).** On `/admin-roles`, for every role that is not `*` and whose holder needs to
see or manage customer groups, tick both permissions (or one, if the role should only read).
Which roles need them:

| A role whose holder… | needs |
| --- | --- |
| manages the customer-group list itself (`/customer-groups`) | `customer_groups:read` + `customer_groups:write` |
| edits a customer and assigns their group — the picker in `packages/modules/customers/src/admin/panels/ManagementPanels.tsx`, which reads `GET /api/v1/admin/customer-groups` | `customer_groups:read` |

Those two, and no others. The promotion rule builder and the PWA push-audience builder also
show a group list, but each reads it through **its own** module's endpoint
(`/api/v1/admin/promotions/rule-targets/customer-groups`,
`/api/v1/admin/pwa/rule-targets/customer-groups`) behind that module's own read permission, so
they are unaffected by this grant. The price-list rule builder was the exception until issue
#219; it now reads its list behind `price_lists:read`, which is the subject of D3.

The same grant can be made over the API:
`PUT /api/v1/admin/admin-roles/<code>` with the role's full permission list including the new
codes.

**Verify.** Sign in as a holder of each edited role and confirm three things: the **Customer
groups** entry appears in the sidebar; `⌘K` → "customer groups" offers the action (the palette
hides actions whose `requiredPermission` the operator lacks); and `GET
/api/v1/admin/customer-groups` returns `200` rather than `403`. A role you deliberately did not
grant must still get `403` — that is the other half of the proof.

### D3. Grant `price_lists:read` and `price_lists:write`

**Why.** Until issue #219 the `price_lists` module declared no permissions of its own: all 25 of
its admin routes were gated by `catalog:write`. A role granted `catalog:write` so somebody could
edit product descriptions could also create, edit and delete price lists — that is, change what
customers pay. Nobody chose that boundary; it was the side effect of a missing declaration. The
module now owns `price_lists:read` and `price_lists:write`
(`packages/modules/price_lists/src/manifest.ts`), split by what each route does rather than
mapped wholesale: reading a list, its product roster, its brackets, the display-mode overrides
and the rule-target pickers is `:read`; anything that persists is `:write`.

The same change closed the last surviving pre-076 gate:
`GET /api/v1/admin/pricing/rule-targets/customer-groups` answered on `catalog:write`, so a
catalogue editor could enumerate the client's customer groups. It now answers on
`price_lists:read`, matching its `promotions` and `pwa` twins.

**Nothing grants the new codes automatically**, and — as in D2 — a compatibility gate accepting
`catalog:write` alongside them was offered and refused, because it keeps a wrong permission
alive past the moment it stopped being right. A role holding only `catalog:write` therefore has
**no** pricing access at all: the sidebar entry disappears, `/price-lists` 403s, and the
**Pricing** tab on the product editor renders its error state instead of the linked price lists
(it reads `GET /api/v1/admin/products/:productId/price-lists`, now a `price_lists:read` route).
The wildcard `*` role is unaffected.

**Do (operator).** On `/admin-roles`, for every role that is not `*`, decide pricing explicitly:

| A role whose holder… | needs |
| --- | --- |
| manages price lists, brackets, rules or display-mode overrides (`/price-lists`, `/price-lists/:id`, `/price-lists/display-modes`) | `price_lists:read` + `price_lists:write` |
| only needs to see a quoted price explained — reads price lists, or opens the **Pricing** tab on a product | `price_lists:read` |
| maps Ergonode attributes (`/pim/ergonode/attribute-mapping`), whose price-list and currency pickers read `GET /api/v1/admin/price-lists-engine` and `GET /api/v1/admin/pricing/rule-targets/currencies` | `price_lists:read`, on top of `pim_ergonode:*` |
| edits catalogue content and must **not** change prices | neither — leave `catalog:write` as it is |

The last row is the point of the change: after this, `catalog:write` means catalogue content and
nothing else. Review every existing role that holds it and decide which of the first two rows,
if either, it also belongs in.

The same grant can be made over the API:
`PUT /api/v1/admin/admin-roles/<code>` with the role's full permission list including the new
codes.

**Verify.** Sign in as a holder of each edited role and confirm four things: the **Price lists**
entry appears in the sidebar; `GET /api/v1/admin/price-lists-engine` returns `200` rather than
`403`; a role granted only `price_lists:read` gets `403` from
`POST /api/v1/admin/price-lists-engine`, so the read/write split is real; and a role holding
`catalog:write` and neither pricing code gets `403` from `GET /api/v1/admin/price-lists-engine`
and from `GET /api/v1/admin/pricing/rule-targets/customer-groups` — that negative case is the
half that proves the boundary moved, not just widened.

### D4. Turn on two-factor authentication for the Admin UI

**Why.** The MFA module is active by default, but every capability inside it ships **off**:
`mfa.admin.totp_enabled` and `mfa.admin.totp_enforced` both default to `false`
(`packages/modules/mfa/src/manifest.ts:37-51`). A deployment that changes nothing has
password-only admin access on a public domain.

**Do (operator + engineer).** Set `MFA_SECRET_ENCRYPTION_KEY` (B1), then allow admin 2FA,
enrol every administrator, and only then enforce it — enforcing before enrolment locks
everybody out.

**Verify.** A second sign-in attempt asks for the code, and an account with no enrolment is
refused once enforcement is on.

---

## E. Module activation

### E1. Walk `/platform/modules` and decide each one

**Why.** Principle XVII makes a module's presence the conjunction of platform availability and
the operator's activation choice — and the second axis has a default. Of the core modules, 23
declare themselves non-deactivatable and the rest ship an operator activation control; **every
one of those controls defaults to on.** Nothing about a fresh install expresses what this client
bought.
A module left on contributes its sidebar entry, palette actions, settings group, API surface and
storefront elements whether or not anyone asked for it.

**Do (operator).** Go through `/platform/modules` once, with the client, and switch off what
they are not using. Switching off is non-destructive and reversible: it drops no data,
configuration, permissions or schema. **Do not rely on the confirmation prompt to tell you what
a deactivation costs** — today it only names the module
(`admin/src/modules/platform/ModuleActivationControl.tsx:88`). What breaks when a module goes
off is recorded in the deactivation-consequence ledger, which
`pnpm --filter backend run check:port-dependencies` builds; ask an engineer to read it for any
module the client is not obviously done with.

**Verify.** For each module switched off: its sidebar entry is gone, its palette actions are
gone, and its API answers `503 MODULE_DISABLED`. For each left on, somebody can name why.

### E2. Decide the marketing and analytics modules explicitly

**Why.** `google_analytics`, `google_tag_manager`, `meta_ads` and `linkedin_ads` are all active
by default. Each has a second, capability-level toggle that is off until configured, so nothing
is transmitted yet — but activation is what puts the screens and the consent-mode settings in
front of the operator, and whether the client wants third-party tracking at all is a decision
with legal weight in the EU.

**Do (operator).** Confirm per module: wanted or not. Where wanted, configure the measurement
ID and the `require_consent` toggle before the first visitor.

**Verify.** With the modules the client declined switched off, no third-party tag appears in the
storefront's page source.

### E3. Decide the AI assistant separately

**Why.** `prompt_actions` is active by default, though the assistant itself
(`prompt_actions.enabled`) is off and needs an LLM credential before it can do anything. Turning
it on means admin instructions and the data needed to resolve them leave the platform for a
third-party model provider. That is a data-processing decision, not a configuration one.

**Do (operator).** Decide with the client. If yes, register the LLM credential on
`/credentials`, set the `prompt_actions.bulk_limit`, and grant `prompt_actions:use` deliberately
rather than by inheritance.

**Verify.** If declined, the palette's prompt mode is absent. If accepted, the client has agreed
in writing to the provider.

---

## F. Business configuration before the first transaction

### F1. Invoice seller identity and numbering

**Why.** The Invoices module is active by default and its seller identity is empty:
`invoices.seller.tax_id` defaults to `''` and `invoices.seller.company_data` to `{}`
(`packages/modules/invoices/src/manifest.ts:40-55`). The numbering patterns default to
`FV {seq}/{channel}/{YYYY}`, `PRO …`, `KOR …` — a reasonable shape, and still a choice the
client's accountant has to confirm, because it is not comfortably changed once documents exist
under it. A valid tax id is also a precondition for KSeF serialization if the client uses it.

**Do (operator).** Fill the seller settings and confirm the three numbering patterns in
Settings → Invoices before the first invoice is issued.

**Verify.** Issue one invoice against a test order and read the PDF: the seller block is the
client's real legal identity and the number matches the agreed pattern.

### F2. Order numbering, minimum order value and confirmation recipients

**Why.** `orders.business_id.prefix` and `orders.business_id.suffix` default to `''`,
`orders.min_order_value` to `0`, and `orders.confirmation_recipients` to `[]`
(`packages/modules/orders/src/manifest.ts`). The last one is the quiet one: with an empty list,
nobody at the client is notified when an order is placed.

**Do (operator).** Set the order-number affixes before the first order, the minimum order value
to the client's commercial rule, and at least one internal confirmation recipient.

**Verify.** Place a test order: its number carries the agreed affixes and the confirmation
lands in the client's internal inbox.

### F3. Taxes, delivery and payment methods

**Why.** No tax rate is seeded, and no delivery or payment method is configured for this client:
the delivery and payment modules only reconcile a row per gateway adapter that happens to be
installed (their `installHook`s), which is a placeholder, not a commercial decision. An order can
be placed with all three wrong long before anybody notices.

**Do (operator).** Configure the VAT rates the client charges, the delivery methods with their
per-channel availability, and the payment methods.

**Verify.** A test checkout shows the expected tax line, offers exactly the delivery and payment
options the client expects, and totals to the number the client's own system would produce.

### F4. Switch each payment gateway from sandbox to production

**Why.** Every gateway module defaults its environment setting to `sandbox`
(`packages/modules/tpay/src/manifest.ts:28`, `packages/modules/payu/src/manifest.ts:28`, and the
same shape in `autopay` and `stripe`), and holds separate credentials per environment. A
deployment that goes live in sandbox takes no money; one that forgets to register the production
callback URL takes money and never confirms the order.

**Do (operator + engineer).** For each gateway the client uses: enter the production
credentials, flip the environment setting to `production`, and register the callback URL —
built on `PUBLIC_API_BASE_URL` (B2) — in the provider's own portal. For Autopay, the ITN URL is
`{PUBLIC_API_BASE_URL}/api/v1/autopay/itn`; the ISTN endpoint must be enabled by the provider on
request.

**Verify.** One real low-value transaction per gateway, end to end, and confirm the order
reaches the paid state from the provider's callback — not from a manual status change.

### F5. KSeF, if the client invoices in Poland

**Why.** The `ksef` module defaults `ksef.integration.enabled` to `false` and its environment to
`test` (`packages/modules/ksef/src/manifest.ts`), which is the right default — a misconfigured
production submission is legally binding. Going live is therefore a deliberate act.

**Do (operator).** Install and configure the module on `/ksef`: upload or generate the
certificates, verify the connection in `test`, then switch the environment to `prod` and enable
the integration.

**Verify.** One invoice submitted in `test` and accepted, before the environment is switched.

---

## G. Operations that must exist on day one

### G1. Backups, including the assets volume

**Why.** `deploy/README.md` describes a `pg_dump` cron as *recommended* and covers Postgres
only. The Assets Library's local-filesystem adapter writes uploaded files into the
`backend-assets` volume (`deploy/compose.prod.yml`), and nothing backs that up. A restored
database with no files is a catalog of broken images and unreachable invoice PDFs.

**Do (engineer).** Install the off-box `pg_dump` cron, add the assets volume to it, and — the
part that is usually skipped — restore both into a scratch environment once, before go-live.

**Verify.** A restore rehearsal produces a working storefront with images.

### G2. Build the search index after the first catalog load

**Why.** The search index is maintained incrementally on write. Data loaded before the index
existed, or loaded by a path that bypassed the events, is simply not there — the storefront
search returns nothing and no error.

**Do (engineer).** After the client's catalog import completes, run the re-index. On the VPS:

```bash
docker compose --env-file .env -f compose.prod.yml run --rm backend \
  pnpm exec tsx src/cli.ts search reindex
```

(the same invocation the `search:reindex` package script makes — `src/cli.ts` is the host
binary that runs the commands modules declare in their `manifest.ts`; `--list` prints every
one this instance offers). See `docs/docs/modules/search.md`.

**Verify.** Search for a product you know exists and find it; compare the indexed document count
against the product count.

### G3. Tell the backend which proxy may name the client's IP address

**Why.** The client's address reaches the application only through
`X-Forwarded-For`, and the backend believes that header only from a hop it has been
told to trust — otherwise `request.ip` is the host nginx for every request. Three
consequences: the per-IP rate limit (1000/min) becomes one shared bucket for the whole
internet; the IP recorded on security-relevant audit rows — MFA events, admin
impersonation, prompt-action runs — is the proxy, not the actor; and the public
product-feed rate-limit key collapses for unauthenticated callers. This used to be an
open question with no answer in the code; since issue #220 the answer is a variable.

**Do (engineer).** Confirm the host nginx sets `X-Forwarded-For` and `X-Forwarded-Proto`
(the template in `deploy/nginx.example.conf` already does, with
`$proxy_add_x_forwarded_for`), then set in `deploy/.env` on the VPS:

```bash
TRUSTED_PROXY_HOPS=1
```

One hop, because exactly one proxy sits between the internet and the backend
container. Add one per additional proxy — a CDN in front of the host nginx makes it 2 —
and count it wrong in the *high* direction only at your peril: each extra hop is one
more `X-Forwarded-For` entry the client itself could have written. Where the proxy's
address is fixed and known, `TRUSTED_PROXY_ADDRESSES` takes IPs, CIDR ranges or the
named ranges `loopback` / `linklocal` / `uniquelocal` instead; set one variable or the
other, never both. There is deliberately no value meaning "trust any hop", and the
backend refuses to boot on a value it cannot parse rather than falling back to trusting
nothing — a silent fallback is exactly the state this item exists to end.

**Verify.** After the stack restarts, sign in from a known external address and read back
the MFA or impersonation audit row: the address recorded must be yours, not the proxy's.
A quick negative check is `curl -H 'X-Forwarded-For: 1.2.3.4' https://<API_DOMAIN>/...`
from outside — with one trusted hop, the forged entry is ignored and the address logged is
still yours, because nginx appends its own view of the peer after it.

---

## Deliberately not on this list

Each of these was considered and left off, with the reason. If a reason stops holding, the item
moves up.

- **Provisioning the VPS, DNS, TLS, the registry and the compose stack.** Covered by
  `deploy/README.md`, which is the procedure this page assumes has been followed. Duplicating it
  is how the two drift.
- **The coordinated developer-database reset** (`specs/072-module-kernel-di/MIGRATION-RESET.md`).
  It is a developer-workstation procedure. The first production database starts empty and applies
  the chain once; C1 is what covers it.
- **The price-list migration report** (feature 011, FR-003 — "flag rows that need a real
  per-currency value before go-live"). It describes migrating a *pre-existing* deployment's
  legacy unit prices. A first deployment has no legacy prices to migrate. It becomes a real item
  the first time a client is migrated onto the platform from something else.
- **Customer deletion retention** (`customers.deletion_retention_days`, default 365) and
  **presence freshness**. The default is safe and does not bite for a year, and the setting is
  editable at any time with no data consequence. It belongs on a GDPR review, not a go-live gate.
- **Per-module integration credentials for modules the client is not using** — Ergonode, product
  feeds, newsletter providers, the marketing pixels. There are dozens of settings whose default
  is an empty string; every one of them is inert until its module's capability is switched on.
  E1 is the item that decides which of those exist at all; listing each credential here would be
  a settings dump, not a checklist.
- **Meilisearch, Redis and Postgres tuning.** Capacity work, not correctness work, and the
  single-VPS sizing note in `deploy/README.md` covers the floor.
- **A module rename or a stuck lifecycle lock.** Incident procedures, not go-live steps; the
  runbook is `docs/docs/operations/runbooks/module-lifecycle-stuck-lock.md`.
- **Client-specific integrations** — the ERP or WMS connection, API keys, webhook subscriptions.
  Real work, and it is project scoping rather than a platform go-live gate: nothing in the
  platform is wrong until the client asks for one.
- **Anything a static check already refuses.** If CI can fail on it, it is not an item here — that
  is the whole design of the check inventory in `AGENTS.md`.

---

## When D-35 closes

On the day the first deployment carries a client's data, D-35 stops licensing anything. From
then on: renaming an applied migration class needs a rename map again, a permission gate cannot
change without a grant path, and a contract change needs the versioning discipline Constitution
II describes. The decision record says so in its own last paragraph; this page is where the
consequences were paid.
