---
title: seo
description: Meta-tag resolver, cached XML sitemap, the search engine robots settings and llms.txt
---

# `seo`

Per-page meta-tag resolution, the public XML sitemap, and what search engines are told about
a sales channel's storefront as a whole.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | Cached XML sitemap; falls through to inline regenerate when stale |
| `GET /api/v1/storefront/seo/robots-policy` | storefront | The request's sales channel's default robots policy, as `{ index, follow }` |
| `GET /api/v1/storefront/seo/crawler-files` | storefront | What the request's sales channel's `robots.txt` and `llms.txt` are built from: its custom instructions and additional content, with the policy, the shop name and whether the store is open to anonymous visitors. Answered on a store closed to them as well |
| `GET /api/v1/admin/seo/crawler-files/preview` | admin (`settings:read`) | The preview of a sales channel's `robots.txt` or `llms.txt` — the system default channel when none is named: the part its storefront generates, asked of that storefront, beside the saved text |
| `GET /api/v1/admin/seo/sitemap` | admin (`catalog:write`) | One row per sales channel: storefront address, last-generated timestamp, size, URL count |
| `POST /api/v1/admin/seo/sitemap/:channelCode/regenerate` | admin (`catalog:write`) | Force a fresh build for that channel |
| `GET /api/v1/admin/seo/sitemap/:channelCode/status` | admin (`catalog:write`) | Last-generated timestamp + size + URL count for that channel |
| `GET /api/v1/admin/seo/sitemap/:channelCode/xml` | admin (`catalog:write`) | That channel's cached XML, inline or as a download (`?download=1`) |
| `GET /api/v1/admin/seo/meta/product/:id` | admin (`catalog:read`) | A product's metadata at a scope (`?channelId=`, `?languageCode=`): each field's own or inherited value, the resolved metadata and where each value came from |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | admin (`catalog:write`) | A category's or CMS page's resolved meta at a language (`?locale=`) + the override row there |
| `PUT /api/v1/admin/seo/meta/:entityType/:entityId` | admin (`catalog:write`) | Create or update a category's or CMS page's override at a language (`locale` in the body); a product answers `422 VALIDATION_FAILED` |
| `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | admin (`catalog:write`) | Remove a category's or CMS page's override at a language (`?locale=`); a product answers `422 VALIDATION_FAILED` |

## Search engine robots

**Settings → SEO → Default robots** decides what search engines are told about every page of a
sales channel's storefront. It is the switch for taking a whole storefront out of search — a
staging copy, a demo, a shop that has not opened yet — without touching any page.

| Choice | Search engines are asked |
| --- | --- |
| `INDEX, FOLLOW` (default) | nothing: every page says what it said before |
| `NOINDEX, FOLLOW` | not to list the storefront's pages, but to follow their links |
| `INDEX, NOFOLLOW` | to list the pages, but not to follow their links |
| `NOINDEX, NOFOLLOW` | not to list the pages and not to follow their links |

The four choices are the directives themselves and read the same in every language. Like any
setting it takes a value for all sales channels and a value per channel; a channel's own value
wins, and resetting it makes the channel inherit again. Changing it takes `settings:write`, and
the change is recorded in the audit log with who made it, when, and the value written. The
command palette (⌘K / CTRL+K) opens the Settings screen under *Search engine robots*.

### What the storefront does with it

For a channel whose default restricts something, the storefront adds the directive to the
responses it serves for that channel, in two forms:

- an `X-Robots-Tag` response header — on every page, including not-found (`404`) pages and the
  offline page, on `/sitemap.xml`, on optimised images (`/_next/image`) and on the files under
  `public/`;
- one extra `<meta name="robots">` element in the `<head>` of the pages the shop renders for a
  request.

Three kinds of response are outside it, and none of them is something a search engine indexes:

- the build's own script and style files under `/_next/static` carry neither;
- a redirect declared in the storefront's `next.config.js` (such as the old `/cms/…` addresses)
  carries neither — it is answered before the storefront's middleware runs;
- not-found (`404`) pages and the statically built `/offline` page carry the header but not the
  extra element. Both already declare `noindex, nofollow` for themselves.

**It only adds restrictions.** A page that declares `noindex` for itself — the cart, the
checkout, the account pages — keeps its own tag whatever is chosen here, and such a page then
carries two robots tags. A search engine that reads several robots directives for one address
applies the most restrictive of them, so the default can never make a private page indexable.
With `INDEX, FOLLOW` nothing is added at all, and the storefront's responses are what they were
before the setting existed.

### Why `robots.txt` stays open

*Default robots* does not change `robots.txt`, and a `NOINDEX` channel must not close it with
`Disallow: /`. A crawler has to fetch a page to read that it must not be indexed; a page it is
forbidden to fetch can still be listed, by its address alone, when other sites link to it.

The same holds for what an operator writes into the file — see
[*Do not use it to leave search results*](#do-not-use-it-to-leave-search-results) below.

### How long a change takes

The storefront asks the backend for a channel's policy at most once a minute, so a saved change
is in force on the storefront within a minute or two. Search engines apply it when they next
visit each page, which takes days or weeks; a page already in the index leaves it only after it
has been crawled again.

Reading the policy does not slow the shop down when the backend is slow. A storefront that
already knows a channel's policy gives a refresh a fraction of a second and otherwise goes on
serving what it knows, letting the refresh finish in the background.

### When the module is switched off

Switching `seo` off on the platform modules screen withdraws the default: the storefront stops
sending the header and the extra tag within a minute or two, so **a channel set to `NOINDEX`
becomes indexable again**. The setting turns read-only and keeps its stored value, the command
palette entries disappear, and `GET /api/v1/storefront/seo/robots-policy` answers `503`
`MODULE_DISABLED`. Switching the module back on applies the stored value again.

The custom `robots.txt` instructions are withdrawn with it, on the same terms: `robots.txt`
goes back to the rules the storefront generates and stays available, the setting turns read-only
and keeps its text, and the text is served again when the module is switched back on.

`llms.txt` goes with it too, and entirely: while the module is off the storefront answers
`/llms.txt` with "not found", because the whole file is this feature's. The additional content
is kept, its setting turns read-only, and the file is served again when the module is switched
back on.

### Two limits

- **Files the backend serves are not covered.** Product images and other uploaded media are
  served by the backend, from its own address, and carry no `X-Robots-Tag`. A `NOINDEX` channel's
  pages leave search; its image files can still be found by an image search that reaches them
  directly.
- **A freshly started storefront knows nothing yet.** The storefront keeps the last policy it
  read in the memory of its own process and goes on applying it while the backend cannot be
  reached. A storefront that starts while the backend is unreachable has nothing to apply, and
  serves that channel's pages without the default directive until its first successful read.
  It is also the one moment a response waits for the policy: the first read of a channel after
  a start is waited for, up to two seconds, once. No page is ever answered with an error because
  the policy could not be read.

### A storefront scaffolded before this feature

The directive is applied by the storefront's own `middleware.ts` and `app/layout.tsx`, the
custom instructions by its `app/robots.txt/route.ts`, and `llms.txt` by its
`app/llms.txt/route.ts`. A storefront created from an earlier
release keeps working with an upgraded backend, but it **ignores these settings** until those
files are updated: the Settings screen shows the choice and the text, and nothing in that
storefront acts on them — its `robots.txt` stays the file it was built with, and it has no
`llms.txt`. The Settings screen
says so where it has evidence: when a storefront answers the backend without confirming that it
supports these settings, the *Default robots* row and the two previews say that it may run an
older version that does not apply them. The release notes list the files to copy, and the one to delete: a storefront that keeps its old `app/robots.ts`
beside the new route goes on serving the old file, and the build does not say so.

### For a custom storefront

`GET /api/v1/storefront/seo/robots-policy` is public and resolves the sales channel from the
request's `X-Sales-Channel` header, or the system-default channel when there is none:

```json
{ "data": { "index": false, "follow": false } }
```

The answer is sent with `Cache-Control: no-store`; the consumer is expected to cache it. The
schema is `storefrontRobotsPolicyResponseSchema` in `@endora-commerce/contracts`; a consumer
should ignore members it does not know, so that a later release can add one.

Treat the statuses differently. `503` with `error.code: "MODULE_DISABLED"` and `404` mean there
is no policy — apply none. Any other failure, including a `500`, means the policy could not be
read: keep the last one you read. The endpoint answers `500` rather than "no restriction" when
the stored value is not one of the four choices, which takes a row written around the settings
API.

## Custom `robots.txt` instructions

**Settings → SEO → Custom robots.txt instructions** is text the storefront adds to the
`robots.txt` of a sales channel — rules for a particular crawler, an extra `Disallow`, a
`Crawl-delay`. It is empty by default, and an empty text leaves the file exactly as it was.

### What the file contains, and in what order

1. **The rules the storefront generates.** They close the address families that are never
   indexed — the cart, the checkout, the account, the sign-in pages, `/api/` — and name the
   sitemap. They mirror the storefront's own routes; they are not a setting, and nothing on the
   Settings screen can edit or remove them.
2. **A blank line.**
3. **Your text**, as you wrote it.

For example, with `User-agent: GPTBot` and `Disallow: /` saved for a channel:

```text
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /account
…
Disallow: /offline

