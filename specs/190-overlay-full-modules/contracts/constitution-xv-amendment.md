# Contract — Constitution XV, MINOR amendment (FR-100, #1857, OR-9)

Lands in the documentation pass (WP11), after schema discovery and the admin layer have merged.

**Who writes what (OR-9, owner answer of 2026-11-23).** `specs/189-command-middleware/` lands its
constitution sentences first, in its own merge request (`contracts/guard-seam-narrowing.md` §6 on
that branch). They are three: the clause appended to XV's *Overlays are ordinary participants*
bullet ("… never a guard seam: no module, an overlay module included, decorates the guard seams a
composition root supplies (`commandBus`, `auditLogService`, `eventBus`, `emFactory`), and
cross-cutting behaviour on Commands is contributed as declared command middleware"), the *declared command middleware* entry and its sentence in XV's *Bounded overridable
surface*, and the XIII *Thin layer* sentence. This feature rewrites XV **around** them:

- 189's XV sentences are kept **verbatim** (189 §6 requires their substance; 190 keeps the words too), in the bullets 189 put them in. 190 does not reword,
  move or shorten them. If the docs pass finds one of them wrong, it raises that against 189 and
  does not fix it here.
- **XIII is not edited by this feature.**
- Any other sentence a sibling (187, 188) has added to XV by the time WP11 merges is kept the same
  way.

**Precondition.** WP11 starts only when `.specify/memory/constitution.md` on `master` carries 189's
sentences. If 189's amendment has not merged, WP11 waits. 190 does not apply 189's text on 189's
behalf.

Version: the next MINOR **over whatever `master` carries when it merges** (4.3.0 at the time of
writing; 189's amendment will have moved it by then). No version is reserved in advance (the
`specs/178-extensible-columns/` R-A3 precedent). The Sync Impact Report states the version found and
chains from it.

## Why MINOR

The guidance expands materially: overlays gain schema, a build and a tier. No compliant work becomes
non-compliant. An overlay without schema stays valid, and the constitution never required overlays
to be build-less. Not PATCH, because the bounded surface's "Overlay modules ship no schema" is
reversed.

## Text changes (proposed wording; the docs pass may tighten it, not change its meaning)

The quoted "current" text below is `master` at `babfae111` plus 189's sentences.

1. **Opening paragraph.** Replace "through a **per-deployment overlay location** whose files shadow
   or extend their core equivalents, resolved deterministically at build/composition time" with
   "through **the deployment's own modules** in a per-deployment overlay location, which change core
   only through declared seams and are resolved deterministically at build/composition time". File
   shadowing is retired, and the sentence has been stale since 2026-09.
2. **"Overlays are ordinary participants, under the same guards."** Insert, **before** the bullet's
   last sentence (the one 189's clause extends, "… as core — an override swaps an
   **implementation**, never a guard seam: no module … decorates the guard seams …"): "An overlay module is a **full module**. It may own
   entities and migrations, publish a port, and ship admin surfaces and palette actions, under the
   same guards as a module package. Its migrations pass the platform's foreign-schema guard with no
   deployment exemption, and every entity it registers is classified (Principle XI) or the platform
   does not boot. Overlay code is compiled and type-checked by one deployment-level build. An
   overlay is never a package in disguise: it has no per-module build, manifest or exports map."
   With this placement, 189's guard-seam clause still closes the bullet, unchanged.
3. **"Bounded overridable surface (YAGNI)."** Keep the list as 189 left it ("services, routes,
   config, declared command hooks, declared command middleware, and whole new modules") and keep
   189's command-middleware sentence. Replace only "Overlay modules ship no schema. A deployment
   needing new schema ships it in an installed module package, on one of three rungs: a **side
   table** the package owns, …" with "A deployment needing new schema ships it from a module of its
   own (an overlay module or an installed module package) on one of three rungs: a **side table**
   the module owns, **declared extension columns** on an extensible table (Principle I), or a
   **variant the owning module provides**." The sentence after it ("Schema, entity or migration
   overrides of existing core units … are never offered") is unchanged.
4. **New bullet, "Trust follows origin."** "What a module may contribute across owners is decided by
   where the platform discovered it (core, the deployment's overlay, or an installed package),
   never by anything the module declares about itself. A deployment may grant an installed package
   one named contribution point in its committed declaration; the grant is a permission at that
   point only and changes neither the package's origin nor any other point. No origin may decorate
   a registration an installed package owns, and no module decorates a guard seam." The bullet
   names no per-mechanism capability. Those live with their owners (189's
   `contracts/module-origin.md` §4 – §5, 188's policy points and its `policyParticipantGrants`), so
   the constitution does not restate a table that two specs own (OR-10).
5. **Rationale.** Replace "(services / routes / config / new modules, schema deferred)" with a
   sentence citing D-297: an instance has no core tree to own a table from, so the premise of the
   deferral (D-106) does not hold there, and one module concept is cheaper than two.

## Sync Impact Report checklist (for the amending merge request)

- Modified: XV (items 1 – 5). 189's XV sentences are kept as found, and XIII is untouched (OR-9).
  Added / removed sections: none.
- Version line: the MINOR after the version `master` carries, which includes 189's amendment.
- Templates: grep `.specify/templates/*` for "ship no schema" / "shadow". None are expected.
- The `AGENTS.md` summary of XV ("a deployment customises through an overlay module, never by
  editing core") stays true and is not edited.
- Docs aligned in the same pass: `contracts/docs-pass.md`.
