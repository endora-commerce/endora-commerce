---
'@endora-commerce/test-kit': minor
---

`./support` publishes the entity index's type and its lookup, and names no module

A server-bound test writes rows, and to write one it needs the entity class **the ORM
registered** — not a structurally identical copy read out of a package's source, which is a class
the ORM never discovered (D-160.6.1). A module package publishes one `entities` array and no
entity class by name (D-168), so the class is picked out of that array by name.

*Which* modules are there is the one fact a package that may name none is forbidden to know
(feature 109 R2.2, FR-001), which is why `backend/test/helpers/package-entities.ts` is
permanently host-owned (`module-package-layout.md` R10's closing paragraph). So the kit carries
the **shape** — `InstalledEntityIndex`, keyed by module id — and the **lookup** —
`entityNamedIn(index, moduleId, name)` — and the population arrives as an argument, rendered by
the host's own generator.

The lookup delegates to the platform's own `entityNamed` rather than re-implementing it: two
implementations of one lookup are two answers waiting to disagree about what a missing name
does. What it adds is the module dimension, because "no such entity" has two causes with
different remedies — the module is not installed, or the module publishes no such class — and a
host that gets `Cannot read properties of undefined` for the first has been told nothing.