Sitemap: https://shop.example.com/sitemap.xml

User-agent: GPTBot
Disallow: /
```

The text is served **as written**: every character is kept, in order — indentation, blank
lines, comments. Two things about line breaks are made uniform: every line break is served as a
line feed, however the text was saved, and the file always ends with exactly one. And one
invisible character is left out: a byte order mark at the very start of the text, which some
editors add when a file is saved — a crawler would not recognise the line it is attached to.
Nothing in the text is checked or corrected; a line a crawler does not understand is served like
any other.

**A group you write for one crawler replaces the generated rules for that crawler.** A crawler
follows the group that names it and ignores the `*` group when one does, so after
`User-agent: GPTBot` and your own rules, GPTBot no longer sees the generated `Disallow` lines.
Repeat them in that group if you still want them to apply to it. The generated lines themselves
cannot be changed, but an `Allow` of the same length as a generated `Disallow` wins over it.
Whether a page can be indexed does not depend on any of this: the pages those rules close say
`noindex` themselves.

Like any setting it takes a value for all sales channels and a value per channel, and a
channel's own value wins — including an empty one, which gives that channel no custom
instructions whatever the all-channels text says. One channel's text is never served in another
channel's file. **Reset** removes the channel's own text, so the channel inherits the
all-channels text again; resetting that as well leaves the generated rules alone. Changing the
text takes `settings:write` and is recorded in the audit log.

### The preview

Below the field, the Settings screen shows the `robots.txt` the sales channel's storefront
serves, as **one block that is the file** — the same text, line for line, that a crawler
downloads:

- the lines the storefront generates come first, with its own `Sitemap:` line, labelled
  **Generated by the storefront · read-only**. They are the storefront's, and the Admin UI asks
  the storefront for them each time rather than keeping a copy that could go stale;
- then a blank line, then your lines, marked with a bar on the left and labelled **Your
  instructions**.

The heading says which file you are looking at. With nothing unsaved it is **robots.txt as
served now**. As soon as the field differs from what is saved, the block follows what you type
and the heading becomes **robots.txt after saving** — the file the storefront will serve once
you save; until then it keeps serving the previous version, and the preview says so. Previewing
changes nothing the storefront serves.

The preview is of the sales channel chosen at the top of the Settings screen. Under **All
channels** it shows the result for one channel you pick in the preview, and names the channels
that have a value of their own — the text for all channels does not reach those, and picking
one of them shows the file that channel serves instead. An administrator who may not list sales
channels is shown the system default channel.

On a sales channel whose *Default robots* is `NOINDEX`, the preview says that `robots.txt`
stays open on purpose, and warns when your text forbids every crawler to fetch anything
(`Disallow: /`) — see [why `robots.txt` stays open](#why-robotstxt-stays-open).

An administrator who may see settings but not change them sees the preview too.

#### When the preview cannot show the file

The preview never shows rules it did not just obtain. In each of these cases your own text is
still shown, on its own, and saving works as usual:

| The preview says | What it means | What to do |
| --- | --- | --- |
| *The storefront could not be reached* | The storefront did not answer within three seconds, refused the connection, answered with an error or a redirect, or answered something that is not a plain-text `robots.txt` | Check that the storefront is running and that the channel's **Storefront URL** is its real address — the address the storefront itself answers at, not one that redirects to it. **Check again** asks once more. The server log names the reason |
| *This sales channel has no storefront address configured* | Neither the channel's **Storefront URL** setting nor `STOREFRONT_BASE_URL` is set, so there is no address to ask | Set **Settings → Sales Channels → Storefront URL** for the channel |
| *This storefront did not confirm that it supports custom instructions* | The storefront answered with a `robots.txt`, but without the header by which a current storefront identifies itself. Most often it runs a version from before this feature, which serves only its generated rules — shown as the file — and ignores your text and *Default robots*. A proxy that removes the header, or a storefront that was updated only in part, looks the same | Update the storefront — see [a storefront scaffolded before this feature](#a-storefront-scaffolded-before-this-feature) — and check with `curl -sI <storefront>/robots.txt` that `X-Endora-Crawler-Files` arrives. A matching message appears on the *Default robots* row |
| *This address is shared by every sales channel* | The address comes from `STOREFRONT_BASE_URL`, one address for all channels, so the preview is of that shared storefront | Nothing, on an instance with one storefront. With a storefront per channel, set each channel's **Storefront URL** |

#### What the backend asks the storefront

To show the generated rules, the backend makes one request to the channel's storefront:
`GET <origin of the channel's storefront address>/robots.txt?part=system`, with the channel's
code in `X-Sales-Channel`. It is made only for a signed-in administrator who may read settings,
only to the configured address — nothing the administrator's browser sends is part of it — and
only to the address's origin: a path or query in the configured address is not used, because a
`robots.txt` lives at the root of a site. It follows no redirect, waits at most three seconds,
reads at most 512 KiB, accepts only `text/plain`, and sends no cookie and no credentials. Nothing
it receives is stored.

