# The contract surface — what an overlay may depend on, and how it may change

**Open this before changing, deprecating or removing anything a module, an overlay or an
integration compiles against** — a published port or one of its methods, a hookable action, its
hook or outbox data, a manifest extension field, an extensible host table — and before adding a new
kind of thing to that list. One of the bodies `AGENTS.md` routes to; it is the single home for these
rules, so never restate them in `AGENTS.md` or in a tool-specific pointer file. The design record,
with the alternatives rejected, is `specs/186-aggregate-ports/` (`contracts/contract-surface.md`,
`contracts/release-intent-contract-surface.md`, research R-11 to R-13); the published guide for a
third party is `docs/docs/architecture/contract-surface.md`.

**The rule (ruling D-293.3, OD-4 of 2026-11-23).** In the `0.x` series a release may still break a
consumer, so the rule is not semantic versioning: **a stable entry is removed or changed
incompatibly only in a release after one that shipped it `@deprecated`**. A frozen entry does not
change at all, and an additive-only entry only grows. The one exception is a ruled break (below).
Which port a write belongs on is a different rule — `module-composition.md` item 2a.

**Why "contract surface" and not "published surface".** `check:release-intent` already uses
*published surface* (`PublishedSurface`, D-162) for the set of **files** a package compiles into its
`dist`, and `backend/test/unit/kernel/published-surface.test.ts` holds the platform barrels. This
document's subject is the **types and identifiers** a consumer compiles against. Do not call it by
the other name: one word with two meanings inside one check is read as the first meaning.

## Tiers

| Tier | May change | How a removal happens |
| --- | --- | --- |
| **frozen** | never, except by a ruling that moves the entry to another tier | not at all; a replacement is a new entry beside it |
| **stable** | compatibly at any time; incompatibly only in a release **after** one that shipped the entry `@deprecated` | deprecate in release N, remove in N+1 or later |
| **additive-only** | only compatible additions in the kind's direction | never; a breaking successor is a new versioned name (a `.v2` action or event), and the old one is kept |

## Directions

| Direction | A consumer… | Compatible when |
| --- | --- | --- |
| `read` | reads the value | the new type is assignable to the old one (fields may be added) |
| `write` | supplies the value | the old type is assignable to the new one (accepted values may widen; new fields are optional) |
| `call` | calls the method | the old parameters are assignable to the new ones, and the new return type to the old one |
| `identity` | names the literal | the literal is unchanged |

So a port method may gain an **optional** parameter or narrow what it returns, and may not gain a
required parameter or widen its return.

## Kinds

Entries are **derived from the marker that already publishes each kind, never listed**: a list
written here would be a second declaration of the same fact, and the two would drift (D-100).

| Kind | Entries derived from | Tier | Direction |
| --- | --- | --- | --- |
| Port container name | the `Container name:` marker in `packages/contracts/src` and on a module's `./ports` subpath — the population `check:port-shape` derives | frozen | identity |
| Port method | each method of an interface carrying that marker | stable | call |
| Port record and input types | the types a port method's signature reaches | covered by the method's `call` comparison | — |
| Hookable action id | the `HookableActionRef` constants exported from contracts (`action`, `objectType`; `phases`) | frozen (`action`, `objectType`); additive-only (`phases`) | identity / write |
| Hook data | the first type argument of `HookableActionRef` | additive-only | read |
| Outbox data | the second type argument of `HookableActionRef` | additive-only | read |
| Manifest extension fields | `hookableActions`, `schemaExtensions`, and each field a later feature adds to the manifest declaration schema | stable | write |
| Extensible host table | `CUSTOM_FIELD_HOST_BINDINGS`: `table`, `valueColumn`, `ownerModuleId` | frozen | identity |
| Extensible host primary key | the host entity's primary-key property names | frozen | identity |
| Side-table `extends` declaration | the manifest `extends` field | stable | write |
| Policy-point id | manifest policy-point declarations | frozen | identity |
| Policy input / verdict | the policy point's input schema (read) and verdict schema (write) | additive-only | read / write |
| Command-middleware `meta` / `outcome` | the `commandMiddleware` admit `meta` and observe `outcome` types | additive-only | read |

