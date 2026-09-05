---
'@endora-commerce/cli': minor
---

`platform-surface` gains a second consumer population: the application's own
relative reaches into the host package.

The rule was already *a reach into the host names a published subpath or a
declared host-internal one, never a file inside the package by relative path*.
It was asked of **modules** only, and the consumer that writes the most such
reaches — the application — was outside the population by construction:
`moduleIdOf` answers `null` for every one of its files, so a `violations=0` was
honest about a population that did not contain them. On this repository's tree
that hid 84 reaches, every one of which resolves in the checkout and in no
instance built from published packages.

New exports on `@endora-commerce/cli/rules/platform-surface.js`, all additive:

- `scanApplicationReaches(input)` and `checkApplicationReaches(input, ledger)` —
  the pure analysis, over source text, file keys, barrel-derived surface and the
  two platform roots, so a fixture enters where a run does;
- `canonicalPlatformFile(joined, input)` — the canonicalisation. It drops the
  member-relative path's **first segment**, whatever it is, and re-roots the
  remainder at the platform's source root, so `dist/x.js` and `src/x.ts` are one
  key and the word `dist` appears nowhere in the analysis;
- `applicationReachRefusal({ canonicalTargets, applicationFiles })` — the two
  exit-2 refusals this half owns, both of which fail in the direction that
  produces a clean result;
- `hostReachCoverage(ledger, onDisk, opened)` — the `sources=host-reaches:<n>/<n>`
  floor, derived from the ledger rather than from a count, and `null` rather than
  `expected: 0` once that ledger empties;
- `LedgeredHostReach` — `{ reason, retiredBy }`, with no `permanent` member: this
  ledger is expected to empty, and an entry saying "this reach is correct" would
  mean the predicate has outgrown its population.

**Two changes to existing shapes, and both can break a consumer that writes the
type rather than reading it.** `PlatformSurfaceFindingKind` gains
`'relative-host-reach'`, so an exhaustive `switch` over it no longer covers every
member; and `PlatformSurface` gains a required `publishedBy` field —
`<target file>` to the barrels that publish it, the provenance the merge in
`publishedSurface` was dropping. It is what turns a target into an address, so a
remedy can name `@endora-commerce/platform/kernel` instead of saying only that
the reach is wrong. A consumer that builds a `PlatformSurface` literal by hand
adds the field; one that calls `publishedSurface` gets it for nothing.

`PlatformSurfaceFinding` also gains an optional `publishedAs`, carried by the new
finding and by nothing else.

The estate entry for `check:platform-surface` gains a second `partial`,
`application-host-reach`: an installed module package has no application tree, so
this half has no subject there and is declared vacuous rather than counted zero.

Normative: `specs/115-lifecycle-container-move/contracts/host-reach-check.md`.