The storefront must therefore be reachable **from the backend** at the configured address. A
storefront that is public but not routable from the backend's network shows as unreachable in
the preview and is otherwise unaffected.

### The size limit

A text may be at most **64 KiB** (65 536 bytes of UTF-8 — a letter outside ASCII counts as two
bytes or more). A larger text is refused when it is saved, with a message that names the limit,
and the text saved before stays in force. Search engines read only the first 500 KiB of a
`robots.txt`; the limit keeps the whole file far inside that.

### Do not use it to leave search results

`robots.txt` controls what a crawler may **fetch**. It does not control what a search engine
**lists**. A page that may not be fetched can still appear in results — by its address alone,
without a description — when other sites link to it.

To take a storefront out of search, set *Default robots* to `NOINDEX`. And do not add
`Disallow: /` on top of that: a crawler that may not fetch a page never reads the `noindex` on
it, so the rule that looks like the stronger one switches the working one off. Nothing written
here can make a page that declares `noindex` indexable; it can only stop crawlers from seeing
that it does.

### Behind a proxy or a CDN

The file is different for each sales channel, and the storefront learns the channel from the
`X-Sales-Channel` request header. It sends the file with `Cache-Control: public, max-age=60` and
`Vary: X-Sales-Channel`. Two things follow for what stands in front of a storefront that serves
more than one channel:

