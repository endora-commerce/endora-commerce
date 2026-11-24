# Contract: extending `check:release-intent` with the contract-surface comparison

D-293.3 (OD-4), D-293.7; #1820 items 2–4. **The check exists and is extended, not built.** #1820 was
written against `957dcb5fa` and says `check:release-intent` "does not exist on `master` — no script,
no `package.json` entry". It does: `backend/package.json` → `"check:release-intent": "tsx
scripts/check-release-intent.ts"`, the script `backend/scripts/check-release-intent.ts`, run by
`.github/workflows/quality.yml` (default mode, `quality` job), by the `release-changeset` job of the
same workflow (`--since`), and by `.github/workflows/publish.yml`. This contract states what is added
to it and where; everything the script already does is untouched.

## 0. What is there, and what that decides

| Existing fact (read on `origin/master` `babfae111`) | Consequence for this feature |
| --- | --- |
| Four modes: default (no git; `.changeset/config.json` and the workspace), `--since <ref>` (the branch diff: D-162 `unattributed-published-change`, the D-212 release-shape classification, and `changeset status` spawned for ordinary branches), `--print-publish-scope`, `--publish-registry <url>` | The comparison needs git history and tags, so it belongs with the one mode that already reads git — `--since` — never the default mode. The script header states that rule for D-162: *"This mode needs a git diff, so it runs in `release:changeset` … rather than in `quality`."* |
| `release-changeset` checks out with `fetch-depth: 0` (all history **and all tags**); `quality` checks out shallow | No workflow change is needed to reach the tag. The task is a comment at the `fetch-depth: 0` line naming the comparison as a second reason it must stay. |
| Findings are the union `ReleaseIntentFindingKind`; exit 0 = the flow can still go red, 1 = a finding, 2 = it did not read | New findings join the union; the comparison's refusals are exit 2 inside the analysis, as D-162's and D-212's are. |
| `PublishedSurface` / `readPublishedSurface` already name D-162's concept (the **files** a package compiles into its `dist`), and `backend/test/unit/kernel/published-surface.test.ts` is the platform-barrel test that `specs/187-side-table-extensions/` and `specs/189-command-middleware/` edit | This feature's concept is the **contract surface**, never "published surface": type `ContractSurfaceEntry`, finding kinds `contract-*`, files `contract-surface.*`. Two meanings under one name in one script is the confusion this avoids. |
| The estate entry (`packages/cli/src/check/estate.ts`, `id: 'check:release-intent'`) is already `scope: 'repository-only'` | No new estate entry. Its `reason` gains one sentence: the comparison is against this repository's own `v*` tags, which an instance does not have. |
| The read-size record (`backend/test/helpers/check-read-sizes.ts`) runs the **default** mode only (`args: []`) | No read-size re-record: the comparison does not run in the default mode. Its "nothing was read" refusals live inside the analysis (§6), as `--since`'s do. |
| `--since` returns early with `contained=yes` when `HEAD` is an ancestor of the baseline | The comparison is skipped for a contained branch too: it adds nothing to a base that already holds it. |
| The check already carries one two-way, annotation-shaped escape (commercial-disclosure clearances: `commercial-disclosure-in-changeset` / `stale-disclosure-clearance`), and states for D-225 *"no override and no ledger"* because a ledger there could only license what the ruling forbids | D-293.7 is a ruled exception — the owner licensed it — so it gets a two-way ledger (§5), modelled on that precedent and on `backend/scripts/ledgers/`. |

## 1. Invocation

```bash
# CI, unchanged command line — the comparison now runs inside it:
pnpm --filter backend run check:release-intent -- --since "origin/$base"

# Override the base release (release branches, T104/T106, local investigation):
pnpm --filter backend exec tsx scripts/check-release-intent.ts --since origin/master --contract-base v0.112.0

# The comparison alone, with no branch diff (local; never used by CI):
pnpm --filter backend exec tsx scripts/check-release-intent.ts --contract-base v0.112.0
```

- **Base**: `--contract-base <ref>` if given, else the highest `v*` release tag reachable from `HEAD`
  (`git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD`). The base version is the tag without `v`.
  `--contract-base` with no value, or with a value starting with `--`, is exit 2 in the existing
  flags' wording.
- **Shapes**: runs for all three D-212 shapes (`release`, `vacuous`, `ordinary`) — the release pull
  request is where SC-003 is observed — and not for a contained branch.
- **Default mode, `--print-publish-scope`, `--publish-registry`**: unchanged; they never run the
  comparison. `publish.yml` needs no change, because the release pull request already ran it.

## 2. The port contract surface (#1820 item 3, "`@api` ports")

#1820 says "`@api` port". The tree has **no `@api` tag**, and none is added: the marker that already
makes an interface a published port is `Container name:` (`PORT_DOC_MARKER`,
`packages/cli/src/rules/port-shape.ts`), and `check:port-shape` derives the population from it —
every exported `interface` carrying the marker in `packages/contracts/src`, or on a module package's
declared `./ports` subpath (D-171.1; the `exports` map decides membership, not the path). That
population **is** the `@api` port surface. A second tag would be a second declaration of one fact, and
the two would drift.

