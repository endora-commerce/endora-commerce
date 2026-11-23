# Contract: the contract surface

What an overlay module, an installed package or an integration may depend on, and how each kind may
change (D-293, OD-4; #1820 item 4). T017 writes the operational form to
`specs/conventions/contract-surface.md` (routed from `AGENTS.md`) and the third-party form to
`docs/docs/architecture/contract-surface.md` with its Polish translation under
`docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/`.

**Why "contract surface" and not "published surface".** `check:release-intent` already uses
*published surface* (`PublishedSurface`, D-162) for the set of **files** a package compiles into its
`dist`, and `backend/test/unit/kernel/published-surface.test.ts` holds the platform barrels. This
document's subject is the **types and identifiers** a consumer compiles against; a second meaning
under the same name in the same check would be read as the first.

## Tiers

| Tier | May change | How a removal happens |
| --- | --- | --- |
| **frozen** | never, except by a ruling that moves the entry to another tier | not at all; a replacement is a new entry beside it |
| **stable** | compatibly at any time; incompatibly only in a release **after** one that shipped the entry `@deprecated` | deprecate in release N, remove in N+1 or later |
| **additive-only** | only compatible additions in the kind's direction | never; a breaking successor is a new versioned name (`.v2` action / event), the old one kept |

## Directions

| Direction | A consumer… | Compatible when |
| --- | --- | --- |
| `read` | reads the value | HEAD type is assignable to base type (fields may be added) |
| `write` | supplies the value | base type is assignable to HEAD type (accepted values may widen, new fields optional) |
| `call` | calls the method | base parameters assignable to HEAD parameters, and HEAD return assignable to base return |
| `identity` | names the literal | the literal is unchanged |

## Kinds

| Kind | Entries derived from | Tier | Direction | Owner of the derivation |
| --- | --- | --- | --- | --- |
| Port container name | `Container name:` markers in `packages/contracts/src` and module `./ports` subpaths (the `check:port-shape` population) | frozen | identity | 186 |
| Port method | each method of an interface carrying the marker | stable | call | 186 |
| Port record / input type | types a port method's signature reaches, transitively within `@endora-commerce/contracts` | (covered by the method's `call` check) | — | 186 |
| Hookable action id | `HookableActionRef` constants exported from contracts (`action`, `objectType`, `phases`) | frozen (action, objectType); additive-only (phases, write) | identity / write | 186 |
| Hook data | `HookableActionRef<HookData, …>` first type argument | additive-only | read | 186 |
| Outbox data | `HookableActionRef<…, OutboxData>` second type argument | additive-only | read | 186 |
| Manifest extension fields | `hookableActions`, `schemaExtensions`, and each field a sibling spec adds, in the manifest declaration schema of `@endora-commerce/contracts` / `@endora-commerce/platform` | stable | write | 186 (existing fields); siblings add theirs |
| Extensible host table | `CUSTOM_FIELD_HOST_BINDINGS`: `table`, `valueColumn`, `ownerModuleId`, `aggregatePort` | frozen | identity | 186 |
| Extensible host primary key | the host entity's primary-key property names | frozen | identity | `specs/187-side-table-extensions/` (it checks PK = FK) |
| Side-table `extends` declaration | manifest `extends` | stable | write | `specs/187-side-table-extensions/` |
| Policy-point id | manifest policy-point declarations | frozen | identity | `specs/188-policy-points/` |
| Policy input | policy-point input schema (`z.infer`) | additive-only | read | `specs/188-policy-points/` |
| Policy verdict | policy-point verdict schema (`z.infer`) | additive-only | write | `specs/188-policy-points/` |
| Middleware `meta` | `commandMiddleware` admit `meta` type | additive-only | read | `specs/189-command-middleware/` |
| Middleware `outcome` | `commandMiddleware` observe `outcome` type | additive-only | read | `specs/189-command-middleware/` |

A sibling spec adds its rows to the comparison's kind registry
(`backend/scripts/lib/contract-surface.ts`, `contracts/release-intent-contract-surface.md`) in the merge
request that ships the kind; until then the row is documented and not yet compared.

**Not in the list, deliberately**: domain event payloads (`*.v1`) — already governed by their own
rule, "adding a field is reviewed, removing one is a new `.vN`"; HTTP API shapes — versioned by
Principle II and the OpenAPI document; `@endora-commerce/platform`'s barrels — held by
`check:platform-surface`; admin-kit components — not reachable by a server-side overlay.

## Deprecation

```text
@deprecated since 0.113.0; use {@link OrganizationCommandPort.create} instead.
@deprecated since 0.113.0; no replacement: <reason>.
```

On a stable entry only. On an additive-only or frozen entry the marker informs readers but licenses
nothing. The instance overlay build (`specs/190-overlay-full-modules/`, #1848) reports every use of a
deprecated entry as a warning, which is what makes a deprecation visible one release ahead.

## Sanctioned breaks (D-293.7)

The one exception to the deprecation release. A break of a **stable**, **frozen** or **additive-only**
entry that cannot wait a release — a security fix, a forced dependency change — ships without a
deprecation release when, in the same merge request:

1. the owner has ruled it, with a `D-nnn` number;
2. the upgrade note for the release that carries it (`docs/docs/upgrading-an-instance.md` and its
   Polish translation) has a section with an explicit `{#anchor}` naming the entry's symbol, the
   D-number and what an instance must do;
3. `backend/scripts/ledgers/contract-surface-breaks.ts` holds an entry for it — entry id, the base
   release it breaks against, the one finding kind it licenses, the D-number, the anchor and why.

The check holds all three together (`contracts/release-intent-contract-surface.md` §5): an entry with
no announced upgrade note fails, an entry matching no break fails, and an entry left over from a
shipped release is removed by the next release pull request. There is no other escape — no flag, no
variable, no label.
