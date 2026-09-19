---
---

Three rulings recorded, and three published packages re-worded in comments only

Empty deliberately, under `specs/conventions/release-intent.md`: *"Where a change genuinely has no
release meaning — a comment, a test, a rename crossing no export — write the empty changeset rather
than looking for a way past the gate."*

The honest question that document asks is *does this commit change what a published package emits?*
Three published packages are touched — `@endora-commerce/admin-shell` (`src/App.tsx`,
`src/components/AppShell.tsx`), `@endora-commerce/cli` (`src/check/peer-owners.ts`,
`src/rules/port-catches.ts`) and `@endora-commerce/mod-delivery-methods`
(`src/ports/index.ts`) — and every changed region in all five files is inside a comment block. No
exported symbol is added, removed, renamed or re-typed; no signature moves; `ports/index.ts` still
compiles to `export {};`, which is the property D-171 makes its boundary decision on.

What the comments now say instead is the **engineering** justification for a rule they used to
justify commercially: a host-owned crumb table may not declare a trail whose destination only a
module declares (`specs/conventions/module-admin-surfaces.md`); a module that seeds another module's
table does it from its own `installHook` through the owner's published install surface, because a
cross-repository schema dependency has no version range (R11 / D-251 / FR-064); and a set of
integration-heavy modules is described by what makes it integration-heavy rather than by a
commercial tier — which also corrects a sentence that mis-classified a module the other way.

A consumer reading a `.d.ts` will see different prose and the same declarations. Nothing to release.
