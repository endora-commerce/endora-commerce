# Quickstart: Forms (`specs/170-forms-module/`)

How to bring the feature up locally and walk the independent tests of every story. Run from the repo
root. Never run `db:fresh`, `db:reset`, `setup` or `module:*` against a database you care about.

## 0. Build and migrate

```bash
pnpm install
pnpm run build:packages                       # every package resolves at ./dist (D-164)
pnpm --filter backend run composer:check      # generated artefacts match the tree
pnpm run dev:infra                            # Postgres, Redis, Meilisearch
pnpm --filter backend exec tsx --env-file-if-exists=.env src/db/migrate.ts up   # non-destructive
# boot convergence registers `forms` as installed; it declares no installHook, so nothing else is owed
pnpm run dev                                  # backend API + worker, admin, storefront
```

Sign in to the admin as a platform admin. `/platform/modules` lists **Forms** with its activation
control (on by default).

## 1. US1 — build and publish

1. ⌘K → "New form" → name *Quote request*, default language `en`.
2. Drag a single-line text, an e-mail (mark *Submitter e-mail*), a select with two options and a
   privacy consent into a one-column section; add a three-column section with a number, a date and a
   country. Reorder one field with the keyboard (Space, arrows, Space).
3. Give two fields the same key → **Publish** is refused, the reason sits next to both fields.
4. Fix it, publish → version 1. Change a label, add a field, publish → version 2; the versions list
   shows both; `GET /api/v1/admin/forms/:id/versions/1` still has the old label.
5. Close the form → it shows *Closed*; reopen.

## 2. US2 — place and submit

1. CMS → a page → Page Builder → *Forms* category → **Form** block → pick *Quote request*; choose
   *underline*, size *L*, centre. Publish the page.
2. Storefront: open the page, submit valid answers → confirmation inline (JS on).
3. Disable JavaScript, submit with the e-mail missing → the page returns scrolled to the block with
   the answers kept and an error summary; fix and submit → confirmation.
4. Admin → **Form entries**: two entries with version 2, the channel, the language and the page.

## 3. US3 — logic and server authority

Add "I am buying as" (radio: *person*, *company*) and "Company name" (text, required) shown only when
the radio equals *company*. In the preview, toggling the radio shows/hides the field. Then post
directly:

```bash
curl -s -X POST "$API/api/v1/storefront/forms/$FORM_ID/entries" \
  -H 'content-type: application/json' -H "x-sales-channel: default" \
  -d '{"values":{"buying_as":"person","company_name":"ACME","email":"a@example.test","privacy":"on"}}'
# 201 — and the stored entry has no company_name (hidden ⇒ discarded)
curl … -d '{"values":{"buying_as":"company","email":"a@example.test","privacy":"on"}}'
# 400 FORM_SUBMISSION_INVALID, details.fields[0] = { fieldKey: "company_name", code: "required" }
```

Make "Company name" depend on itself through another field → publishing is refused
(`cyclic_visibility`).

## 4. US4 — entries

Filter by form, status *new*, a date range and the channel; search part of an e-mail. Open an entry
→ status becomes *read*; add a note; set *spam*, then *Undo*. Export CSV (form chosen): metadata
columns, one column per key across versions, a cell starting with `=` is prefixed with `'`. Sign in as
an admin scoped to one organisation: only that organisation's entries; an anonymous entry's URL
answers 404.

## 5. US5 — notifications

Set default recipients and a different list for one channel; submit on that channel → each override
recipient gets one message with Reply-To = the submitter; on another channel the default list gets
it. Turn on the confirmation e-mail with a summary → the submitter receives one, in the page's
language. With no SMTP configured the console driver logs them; `email`'s delivery records show
recipient, kind and subject only.

## 6. US6 — spam and restrictions

Settings → *Forms*: provider *Turnstile*, site key and secret (Cloudflare's documented test keys work
locally). Require CAPTCHA on the form → the widget appears only on pages holding it; a submission
without a token → `FORM_CAPTCHA_FAILED`. Set maximum entries 1 → the next submission is refused and
the block shows *full*. Set a window in the future → *not yet open*. *Signed-in only* → a guest sees
the sign-in prompt and a guest POST answers `409 FORM_NOT_ACCEPTING` `sign_in_required`. Fill the
honeypot (`hp_extra`) → `201` and nothing stored. Eleven posts in ten minutes → `429`.

## 7. US7 — languages

Switch the builder's content language to *pl-PL*, translate the labels and messages; leave one
label empty → its input shows the English label as a placeholder, the language switch marks *pl-PL*
with one untranslated text, and the storefront shows the English label there. Submit on
the Polish storefront → validation messages, confirmation and e-mail in Polish; country names in
Polish.

## 8. US8 — event and webhook

Webhooks → new subscription → *forms.entry.submitted.v1* is offered. Mark the e-mail field *Share
with integrations*; submit → one delivery whose payload carries `answers.email` and nothing unmarked.

## 9. US9 — retention

Set retention 1 day (the builder warns how many entries that deletes); in a test, drive the tick
directly:

```bash
pnpm --filter backend exec vitest run test/integration/forms/retention.test.ts
```

## 10. US10 — off and on

Switch **Forms** off on `/platform/modules`: the block leaves the palette (stored blocks show a
note), the page renders without it, `/forms/submit` answers 404, every forms API answers 503, no
sidebar/palette/settings/webhook type. Switch on → everything as before.

```bash
pnpm --filter backend exec vitest run test/integration/forms/off-state.test.ts
```

## 11. Verification bundle

```bash
pnpm -r run typecheck && pnpm -r run lint
pnpm --filter @endora-commerce/contracts run test
pnpm --filter @endora-commerce/mod-forms run test
pnpm --filter @endora-commerce/cms-components run test
pnpm --filter backend exec vitest run test/contract/forms test/integration/forms
pnpm --filter storefront exec vitest run test/forms test/ssr/forms-block.test.tsx
pnpm --filter '!backend' run test
pnpm run check:naming && pnpm run check:language
```
