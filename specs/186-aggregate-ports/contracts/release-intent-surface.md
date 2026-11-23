# Contract: the surface comparison in `check:release-intent`

## Invocation

```bash
pnpm --filter backend run check:release-intent                         # default: includes the comparison
pnpm --filter backend exec tsx scripts/check-release-intent.ts --surface-base v0.113.0
```

- **Base**: `--surface-base <ref>` if given, else the highest `v*` tag reachable from `HEAD`
  (`git describe --tags --abbrev=0 --match 'v*'`).
- **Exit 2** ("nothing was read"): the base ref does not resolve; the base tree has no
  `packages/contracts/src`; the base population of any 186-owned kind is empty; the probe compiled no
  entry.
- **Exit 1**: any finding below.
- The existing changeset-config findings are unchanged and run in the same invocation.

## Findings (added to `ReleaseIntentFindingKind`)

| Kind | When | Message names |
| --- | --- | --- |
| `surface-removed-without-deprecation` | a stable entry in base is absent at HEAD and base carried no `@deprecated` on it | entry id, base ref, file at base |
| `surface-changed-without-deprecation` | a stable entry's HEAD form fails its direction against base, and base carried no `@deprecated` | entry id, base ref, the compiler's diagnostic text |
| `frozen-surface-changed` | a frozen entry differs or is absent | entry id, base value, HEAD value |
| `additive-surface-narrowed` | an additive-only entry fails its direction or is absent, deprecated or not | entry id, diagnostic |
| `deprecation-unparseable` | a `@deprecated` tag on a surface entry at HEAD does not match the grammar | entry id, file:line, the tag text |

If Q-2 is answered yes: a finding whose entry id is in `backend/scripts/ledgers/surface-breaks.ts`
with a `D-nnn` ruling is reported as `ruled` and does not fail; a ledger entry matching no finding is
`stale-surface-break` and fails.

## Mechanism

1. Derive each kind's HEAD population from the working tree; materialise the base tree's
   `packages/contracts/src` and module `src/ports/` directories with `git archive <base>` into a
   temporary directory, and derive the base population there with the same code.
2. Pair entries by id. Missing at HEAD → removal findings. Present in both → emit one assertion per
   entry into a probe file:

   ```ts
   import type * as B from './base/contracts/index.js';
   import type * as H from './head/contracts/index.js';
   type Ok<A, Z> = [A] extends [Z] ? true : false;
   // port method (call): organizationCommandPort#setParent
   const _e17: true = null! as Ok<Parameters<B.OrganizationCommandPort['setParent']>, Parameters<H.OrganizationCommandPort['setParent']>>;
   const _e17r: true = null! as Ok<ReturnType<H.OrganizationCommandPort['setParent']>, ReturnType<B.OrganizationCommandPort['setParent']>>;
   ```

3. Type-check the probe with the TypeScript compiler API against HEAD's `node_modules`; map each
   diagnostic's identifier (`_e17`) back to its entry. Overloaded methods compare the last overload
   (a stated limitation in the rule header).
4. Parse base JSDoc for `@deprecated` on each entry; HEAD JSDoc for grammar.

## Read size

`[release-intent] read: files=<n> sites=<entries at HEAD> sources=git-tag:<base>:<entries at base>`,
recorded in `backend/test/helpers/check-read-sizes.ts` within the existing band rules
(`check-estate.md`).

## Estate and inventory

- `packages/cli/src/check/estate.ts`: the comparison is `repository-only` — reason: "compares against
  this repository's release tags; an instance has none".
- `specs/conventions/check-inventory.md`: the `check:release-intent` row names the new family.
- Red proofs: one fixture pair per finding kind in `backend/test/unit/release/published-surface.test.ts`,
  each with its green twin.

## CI

`git describe` needs the history between `HEAD` and the tag, which a shallow clone does not hold. The
step that runs `check:release-intent` in `.github/workflows/quality.yml` therefore runs in a job that
checks out with `fetch-depth: 0` — the changeset job already does, for the same reason
(`changeset status` diffs against the merge base) — or its own job gains it; the job's comment says
why. `publish.yml` already checks out with `fetch-depth: 0`. A shallow clone is exit 2, never green.
