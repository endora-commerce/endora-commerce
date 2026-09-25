---
title: Product Feeds
description: Provider-shaped product feeds per sales channel — scheduled generation, tokenised pull URLs and SFTP/FTP/HTTP push
---

# Product Feeds

The `product_feeds` module turns the catalogue of one sales channel into a
**provider-shaped feed file** — a Google Merchant Center XML document, a Meta catalogue, a
marketplace flat file — publishes it at a **stable, tokenised URL** the provider fetches
anonymously, and regenerates it on a per-feed schedule.

Feeds leave the platform two ways. **Pull** is the original one and still the default: the
provider fetches the tokenised URL, or an administrator downloads the file. **Push** arrived
later — each successful run can also send its file to a partner's server over SFTP, FTP or
HTTP. The two are independent, so a feed can do both.

## For operators

### What a feed is made of

A feed is four choices and nothing else at creation time:

| Choice | Meaning |
| --- | --- |
| **Template** | Which fields the file carries, in which order, and in which format (XML, CSV, TSV). |
| **Sales channel** | Which catalogue the feed publishes. This is also what scopes prices and links. |
| **Language** | Which translation of names, descriptions and category paths is written. |
| **Name** | What you will recognise it by. The public URL is derived from the feed, not the name. |

Everything else — criteria, schedule, price presentation, price list, tax country — has a working
default and is edited afterwards on the feed's **Settings** tab.

### Creating your first feed

1. Go to **Sales channels → Product feeds** and press **New feed**.
2. Pick the **Google Merchant Center** template, the channel you sell that catalogue on, and the
   language. The screen shows the derived settings (currency, price presentation) as you choose.
3. Save, then press **Generate now** on the feed's page.
4. When the run finishes, the **Feed link** card shows the URL. Copy it into Merchant Center as a
   scheduled fetch.

Until the first successful run there is deliberately **no URL on screen**: a link that answers
`404` is worse than no link.

### The five shipped templates

They are not equivalent, and the difference is visible before you choose one.

| Template | Format | Granularity | State |
| --- | --- | --- | --- |
| Google Merchant Center | XML (RSS 2.0 + `g:`) | Per variant | **Ready to use** |
| Meta catalogue | XML | Per variant | **Ready to use** |
| Amazon flat file | TSV | Per product | **Starting point** |
| eBay | CSV | Per product | **Starting point** |
| Allegro | CSV | Per product | **Starting point** |

"Ready to use" means the field list is complete for that provider's required set. "Starting point"
means the template carries only identity, price, availability, link and image — the fields every
marketplace needs — and you are expected to add that marketplace's own attributes in the template
editor. The three marketplaces ship as skeletons because this version has no API integration with
them, so their exact required set is a per-account matter.

System templates cannot be edited. **Duplicate** one and edit the copy; the original stays as the
platform shipped it, and a deleted system template is restored on the next start.

### Building or editing a template

**Sales channels → Feed templates → New template** or **Duplicate**. The editor is a visual list of
output fields: each row is *output name ← source*, with an optional fallback and a "required by the
provider" flag.

- **Bindings are chosen, never typed.** The source picker lists what exists in this installation —
  product fields, attributes and custom fields, images, prices, category paths, the provider
  category. A source the current output format cannot express is shown disabled **with the reason**,
  not hidden.
- **Reordering works by keyboard alone.** Grab a row with `Space`, move with `↑`/`↓` or `Alt+↑/↓`,
  drop with `Space`, cancel with `Escape`. Every move is announced. On touch devices each row has
  explicit move buttons, and long lists offer **⋮ → Move to position…**.
- **The preview evaluates a draft.** Pick a sample product and see, per field, the value the file
  would carry, where it came from (source or fallback), and whether the item would be emitted or
  skipped. It writes nothing — no run, no audit entry.
- **Problems are surfaced continuously**, in a bar above the list. **Save** is never disabled
  because of a validation problem; it tells you what is wrong instead.
- Removing a field the provider requires asks for confirmation once, naming the consequence. It is
  neither silently accepted nor blocked.

Templates move between installations as JSON: **Export…** on a template, **Import** on the templates
list. The document carries no ids, no timestamps, no tokens and no feed bindings, so exporting an
unchanged template twice produces byte-identical files. A field whose source does not exist in the
target installation imports as **unbound** and is reported; a feed on a template with unbound fields
fails its run naming each one, rather than publishing a file with holes.

### Narrowing a feed to part of the catalogue