- the reverse proxy must set `X-Sales-Channel` itself, per host, and must not pass through a
  value a visitor sent — otherwise a visitor chooses whose file they are shown;
- a shared cache that ignores `Vary` on such a header must include the header in its cache key,
  or not cache `/robots.txt` at all — otherwise one channel's file is served for another.

A storefront that serves a single channel needs neither; its proxy can remove the header.

### How long a change to the file takes

The storefront asks the backend for a channel's text at most once a minute and lets a crawler
keep the file for another minute, so a saved change is served within about two minutes. Search
engines fetch `robots.txt` on their own schedule, usually about once a day.

### When the text cannot be read

A storefront that has read a channel's text once goes on serving that version for as long as
the backend cannot be reached. A storefront that has not — one started while the backend was
down — answers `robots.txt` with `503` and `Retry-After: 120` until its first successful read,
instead of serving the generated rules alone.

That is deliberate, and it differs from what pages do. A `robots.txt` answered with `200` is a
complete statement of what may be fetched, so a file that silently left out your `Disallow`
lines would be permission you did not give. A search engine reads a `503` as "ask again later"
and goes on using the copy it already has. No customer reads this file, so nothing a customer
sees depends on it.

The first read of a channel after a start is waited for, up to two seconds — and a request
for `robots.txt` makes two such reads one after the other, the channel's default robots policy
and then its text, so against a backend that accepts connections and does not answer the first
request can take four to five seconds. The storefront then does not ask again for five seconds and
answers at once. While the `seo` module is switched off, and against a backend that does not
have this feature, the storefront serves the generated rules alone with `200` — those are
answers, not failures.