**There is no `@api` tag, and do not add one.** Issue #1820 named the port population "`@api`
ports"; the marker that already makes an interface a published port is `Container name:`, and a
second tag would be a second declaration of one fact.

The last five rows belong to features still in design (`specs/187-side-table-extensions/`,
`specs/188-policy-points/`, `specs/189-command-middleware/`). A feature that ships a kind adds its
derivation to the comparison in the same merge request; until then its row is the rule and not yet
an instrument.

**Not on the list, deliberately**: domain event payloads (`*.v1`), which have their own rule —
adding a field is reviewed, removing one is a new `.vN`; HTTP API shapes, versioned under Principle
II and the OpenAPI document; `@endora-commerce/platform`'s barrels, held by `check:platform-surface`;
admin-kit components, which no server-side overlay reaches.

## Deprecation

A deprecated stable entry carries a `@deprecated` tag in exactly one of two forms:

```text
@deprecated since 0.113.0; use {@link OrganizationCommandPort.create} instead.
@deprecated since 0.113.0; no replacement: <reason>.
```

- **The version is the release the marker ships in**, which is the next release — never the one
  already tagged. A marker naming a release that did not carry it claims a deprecation period that
  never happened.
- **Removal in the same release as the deprecation is refused by construction**: the release the
  change is measured against did not carry the marker yet.
- **Removing a marker** (un-deprecating) is compatible.
- **On a frozen or additive-only entry** a marker informs the reader and licenses nothing.
- A deprecation is consumer-facing: its changeset names the old call and the new one
  (`release-intent.md`), and the instance overlay build (`specs/190-overlay-full-modules/`) shows
  every use of a deprecated entry as a warning, which is what makes it visible a release ahead.

Older `@deprecated` tags in `packages/contracts/src` written as *"Since issue #nnn"* predate this
grammar and are not on a surface entry; leave them until their own removal.

## Sanctioned breaks (ruling D-293.7)

The one exception to the deprecation release. A break that cannot wait a release — a security fix,
a forced dependency change — ships without one when, **in the same merge request**:

1. the owner has ruled it, with a `D-nnn` number;
2. the upgrade note for the release that carries it (`docs/docs/upgrading-an-instance.md` and its
   Polish translation) has a section with an explicit `{#anchor}` naming the entry's symbol, the
   D-number and what an instance must do — the note replaces the warning the skipped release would
   have given;
3. the sanctioned-break ledger, `backend/scripts/ledgers/contract-surface-breaks.ts`, has an entry
   keyed by the entry id: the base release it breaks against, the one finding kind it licenses, the
   D-number, the anchor and why it cannot wait.

The ledger is two-way like every ledger in the estate: an entry with no announced upgrade note
fails, an entry matching no break fails, and an entry whose base release has shipped is deleted by
the **next release pull request** — not by whichever unrelated pull request happens to be first
after the tag. **There is no other escape** — no flag, no environment variable, no label.

## What enforces it, and what does not yet

- **Today**: `check:port-shape` holds the `Container name:` marker and refuses optional methods;
  the rest of this document is held by review.
- **Specified, not yet built**: the comparison inside `check:release-intent --since` — the surface at
  `HEAD` against the previous `v*` release tag, run in the `release-changeset` job, with the
  deprecation-release rule, the grammar and the sanctioned-break ledger above, and an exit 2 when the
  base cannot be resolved or a population is empty. Its contract is
  `specs/186-aggregate-ports/contracts/release-intent-contract-surface.md` (tasks T034–T043). When it
  lands it gets its row in `check-inventory.md`, and this section shrinks to a pointer to that row.
  Until then, a deprecation written in the grammar above is still the rule — the check will read the
  markers the release before it shipped.