The **Criteria** region on the Settings tab is the same rule builder used by promotions and price
lists. An empty rule means "every eligible product of this channel". A category criterion includes
the whole subtree.

The panel shows a **live match count** as you edit. That number is computed from the same prices and
the same channel scoping the next run will use, so it is the number of items the run will consider —
not an estimate.

Two things a rule can never do:

- **widen the feed.** Active, not archived, a member of this feed's channel, and visible to an
  anonymous visitor is a floor no criterion can lift. "Visible to an anonymous visitor" is the whole
  of the answer, not only the `public` switch: a product that is public **but** reserved to named
  organisations stays out, because the file is fetched by Google and a link nobody outside those
  organisations can open is an advertisement for a 404 — and for the existence of an assortment
  somebody else was promised exclusively;
- **silently match everything.** A criterion naming an attribute that has since been deleted fails
  the run with a configuration error, rather than quietly matching the whole catalogue.

If a rule matches nothing, the run ends as `empty` and the **previously published file keeps
serving**. The panel warns you about that before you save, not afterwards.

### Category mapping (Google and Meta)

Both providers understand their own product taxonomy. The platform ships those taxonomies (Google's
5 595 categories, Meta's 2 967, each in English and Polish), so generating a feed never depends on
reaching Google or Meta.

Open the mapping screen from the command palette (⌘K / CTRL+K → *Feed category mapping*). Map a shop
category to a provider node and every descendant inherits it, unless it carries a mapping of its
own; where several assigned categories apply, the deepest mapped one wins, deterministically. A
coverage strip shows how many categories are mapped, inherited or unmapped.

- An **unmapped** category is not an error: the field is omitted and the item is still emitted, with
  a warning on the run so you can find it.
- When a newer taxonomy revision comes into use and a node you mapped no longer exists, the mapping
  is kept and flagged **stale** — never remapped to a guess and never deleted. The screen lists
  stale mappings for review. A revision only comes into use when you promote it on
  [Taxonomy updates](#taxonomy-updates); installing one changes nothing.
- Above 1 000 shop categories the screen switches from a tree to a paged flat list grouped by
  parent, with the same rows and the same coverage strip.

### Taxonomy updates

Google and Meta reorganise their category lists once or twice a year. The platform can check for a
newer list and install it — and installing one **changes nothing** until you say so.

**It is off by default, and off is a fully supported state.** With the switch off the platform makes
no outbound request at all: no scheduled check, no manual check, no probe at boot. Many
installations run this way on purpose, and an air-gapped one has to. Turning it on is one setting,
on a screen that names the exact addresses that will be contacted before you flip it.

**Turning it on.** *Settings → Taxonomy updates* (`product_feeds_taxonomy`):

| Setting | What it does |
| --- | --- |
| Check for new taxonomy revisions | The master switch. Off by default. |
| When to check | Cron, interpreted in **UTC**. Defaults to Monday 04:00. These lists change once or twice a year, so checking more often buys nothing. |
| Google / Meta category list (English, Polish) | The four addresses that will be downloaded. Point them at an internal mirror or a proxy if this platform cannot reach the providers directly — that is the supported answer for a deployment behind a proxy. `https` only. |
| Category lists kept per provider | How many revisions to retain. The list in use, the newest one nobody has decided about, and any list still holding a category one of your mappings points at are never deleted, whatever this is set to. |

**What a check does.** It downloads both language files for a provider, checks that they really are
a category list, and compares them with what you already have. If the list is genuinely different it
is installed **inactive**: your feeds keep using the list they were using, no mapping's status
changes, and the only visible effect is a new row on *Product feeds → Taxonomy updates* (⌘K /
CTRL+K → *Taxonomy updates*). If the file has not changed, nothing is created.

**Reading a check.** The screen lists every check with its outcome and, when something went wrong, a
reason written to tell you **whose side the problem is on**:

| Reason | What it means |
| --- | --- |
| `transport` | This server could not reach the provider — usually no outbound internet, or a proxy or firewall. Point the source address at your proxy or an internal copy. |
| `not_found` | The provider no longer publishes a file at that address. Find the current one in their documentation and update the setting. This is the only failure that raises a notification, and it does so once per transition into failure, not once per check. |
| `http_status` | The provider answered with an error. Usually temporary on their side; the next check retries. |
| `not_taxonomy` | The address returned a web page — often a login screen or a proxy notice. Open it in a browser to see what it actually serves. |
| `empty` / `truncated` / `too_large` | The download was empty, cut short, or larger than the platform will accept. Nothing was installed. |
| `no_nodes` / `implausible` | The file downloaded but no categories, or far too few, could be read from it. Nothing was installed. |
| `incomplete_languages` | One language downloaded and the other did not. A list is installed only when both are complete. |

**In every one of those cases your feeds are unaffected** and keep using the list already installed.
A failed check never fails a generation run, never fails boot and never retries in a storm — the
next scheduled check is the retry, and *Check now* is there for impatience.

**Promoting.** A revision only comes into use when you promote it, and you can only reach the
promote button through the impact preview. That preview is computed from your real data and tells
you what you actually need to know: how many of your mappings would need a new category, how many
would start working again, and — the number that matters — how many of your shop categories would
**stop sending a provider category at all**, counting the ones that inherit through an ancestor.
Promotion is audited, atomic, and reversible: going back to the earlier list is the same action
against the earlier row.

The request carries the impact figure you were shown, so if a colleague edits mappings while your
preview sits open the promotion is refused and the numbers are recalculated. Nothing about this
mechanism can change what a feed emits without somebody reading that screen and pressing the button.

### Scheduling

On the Settings tab, choose a preset (hourly, every 4 hours, daily, …) or **Custom** with a 5-field
cron expression and an IANA timezone. A custom expression is echoed back in plain language ("Every 4
hours, at minute 0") and the next occurrence is always shown.

- A tick that arrives while the previous run is still going is **skipped, with a reason** — never
  queued behind it. Skipped ticks appear greyed in the run list.
- The admin warns when a feed's average run duration approaches its interval.
- Disabling a feed stops both the schedule and the public URL.
- Postgres is the source of truth for schedules; the queue is a derived index rebuilt at start, so a
  flushed Redis loses nothing.

### The link, and rotating it

The public URL contains a random token. The **Feed link** card shows it in full whenever the feed
has a live token, with a copy button, so you can re-copy it every time a provider is reconfigured.

Two things are stored: the token's hash, which is the only thing the public endpoint compares
against, and the token itself encrypted at rest under `SETTINGS_SECRET_ENCRYPTION_KEY` — the same
key the settings and credential secrets already use. The encrypted copy is read only when an
administrator opens the feed, never on a public request.

Anyone holding the link can read the file, which contains your prices. Treat it as a credential:
share it with the provider that needs it, and rotate if it leaks.

- On a deployment with **no `SETTINGS_SECRET_ENCRYPTION_KEY`**, and for links issued before this
  platform version, the card shows only the beginning of the token. Rotate to get one you can copy.
- **Rotate** issues a new URL and invalidates the old one **immediately**, with no grace period. Any
  provider still configured with the old URL stops receiving updates until you paste the new one.
- **Revoke** leaves the feed with no public URL at all, and drops the stored copy of the token along
  with its hash. The administrator download keeps working.
- The URL serves `Cache-Control: private` and supports `If-None-Match`, so a provider's revalidation
  is cheap.
- The endpoint is rate limited (default 60 requests/minute); providers fetch a few times a day.

Downloading the generated file in the admin requires the **Manage product feeds** permission, not
merely **View product feeds** — the file contains your prices.

### Reading a run

Every generation produces a run row with counts: considered, emitted, skipped, warnings. Open one to
see the per-item problems, **grouped by reason**, with the SKU of each affected item and a CSV
export of the full list.

| Reason | What it means |
| --- | --- |
| `missing_price` | No price resolved for the feed's currency and price list. |
| `missing_image` | The product has no publicly reachable image. |
| `private_image_asset` | Images exist but are not public, so no stable URL could be published. |
| `missing_required_field` | A field the provider requires resolved empty with no fallback — the item was skipped. |
| `missing_translation` | The feed's language had no value; a fallback language was used. |
| `unresolvable_link` | No storefront URL is configured for the channel. |
| `unmapped_provider_category` | No category mapping applied; the field was omitted. |
| `stale_provider_category_mapping` | The mapped node no longer exists in the installed revision. |
| `zero_tax_rate_on_gross_feed` | A gross feed found no tax rule for its tax country. |

Failures are different from item problems: they end the run and publish nothing.

| Failure | Meaning |
| --- | --- |
| `channel_unavailable` | The feed's channel is missing or switched off. Nothing is published — a feed never widens to the whole catalogue. |
| `unbound_template_fields` | The template has fields bound to nothing (usually after an import). |
| `unknown_attribute` | The criteria name an attribute that no longer exists. |
| `skip_threshold_exceeded` | More than half the considered items were skipped, so a good file was not replaced by a bad one. |
| `storage_unavailable` | The storage backend refused the file. |
| `worker_lost` | The worker died mid-run; the claim was released and the partial file removed. |

An administrator notification is raised when a run fails — **once per transition into failure**, not
once per tick, so a feed that has been broken for a day does not fill the bell.

### Permissions

| Code | Grants |
| --- | --- |
| `product_feeds:read` | View feeds, templates, run history, issues and category mappings. |
| `product_feeds:write` | Create and edit feeds and templates, generate, rotate or revoke a link, map categories, download generated files. |

A read-only administrator sees every screen with the write controls **visible but disabled**, each
explaining why — never hidden.

### Settings

Under **Settings → Product feeds**:

| Setting | Default | Effect |
| --- | --- | --- |
| Generated files kept per feed | 3 | Older files are deleted after a successful run; the published one is always kept. |
| Maximum concurrent feed generations | 2 | Per worker process. |
| Skipped-item share that fails a run | 0.5 | Above this fraction the run fails instead of publishing. |
| Stale run timeout (minutes) | 30 | A run with no heartbeat for this long is treated as lost. |
| Recorded issues per run | 1000 | The cap on stored per-item problems; the overflow is reported. |
| Public feed requests per minute | 60 | Rate limit on the anonymous URL. |
| Category-mapping tree limit | 1000 | Above this, the mapping screen uses a paged flat list. |

---

### Delivering a feed to a partner's server

Google and Meta fetch the link themselves, so most feeds need nothing here. Marketplaces and ERP
integrations usually want the opposite: the file dropped on a server they poll. That is what the
feed's **Delivery** tab configures.

A feed carries **at most one** delivery target, and delivery is switched on and off independently
of the target — so you can configure a partner now and start sending next week, or stop sending
without losing the settings.

| Protocol | What it does | Fields |
| --- | --- | --- |
| **SFTP** | Uploads over SSH. The one to prefer. | Host, port, user, password **or** private key, directory |
| **FTP** | Uploads over FTP, asking for FTPS first. | Host, port, user, password, directory |
| **HTTP Server / API / GraphQL** | `POST`s the file to a URL. | Request URL, headers |

The last three are **one mechanism with three names**. The partner's documentation may call their
endpoint an API or a GraphQL endpoint; the platform sends the same request either way, and the
choice only changes the label on your screen.

#### When delivery happens

After a run **publishes successfully**, and only then. A failed run, an empty run, or a run skipped
because the previous one was still going sends nothing — the file the partner already has is still
the current one, and re-sending it would announce a change that did not happen.

If the upload fails, the run stays successful and the published link keeps working. The delivery is
retried a few times with a growing delay; if it still fails, it stops and an administrator is
notified. Every attempt — successful or not — is listed under the tab, with the reason.

#### Secrets

Passwords, private keys and any header whose name says it carries a token (`Authorization`,
`X-Api-Key` and the like) are stored encrypted and are **never shown again**. A stored secret
appears as `[redacted]`, and leaving it that way keeps it — so editing a directory path cannot
silently erase your password.

#### Two refusals worth knowing about

- **`http://` is refused for the HTTP protocols.** The authenticating header travels with the
  request, so the address must be `https://`.
- **Private and internal addresses are refused**, including `169.254.169.254` and anything on your
  own network. The feed carries your whole priced catalogue; the platform will only send it
  somewhere reachable from the public internet.

FTP itself is plaintext by design. The platform asks every FTP server for TLS and only falls back
to plain FTP if it refuses, but if the partner offers SFTP, choose SFTP.

#### Test connection

**Test connection** proves the target is reachable and the credentials work, without sending a
feed. On SFTP and FTP it writes and immediately removes one tiny file, because a directory you
cannot write to is the failure a connect-only test would miss. It is rate-limited per feed.

## For engineers

### Shape

```
packages/modules/product_feeds/src/backend/
├── entities/          9 tables, all @GlobalEntity (no tenant column anywhere)
├── services/          selection, resolution, serializers, runs, tokens, taxonomies
├── commands/          feed / template / taxonomy-mapping Commands
├── workers/           generation consumer + stale-run reaper
├── seeds/             the five predefined templates
├── data/taxonomies/   bundled Google + Meta revisions (see PROVENANCE.md)
├── routes.admin.ts    /api/v1/admin/product-feeds
├── routes.templates.ts /api/v1/admin/feed-templates, /feed-previews/*
├── routes.taxonomies.ts /api/v1/admin/feed-taxonomies
└── routes.public.ts   GET /api/v1/public/product-feeds/:token
```

Contracts live in `packages/contracts/src/product-feeds.ts`; the admin layer is
`packages/modules/product_feeds/src/admin/`.

### The generation pipeline

```
selection (ids only, keyset on products.id)
  → hydrate a batch of 500
    → resolve each item (pure)
      → serialize (one chunk per item)
        → artefactStore.put(stream)
→ publish by flipping ONE pointer, after put() resolves
```

Four properties this pipeline is responsible for:

- **Nothing buffers.** The item source is an async generator, the serializers emit one chunk per
  item, the storage adapter consumes a `Readable`, and `em.clear()` runs after every batch — in the
  selection loop as well as the hydration loop, because `emFactory()` forks and a manager that lives
  for the whole run retains every row it touched. Measured at 100 000 products: 38 MB of XML in
  205 s with peak live heap **+18.5 MB** over baseline, growing about 107 bytes per additional item
  (`backend/test/perf/product_feeds/generation-100k.test.ts`, `PERF_RUN=true`).
- **An item-level problem never aborts the run.** Skips and warnings are recorded per item; only a
  configuration failure ends the run.
- **Publication is one pointer flip after the object is complete.** A failed, empty or
  over-threshold run never touches `published_artefact_id`.
- **Overlap is refused, not queued.** The claim is a conditional `UPDATE` on
  `product_feeds.current_run_id`; the loser records `skipped(already_running)`.

The residual memory growth above is not the items: it is the channel's membership id list, which is
materialised before paging (about 90 bytes per product in the channel). That is O(the channel), not
O(the feed).

### Delivery

Delivery is a **post-publication side effect**, wired on the same seam as retention and the
failed-run notification: `deliverArtefact` is an optional port on `FeedGenerationDeps`, invoked on
the publishing branch and nowhere else. That placement is the requirement — a run that did not
publish must not deliver — and it is also what keeps a delivery failure away from the run, which
has already finished by the time the upload is attempted.

```
run publishes  →  deliverArtefact?(feedId, runId, artefactId)   [port, optional]
                    → enqueue on product_feeds.deliver
                      → resolve config + secrets
                        → adapter.send(stream, target)          [transport SPI]
                          → record attempt
```

With no Redis the port delivers **inline** instead of enqueueing. A single-process deployment
otherwise lets an operator configure a target, see no error, and never be delivered to.

Two tables, both owned by the module: `product_feed_deliveries` (one row per feed, enforced by a
unique index) and `product_feed_delivery_attempts` (append-only, bounded per feed).

**No secret column exists.** `credential_code` points at a `credentials`-module configuration, which
owns encryption at rest and masking on read; the split between secret and non-secret headers is
made by `isSecretDeliveryHeader` in the contracts package, deliberately by rule rather than by an
operator checkbox. `credentials` is therefore a *service* dependency in the manifest, not an
FK-driven one.

The transport SPI (`services/delivery/delivery-adapter.interface.ts`) takes a `Readable`, never a
`Buffer`, for the same reason the serializers do — and it is the overlay seam for a partner's
bespoke protocol. `HttpDeliveryAdapter` reuses the address rules in `taxonomy-source-url.ts` rather
than copying them: two SSRF guards in one module is one guard that gets fixed and one that does not.

Nothing recorded on an attempt is a credential. `target` is a redacted display form, and every
failure message goes through `delivery-redaction.ts`, which is **value-driven** — it is handed the
exact secrets in play and removes those strings, rather than guessing what a password looks like.

The test harness injects adapters that refuse every send, for the same reason it injects a taxonomy
fetcher that cannot fetch: no test in this repository may upload a priced catalogue anywhere.

### Channel scoping

Membership is read **only** through the injected
`SalesChannelMembershipService.listEntityIdsForChannel` port; the module never queries a
`sales_channel_*` bridge table. The eligibility floor, the operator's rule and the keyset cursor are
composed as an explicit `$and` — never an object spread, which silently drops a duplicated `id` key
and once dropped channel scoping entirely for category criteria.

There is no fail-open branch: an unresolvable or inactive channel raises `ChannelUnavailableError`
and the run fails closed. `backend/test/integration/product_feeds/channel-isolation.test.ts` is the
regression net, and it exercises the public URL as well, because that endpoint is unauthenticated.

### Auditing

Every operator write is a Command: `product_feeds.feed.create|update|delete|duplicate`,
`product_feeds.token.rotate|revoke`, `product_feeds.run.start`,
`product_feeds.template.create|update|duplicate|delete|import`,
`product_feeds.taxonomy_mapping.set`, `product_feeds.taxonomy_revision.promote` and
`product_feeds.taxonomy_check.start`. Each records exactly one audit entry attributed to the acting
administrator; a whole template import is one entry, not one per field.

The last two are worth reading together. Promoting a taxonomy revision is the **only** write in the
refresh mechanism that changes what a feed emits, so it is a Command; starting a check by hand is
audited because it records who asked the platform to make an outbound request, exactly as
`product_feeds.run.start` records who asked for a generation.

Machine work — a scheduled run, the retention sweep, the reaper, the schedule projection into Redis,
the taxonomy install, and **the scheduled taxonomy check together with the inactive revision it may
install** — records **nothing**, and each such write carries a `command-coverage-ignore: <reason>`
marker so the static checker stays honest. A scheduled check is machine work precisely because it
cannot change output: an audit row per weekly check on every installation would bury the operator's
actual decisions in noise, and the check history table is a richer record than an audit entry would
be. Pinned by `backend/test/integration/product_feeds/command-coverage.test.ts`.

### Provider taxonomies

A revision reaches the database by exactly two routes, and both produce the same kind of row.

**Bundled with the platform.** Revisions ship on disk under
`data/taxonomies/<providerCode>/<revision>/<language>.txt` and are installed by a boot reconciler in
one transaction per revision. This path opens no socket and never has. Installing the current drop
(8 562 nodes across four files) takes about **2 seconds**; after that the files are never opened
again, because the database is asked first. A bundled revision is marked current only when the
provider has no current revision yet — on a fresh database that is every first install, and on a
long-lived one it means a platform upgrade cannot silently replace a revision an operator chose.

**Fetched from the provider.** An optional check, **off by default**, downloads the provider's
published files and installs a changed revision **inactive** (see
[Taxonomy updates](#taxonomy-updates)). It cannot become the revision in force by itself.

**Generation never depends on reaching a provider.** A run reads the revision in force from
Postgres and contacts nobody, so a provider that is down, slow or serving nonsense produces a failed
*check*, never a failed or altered *run* — and an installation that leaves the switch off makes no
outbound request at all.

An installation with no bundled data boots normally: the mapping screen reports that no taxonomy is
installed, and `g:google_product_category` resolves as unmapped, which omits the field and still
emits the item.

The provenance, measured sizes and the **open licensing question** for the bundled vendor files are
recorded in `packages/modules/product_feeds/src/backend/data/taxonomies/PROVENANCE.md`. Removing a provider's
revision directory is the whole back-out; no code changes.

### Queues

Two BullMQ surfaces, registered only when `BACKEND_ROLE !== 'api'`:

- `product_feeds.generate` — one job per run; the worker claims, heartbeats per batch, generates,
  publishes and then enforces retention. Idempotent under redelivery.
- a module-wide sweep every 5 minutes releasing claims whose heartbeat has gone stale, marking the
  run `failed(worker_lost)` and deleting the partial object.

Per-feed schedules are BullMQ Job Schedulers keyed `feed:<id>`; the reconciler at start upserts
every enabled scheduled feed and removes every `feed:*` scheduler with no live counterpart.

### Storage

Artefacts go through the Assets Library storage adapter, but under this module's own locator prefix
(`product-feeds/…`), always **private**, and never as `Asset` rows: they are not library media, must
not appear in the asset browser, and must not be reachable by a public asset URL. The public feed
route streams the object itself, which is what makes token rotation actually revoke access.

### Testing

```bash
pnpm --filter backend exec vitest run test/unit/product_feeds
pnpm --filter backend exec vitest run test/contract/product_feeds
pnpm --filter backend exec vitest run test/integration/product_feeds
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/product_feeds
```

The shared test harness deliberately wires this module with **no Redis and no BullMQ** — it runs once
per test file in a single fork, and queue connections there have previously taken hundreds of files
down with "too many clients". Tests drive `productFeeds.generation.generateNow(...)` directly. The
harness also points the taxonomy reconciler at a non-existent directory, so only
`taxonomy-bundled-data.test.ts` ever reads the shipped data files.

### Deliberately out of scope in this version

- E-mail delivery, and marketplace-specific APIs (Amazon SP-API, eBay, Allegro). Push delivery
  covers SFTP, FTP and HTTP only — see **Delivery** above.
- Incremental, supplemental or delta feeds — every run regenerates the whole file.
- Multiple countries or currencies in one file; duplicate the feed instead.
- A runtime taxonomy download.