- `backend/scripts/check-port-shape.ts`'s private `modulePortsPopulation()` moves to
  `backend/scripts/lib/port-population.ts` and is exported; `check-port-shape.ts` imports it back. The
  comparison runs the **same** function over the HEAD checkout and over the materialised base tree, so
  one derivation decides what a port is on both sides.
- Entries: `port:<containerName>` — **frozen**, `identity` (the container name and the interface it
  binds); `port:<containerName>#<method>` — **stable**, `call`. A port's record and input types are
  covered by the method's `call` assertion (they are reached through `Parameters<>` / `ReturnType<>`).
- The other kinds 186 owns (hookable action id, hook data, outbox data, manifest extension fields,
  extensible host table) are rows of `contract-surface.md`, derived in the same file from the marker
  that already publishes each. Sibling specs add their rows when they ship the kind.

## 3. Mechanism

1. **Materialise the base**: `git archive <base>` with pathspecs for `packages/contracts/src`,
   `packages/modules/*/src/ports`, `packages/modules/*/package.json` and the manifest declaration
   schema's source, extracted into a temporary directory removed on exit. A failed `git archive` is
   exit 2.
2. **Derive** each kind's entries on HEAD and on the base with the same code (§2).
3. **Pair by id.** Missing at HEAD → a removal. Present on both sides → one assertion per entry and
   direction in a generated probe file:

   ```ts
   import type * as B from './base/contracts/index.js';
   import type * as H from './head/contracts/index.js';
   type Ok<A, Z> = [A] extends [Z] ? true : false;
   // port:organizationCommandPort#setParent (call)
   const _e17: true = null! as Ok<Parameters<B.OrganizationCommandPort['setParent']>, Parameters<H.OrganizationCommandPort['setParent']>>;
   const _e17r: true = null! as Ok<ReturnType<H.OrganizationCommandPort['setParent']>, ReturnType<B.OrganizationCommandPort['setParent']>>;
   ```

4. **Type-check** the probe with the TypeScript compiler API (`typescript` is already a dependency of
   `backend` and `@endora-commerce/cli`) against HEAD's `node_modules`, and map each diagnostic's
   identifier back to its entry. Both trees resolve one dependency set, so a dependency's own type
   change (MikroORM 7) is not a finding. Overloaded methods compare the last overload — a stated
   limitation in the code header and the published guide.
5. **Read deprecations** from the base JSDoc of each entry, and parse the grammar of every
   `@deprecated` on a surface entry at HEAD.

The analysis is `backend/scripts/lib/contract-surface.ts` — a pure function over two in-memory trees,
the base version, the D-212 shape, the ledger and an upgrade-note reader, so a fixture enters where a
real run enters. The git materialisation is a thin adapter beside it. It is **not** a
`packages/cli/src/rules/` rule: the check is `repository-only`, so there is no second host, and "one
analysis, two hosts" would put code nothing outside this repository runs into a published package. If
`specs/190-overlay-full-modules/` later needs the deprecation-grammar parser inside an instance, the
parser (only) moves to `@endora-commerce/cli` then.

## 4. The deprecation-release rule (D-293.3)

A **stable** entry may be removed, or fail its direction, at HEAD **only if the base release carried a
parseable `@deprecated` on it**. The base is a release tag, so "carried at the base" is exactly
"shipped deprecated in a release" — no second record of which release deprecated what is kept.

```text
@deprecated since <major>.<minor>.<patch>; use {@link <Symbol>[.<member>]} instead.
@deprecated since <major>.<minor>.<patch>; no replacement: <reason>.
```

- A marker **new at HEAD** (absent at the base) must name a version **greater than** the base
  version — it ships in the next release. A smaller or equal one claims a release that did not carry
  it (`deprecation-backdated`).
- A marker **removed at HEAD** (un-deprecation) is compatible and silent.
- On a **frozen** or **additive-only** entry a marker informs readers and licenses nothing.
- Removal in the same release as the deprecation is therefore refused by construction: the base does
  not carry the marker yet (US2 scenario 1, US12).

## 5. Sanctioned breaks — the D-293.7 exception

A deliberate break (a security fix, a forced dependency change) may skip the deprecation release when
it is ledgered with a ruling and an upgrade note. The ledger is
`backend/scripts/ledgers/contract-surface-breaks.ts`, beside the estate's other ledgers:

```ts
export interface SanctionedContractBreak {
  /** The release the break is measured against — the run's base tag, e.g. `v0.113.0`. */
  readonly base: string;
  /** The one finding kind this entry licenses for its entry id. */
  readonly finding:
    | 'contract-removed-without-deprecation'
    | 'contract-changed-without-deprecation'
    | 'frozen-contract-changed'
    | 'additive-contract-narrowed';
  /** The owner's ruling, `D-nnn`. */
  readonly ruling: string;
  /** The `{#anchor}` id of the upgrade-note section, present in EN and PL. */
  readonly upgradeNote: string;
  /** Why this cannot wait a release — a sentence somebody can disagree with. */
  readonly why: string;
}

