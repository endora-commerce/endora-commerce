---
title: Upgrading past the Page Builder block rename
---

# Upgrading past the Page Builder block rename

One release renames every Page Builder block stored in your database. A block that was
saved as `Row` becomes `cms.Row`; `EmailOrderSummary` becomes `orders.EmailOrderSummary`.
The name a block is stored under now says which module owns it, which is what lets a
module be switched off, installed from a registry, or replaced without two modules
silently claiming the same name.

**Nothing about your content changes.** The rewrite replaces a block's type and touches no
prop, no ordering and no language. It runs as five ordinary migrations, one per module
that owns the tables being rewritten.

This page is the pre-flight. Follow it in order.

---

## 1. Run the report

```bash
pnpm --filter backend run cli -- cms block-names
```

It is **read-only**. Run it on the production database before you have decided to upgrade;
it issues no `update`, no `insert` and no `delete`.

It prints one line per stored block name, per column, with how many nodes and how many rows
carry it, and what will happen to it:

```
cms_pages.content
  Column                                  1 nodes     1 rows  will-be-renamed -> cms.Column
  NotAKnownBlock                          1 nodes     1 rows  unrecognised
  ProductGrid                             1 nodes     1 rows  will-be-renamed -> catalog.ProductGrid
  Row                                     1 nodes     1 rows  will-be-renamed -> cms.Row
  -- 4 distinct: 3 will be renamed, 0 already namespaced, 1 unrecognised
```

Three classifications, and only one of them needs a decision from you:

| Classification | What it means | What to do |
| --- | --- | --- |
| `will-be-renamed -> <new name>` | The platform knows this block. The migration renames it. | Nothing. |
| `already-namespaced` | Already carries an owner. On a database that has not been upgraded this is a block authored by a module you installed. | Nothing. |
| `unrecognised` | Nothing on this platform claims this name. | Read §2. |

## 2. Decide what happens to the unrecognised names

**The migration will not fail on one, and it will not quarantine one.** It leaves the value
byte-identical and reports it. Failing would let one hand-edited row stop your whole
upgrade with no remedy but editing JSONB by hand; quarantining would destroy the only
evidence of what the name was.

What happens afterwards is the same thing that happens to a block whose owning module is
switched off:

- **the storefront renders nothing** where the block was, and throws nothing;
- **the admin editor shows a placeholder** naming the block, and **keeps its props** — save
  and reload and the content is still there.

So an unrecognised name is a block that stops rendering, reversibly. If one matters to you,
find out where it came from before you upgrade — a module you have since uninstalled, a
hand-edited row, a fork's own block — and either restore what renders it or accept that it
degrades.

## 3. Take a backup

**This is the restore path.** `down()` exists on all five migrations and is exact for the
names the platform renamed, but it is not a safety net: it cannot restore a name that never
had a pre-migration form, and it does not undo anything else the release did.

## 4. Upgrade

The five migrations run with everything else. They are ordinary migrations: no flag, no
separate step, no downtime beyond the migration itself. They are independent of each other
and of every other migration in the release.

## 5. Run the report again, and diff it

```bash
pnpm --filter backend run cli -- cms block-names
```

Two things must be true, and they are the whole verification:

- every line that said **`will-be-renamed -> X`** now reads **`X … already-namespaced`**;
- the **`unrecognised`** set is unchanged, in size and in membership.

If a name is still `will-be-renamed` after the upgrade, something in the running platform
wrote it again after the migration ran — a seeder or a boot reconciler. Report it; the
rename is idempotent, so re-running the migration is safe, but the source needs fixing.

---

## Frequently asked

**Can I run the migration twice?** Yes, and nothing happens the second time. Every name the
map renames *from* is bare and every name it renames *to* carries a dot, so a second pass
finds nothing to do. That is a property of the map rather than a check the migration
performs.

**Will a block whose text mentions "Row" be damaged?** No. The rewrite descends the stored
JSON and replaces a block's `type`. A rich-text body, an `alt` attribute and a raw-HTML
prop are copied through unchanged, whatever they contain.

**What about content in a language I do not use?** Every language in the stored envelope is
rewritten, and the envelope's own keys — the language codes, the schema version — are
untouched.

**I have a template that a module I removed used to render.** It is `unrecognised`. See §2.