### Reading the text from a custom storefront

`GET /api/v1/storefront/seo/crawler-files` is public and resolves the sales channel as
`robots-policy` does:

```json
{
  "data": {
    "index": true,
    "follow": true,
    "robotsTxtCustom": "User-agent: GPTBot\nDisallow: /\n",
    "llmsTxtAdditional": "## About\n\nWe sell bolts.\n",
    "shop": { "name": "Endora Demo" },
    "anonymousAccess": true
  }
}
```

`robotsTxtCustom` and `llmsTxtAdditional` are the texts resolved for the channel, exactly as
stored — the backend changes no character of them, line breaks included. `index` and `follow`
repeat the channel's policy, and `shop.name` is its configured shop name or an empty string.
`anonymousAccess` is `false` on a store closed to anonymous visitors — see
[on a store closed to anonymous visitors](#on-a-store-closed-to-anonymous-visitors); a backend
from before that setting does not send it, and its absence means `true`. Unlike every other
anonymous read of such a store, this one is answered. The
schema is `storefrontCrawlerFilesResponseSchema` in `@endora-commerce/contracts`, which also
exports `composeCrawlerFile(base, extra)` — the function the reference storefront joins what it
generates and the text with — and `CRAWLER_TEXT_MAX_BYTES`.

The answer is sent with `Cache-Control: no-store`. Treat the statuses as for `robots-policy`:
`503` `MODULE_DISABLED` and `404` mean there is no custom text; anything else, a `500` included,
means it could not be read, and a `robots.txt` should then be the last version you served, or a
`503` — not a file without the text.

**The parts of the answer fail apart.** A stored value that cannot be served takes a row written
around the settings API, and what the endpoint does with one depends on which file needs it:

- unreadable `robots.txt` instructions — not a text, or longer than can be saved — fail the whole
  answer with `500`, rather than answer an empty text;
- an unreadable *Default robots* value, or unreadable `llms.txt` content, is **named** in an
  extra member, `"unreadable": ["policy"]` or `["llmsTxtAdditional"]`, and the rest is answered.
  `index` and `follow` are then both `false`, and `llmsTxtAdditional` is then empty; neither is to
  be taken for the stored value.

So a `robots.txt`, which needs neither, is still served on a channel whose *Default robots* row
holds something nobody can interpret, and an `llms.txt`, which needs both, is not: answer it with
a `503` while either is named. The member is absent when everything was read; ignore names you
do not know. `robots-policy` itself keeps answering `500` for such a row, so pages keep the
directive they last knew.

The reference storefront's `robots.txt` also answers `GET /robots.txt?part=system` with its
generated rules alone, and its `llms.txt` answers `GET /llms.txt?part=base` with its generated
part alone — both sent with `Cache-Control: no-store`, because each is the file without the
operator's text at an address a cache could mistake for the real one — and it marks every answer
of either file with an `X-Endora-Crawler-Files: 1` header.

## Additional `llms.txt` content

`llms.txt` is a plain-text file at the root of a site that tells AI assistants what the site is
and where its public content starts — a newer and less settled convention than `robots.txt`
([llmstxt.org](https://llmstxt.org)). The storefront serves one for each sales channel, at `/llms.txt`, and
**Settings → SEO → Additional llms.txt content** is text it adds to that file. The setting is
empty by default, and the file is then the generated part alone.

### What the file contains, and in what order

1. **The part the storefront generates**: the shop's name as a heading, links to its main public
   pages — the home page, the catalog, search, the blog, the contact page — and a link to the
   sitemap, each with a full address.
2. **A blank line.**
3. **Your text**, as you wrote it — a description of the shop, links to the pages you most want
   an assistant to read, anything the convention allows.

For example, with a short description saved for a channel:

```text
# Endora Demo

## Pages

- [Home](https://shop.example.com/)
- [Catalog](https://shop.example.com/catalog)
- [Search](https://shop.example.com/search)
- [Blog](https://shop.example.com/blog)
- [Contact](https://shop.example.com/kontakt)

## Sitemap

- [Sitemap](https://shop.example.com/sitemap.xml)

## About

We sell industrial fasteners to businesses across Poland.
```

The shop's name is the **Shop name** setting of the sales channel; a channel without one is named
by the storefront's host. The generated part lists only pages that are public and may be indexed
— the same list the sitemap starts with — and never an address `robots.txt` closes to crawlers
(the cart, the checkout, the account, the sign-in pages). A listed page that is not there at the
moment is left out: the blog link is not written while the `blog` module is switched off or the
channel has no blog. The addresses use the storefront's one public origin, as the sitemap does:
a storefront that serves several sales channels names that origin in every channel's file, with
each channel's own shop name. The generated part is in English, and cannot be edited on the Settings
screen.

Your text is served **as written**, on the same terms as the `robots.txt` instructions: every
character is kept, line breaks are served as line feeds, the file ends with exactly one, and a
byte order mark at the very start is left out. Like any setting it takes a value for all sales
channels and a value per channel, a channel's own value wins — an empty one included — and one
channel's text is never served in another channel's file. **Reset** removes the channel's own
text. Changing it takes `settings:write` and is recorded in the audit log. The text may be at
most **64 KiB**, the limit of the `robots.txt` instructions, and a larger one is refused with a
message that names the limit.

### When no `llms.txt` is served

**A sales channel whose *Default robots* is `NOINDEX` has no `llms.txt`**, whatever the
additional content holds: the storefront answers `/llms.txt` with "not found". A shop that asks
search engines to stay away does not at the same time invite AI assistants in. The text is kept
and is served again as soon as the channel allows indexing. `NOFOLLOW` alone withdraws nothing.

The file is also not served while the `seo` module is switched off — see
[when the module is switched off](#when-the-module-is-switched-off).

This is the one place where the two files differ. `robots.txt` is served in every state, and
stays open on a `NOINDEX` channel on purpose; `llms.txt` is withdrawn.

### The preview

Below the field, the Settings screen shows the `llms.txt` the sales channel's storefront serves,
in the same way as [the `robots.txt` preview](#the-preview): **one block that is the file**, the
generated lines first and your lines marked with a bar and labelled **Your content**, under a
heading that says **llms.txt as served now** or — while the field differs from what is saved —
**llms.txt after saving**. The channel picker under **All channels**, the note about channels
with a value of their own, and the messages for a storefront that cannot be reached or has no
address configured are the same as there.

On a sales channel whose *Default robots* is `NOINDEX` there is no file to show, and the preview
says so instead: **llms.txt is not served**, with the reason. Changing *Default robots* back and
saving it brings the block back.

*This storefront did not confirm that it serves llms.txt* means that the storefront answered
without the header by which a current storefront identifies itself — most often because it runs
a version that has no `llms.txt` at all. See
[a storefront scaffolded before this feature](#a-storefront-scaffolded-before-this-feature).

To show the generated part the backend asks the channel's storefront for
`/llms.txt?part=base`, under exactly the rules given under
[what the backend asks the storefront](#what-the-backend-asks-the-storefront). One difference in
what the answer tells an administrator who may read settings: when the configured address
answers "not found" without the storefront's header, this preview says that the storefront did
not confirm that it serves the file, rather than that it could not be reached — so an address
where some web server answers can be told from one where nothing does.

### How long a change takes, and when the file cannot be read

As for `robots.txt`: a saved change — to the text, or to *Default robots* — is served within
about two minutes, and the file is sent with `Cache-Control: public, max-age=60` and
`Vary: X-Sales-Channel`, so what stands [in front of the storefront](#behind-a-proxy-or-a-cdn)
has to treat `/llms.txt` as it treats `/robots.txt`. A "not found" answer is sent with
`Cache-Control: no-store`.

A storefront that has read a channel's configuration once goes on serving that version of the
file while the backend cannot be reached. One that has not answers `/llms.txt` with `503` and
`Retry-After: 120` until its first successful read — never a file without your text, and never a
file on a channel that may have been set to `NOINDEX`.

## On a store closed to anonymous visitors

A sales channel whose *open to anonymous visitors* switch is off answers every anonymous visitor
with the sign-in page — a crawler is one. There is nothing on it to fetch, list or read, and its
sitemap is empty. Its `robots.txt` and `llms.txt` are still served, and say exactly that:

- **`robots.txt`** closes the whole store to every crawler, and names no sitemap:

  ```text
  User-Agent: *
  Disallow: /
  ```

- **`llms.txt`** names the store, as the generated part does, and says that its content is for
  signed-in customers. It lists no page and no sitemap:

  ```text
  # Endora Trade

  > The content of this store is available to signed-in customers only.
  ```

**The closed store wins over the settings.** Neither the custom `robots.txt` instructions nor the
additional `llms.txt` content is served on a closed store: a group written for one crawler would
replace `Disallow: /` for that crawler and open the store to it, and the additional content
would point at pages nobody can read anonymously. Both texts are kept, and are served again as
soon as the store is opened to anonymous visitors. For the same reason *Default robots* has no
say in either file here: a `NOINDEX` closed store still has its `llms.txt`, because that file
invites nobody anywhere.

The switch reaches the files on the same terms as any other change — within about two minutes.
A store that is open to anonymous visitors serves both files exactly as described above. While
the `seo` module is switched off the storefront cannot tell a closed store from an open one, and
serves the generated `robots.txt` and no `llms.txt`, as it does on every store.

The previews on the Settings screen do not take a closed store into account yet: they show your
text joined to the generated part, while a closed store serves the file above without it.

## Meta-tag resolution

### Products: Global, Channel, Channel × language

A product's metadata — title, description, Open Graph title, description and image — follows the
product scopes:

| Scope | Addressed by | Applies to |
| --- | --- | --- |
| Global | neither | every sales channel and language |
| Sales channel | `channelId` | every language of that channel |
| Sales channel × language | `channelId` and `languageCode` | that language in that channel |

There is no language-only product scope; the upgrade removes the product overrides that were
stored per language only (see *Upgrading* below). Each field is resolved on its own, from the
narrowest scope that holds it: Channel × language, then Channel, then Global, then the value
derived from the product — its effective name and description at that channel and language. A
field stored deliberately empty at a scope stops the chain there, and the page then uses the
derived value.

**Edited in the product editor.** The product editor's SEO section shows each field at the
editor's scope, with "Use value from *parent scope*", and saves it with the rest of the product
in one Command (`product.scoped_values.save`) — one audit entry whose cells are named
`seo:<field>@<scope>`. The title and the Open Graph title take at most 160 characters, the
descriptions 400 and the image URL 2 048; an image URL is an `http(s)` URL without user
information. A refused field refuses the whole save. The generic `PUT` and
`DELETE /api/v1/admin/seo/meta/product/:id` answer `422 VALIDATION_FAILED`
(`reason: product_seo_saved_with_product`); the SEO screen's editor links to the product editor
for a product. While `seo` is switched off, a product save that names SEO fields is refused with
`503 MODULE_DISABLED`; one that does not is unaffected. Duplicating a product copies its metadata
at every scope.

**Reading it.** `GET /api/v1/admin/seo/meta/product/:id` (`catalog:read`) answers, at the
scope named by `channelId` and `languageCode`, each field's own value or its inheritance, the
resolved metadata and the source of each value. A language without a channel is refused with
`422 VALIDATION_FAILED`; a channel the product is not in, or a language the channel does not
offer, with `422 SCOPE_INVALID`.

**For other modules.** `seoProductMetaWritePort` reads and writes a product's metadata at any
scope on the caller's transaction, without an audit entry of its own; `catalog`'s save and
duplicate are its callers, and they check the scope first.

**The product page serves them.** The storefront's product page takes its title, description and
Open Graph tags from this resolution at the request's sales channel and language. While `seo` is
switched off the page shows the derived metadata, and every override comes back when the module
is switched on.

### Categories and CMS pages

A category's or CMS page's override sits at a language (`locale`) and applies in every sales
channel; a request naming no language is the `en-US` override. A `channelId` on a category or a
CMS page is refused with `422 VALIDATION_FAILED`. Each field is resolved from the language's
override, then from the value derived from the entity (Category name + auto-summary). An override
never answers for another language.

**In the admin.** The SEO screen's meta-tag editor loads a category's or a page's language as soon
as it is chosen (**Load** reads it again). Leaving a language with unsaved changes asks first, and
**Use inherited** asks before it removes the override shown.

**Every change is audited.** Saving an override is one `seo_meta_override.upsert` entry in the
audit log, removing one a `seo_meta_override.delete` entry, each with the whole override before
and after. To put back an earlier version, save the values from the entry's *before* state.
Removing an override that does not exist changes nothing and writes no entry.

### Upgrading

The upgrade deletes every product override stored for a language without a sales channel — there
is no such scope any more. Category and CMS page overrides are unchanged. Re-enter at a channel
and language, or at Global, any product metadata that only a language override held.

Title and description are truncated at 60 / 160 characters with an ellipsis.
The truncation lives in one helper so changes to the SEO budget happen in
one place.

## Sitemap

`SitemapGeneratorService.regenerate()` walks the channel's products, categories and CMS pages,
stamps absolute URLs against the channel's storefront address, and writes the XML payload to the
channel's `sitemap_cache` row. A product is listed once for every language it is live in on the
channel, each URL on the product's effective URL key there — its Channel × language key, else its
Channel key, else its Global key — under the language's path prefix.

The public route (`GET /catalog/sitemap.xml`) returns the cached payload;
when the row is older than `staleAfterMs` (default 6 h) it regenerates
inline. A product change that alters what a sitemap lists — its status (global, in a channel or
in a channel and language), its archiving, its publication window (including the moment a window opens or
closes), its audience (global or per channel) or its URL keys — marks every channel's cached
sitemap stale, so the next request rebuilds it. A
`Cache-Control: public, max-age=3600` header is set on the
response so well-behaved CDNs hold the payload for an hour.

## Anonymous-only filtering

A product is listed in a channel's sitemap only where it is available there to an anonymous
visitor at generation time: a member of the channel, not archived or deleted, on in that channel
language, inside its publication window, and admitted by its effective audience rule (the
channel's, else the global one). A product off globally but on in the channel is listed; one
switched off in the channel is not. Soft-deleted categories are excluded too.

The contract is simple: only what an anonymous Customer can see is
ever exposed to crawlers.

## Entities

`SeoMetaOverride` (entityType, entityId, salesChannelId?, locale?, title?, description?,
ogTitle?, ogDescription?, ogImageUrl?). A product row has neither `salesChannelId` nor `locale`
(Global), a `salesChannelId` (Channel) or both (Channel × language); a category or CMS page row has
a `locale`. On a product row a `null` field inherits and `''` is deliberately empty. `SitemapCache` (singleton key,
payload, urlCount, byteSize, generatedAt).
An override's `ogImageUrl` is an `http(s)` URL or a path starting with a single `/`; any other
value is refused with `400 VALIDATION_FAILED`.

## Extension points

- **CMS pages** — when a CMS module ships, hook its slug + body into both
  `MetaTagResolverService.loadRuleSource()` and
  `SitemapGeneratorService.regenerate()`.
- **Sitemap index** — for catalogues > 50 000 URLs, split into per-section
  sitemaps and emit a `<sitemapindex>` from this module's route.
- **Scheduled regenerate** — wire a BullMQ repeatable into the production
  composition root that calls `regenerate()` nightly.