/** Keyed by contract-surface entry id, e.g. `port:organizationWritePort#create`. Opens empty. */
export const SANCTIONED_CONTRACT_BREAKS: Readonly<Record<string, SanctionedContractBreak>> = {};
```

- **Live** — `base` equals the run's base. A finding whose entry id **and** kind match is reported as
  `ruled` (printed by id with its D-number) and does not fail.
- **Announced** — a live entry's `upgradeNote` must resolve to a `{#<upgradeNote>}` heading in
  `docs/docs/upgrading-an-instance.md` **and** in
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/upgrading-an-instance.md`, and the section under
  each heading (to the next heading of the same or a higher level) must contain the entry's symbol
  (`OrganizationWritePort.create` for `port:organizationWritePort#create`) and the D-number. Otherwise
  `contract-break-unannounced`. The upgrader is the person the skipped deprecation release would have
  warned; the note is what replaces that warning.
- **Stale** — a live entry matching no finding (the break was reverted, or the id or kind is wrong):
  `stale-contract-break`. Two-way, as every ledger in this estate.
- **Spent** — `base` is an **older** release than the run's base: the break shipped, and both sides of
  the comparison now agree. Printed as `spent=<n>` with the ids. It fails only on a branch the D-212
  classification calls `release` (`spent-contract-break`), so the **next release pull request**
  deletes it — not the unrelated pull request that happens to be first after the tag is pushed (the
  `AGENTS.md` trap: the merge that frees an entry is not the one that can see it go stale).
- **Malformed** — `ruling` not `^D-\d{3,}$`, `base` not a `v<major>.<minor>.<patch>` tag, `base`
  newer than the run's base, an empty `why`, or an empty `upgradeNote`: `contract-break-malformed`.
- The D-number's existence is not checked: rulings below the pre-migration floor live in withheld
  records, so the tree cannot answer it. The upgrade note citing it is what a reviewer reads.
- No environment variable, flag or label skips the comparison; the ledger entry in the diff is the
  only escape.

## 6. Findings and refusals

Added to `ReleaseIntentFindingKind`:

| Kind | When | Message names |
| --- | --- | --- |
| `contract-removed-without-deprecation` | a stable entry at the base is absent at HEAD; the base carried no `@deprecated` on it | entry id, base tag, file at the base |
| `contract-changed-without-deprecation` | a stable entry fails its direction; the base carried no `@deprecated` | entry id, base tag, the compiler's diagnostic text |
| `frozen-contract-changed` | a frozen entry differs or is absent | entry id, base value, HEAD value |
| `additive-contract-narrowed` | an additive-only entry fails its direction or is absent, deprecated or not | entry id, diagnostic |
| `deprecation-unparseable` | a `@deprecated` on a surface entry at HEAD does not match the grammar | entry id, file:line, the tag text |
| `deprecation-backdated` | a marker new at HEAD names a version ≤ the base version | entry id, the version, the base tag |
| `contract-break-malformed` | a ledger entry fails §5's shape rules | entry id, the field |
| `contract-break-unannounced` | a live entry's upgrade-note section is missing in EN or PL, or does not name the symbol and the D-number | entry id, anchor, language |
| `stale-contract-break` | a live entry matches no finding | entry id |
| `spent-contract-break` | a spent entry, on a `release`-shaped branch | entry id, its base, the run's base |

**Exit 2** ("nothing was read"), inside the analysis: no `v*` tag reachable from `HEAD` (a shallow
clone included) and no `--contract-base`; the base ref does not resolve; `git archive` fails; the base
or the HEAD population of any 186-owned kind is empty; the probe program cannot be created, or compiled
no assertion; `--contract-base` without a value.

**Always printed** (stdout, zeros included):
`[release-intent] contract-base=<tag> entries=<head>/<base> deprecated-at-base=<n> removed=<n> changed=<n> ruled=<n> spent=<n> violations=<n>`.

## 7. Estate, inventory, docs, tests

- `packages/cli/src/check/estate.ts`: the `check:release-intent` entry's `reason` gains the sentence
  in §0; no new entry.
- `specs/conventions/check-inventory.md`: the existing `check:release-intent` row gains the family,
  the ledger and the exit-2 list — the row is extended, not duplicated.
- `specs/conventions/release-intent.md`: one paragraph — OD-4, the grammar, the comparison, the
  sanctioned-break ledger — pointing at `specs/conventions/contract-surface.md` for the kinds.
- `.github/workflows/quality.yml`: a comment at `release-changeset`'s `fetch-depth: 0` naming the
  comparison's need for tags; no other change.
- Red proofs: `backend/test/unit/scripts/check-release-intent.contract-surface.test.ts`, beside the
  existing `check-release-intent.test.ts` — one red/green fixture pair per finding kind and one red
  proof per exit-2 case; one real-branch case in `backend/test/release/changeset-gate.test.ts`
  (`test:release-gate`): a branch removing an undeprecated port method reds `--since`.
