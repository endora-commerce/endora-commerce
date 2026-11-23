# Contract — Constitution XV, MINOR amendment (FR-100, #1857)

Lands in the documentation pass (WP11), after schema discovery and the admin layer have merged.
Version: the next MINOR **over whatever `master` carries when it merges** (4.3.0 at the time of
writing); no version is reserved in advance (the `specs/178-extensible-columns/` R-A3 precedent —
187, 188 and 189 may amend first). The Sync Impact Report states the version found and chains from it.

## Why MINOR

A material expansion of guidance (overlays gain schema, a build and a tier). No compliant work becomes
non-compliant: an overlay without schema stays valid, and the constitution never required overlays to
be build-less. Not PATCH: the bounded surface's "Overlay modules ship no schema" is reversed.

## Text changes (proposed wording; the docs pass may tighten it, not change its meaning)

1. **Opening paragraph.** Replace "through a **per-deployment overlay location** whose files shadow
   or extend their core equivalents, resolved deterministically at build/composition time" with
   "through **the deployment's own modules** in a per-deployment overlay location, which change core
   only through declared seams and are resolved deterministically at build/composition time" (file
   shadowing is retired; the sentence has been stale since 2026-09).
2. **"Overlays are ordinary participants, under the same guards."** Append: "An overlay module is a
   **full module**: it may own entities and migrations, publish a port, and ship admin surfaces and
   palette actions, under the same guards as a module package — its migrations pass the platform's
   foreign-schema guard with no deployment exemption, and every entity it registers is classified
   (Principle XI) or the platform does not boot. Overlay code is compiled and type-checked by one
   deployment-level build; an overlay is never a package in disguise (no per-module build, manifest
   or exports map)."
3. **"Bounded overridable surface (YAGNI)."** Replace "Overlay modules ship no schema. A deployment
   needing new schema ships it in an installed module package, on one of three rungs: …" with "A
   deployment needing new schema ships it from a module of its own — an overlay module or an installed
   module package — on one of three rungs: a **side table** the module owns, **declared extension
   columns** on an extensible table (Principle I), or a **variant the owning module provides**." The
   following sentence ("Schema, entity or migration overrides of existing core units … are never
   offered") is unchanged.
4. **New bullet, "Trust follows origin."** "What a module may contribute across owners is decided by
   where the platform discovered it — core, the deployment's overlay, or an installed package — and
   never by anything the module declares about itself. The deployment tier may admit or refuse
   Commands through declared middleware, take part in declared policy points and run declared command
   hooks; no tier may decorate a registration an installed package owns."
5. **Rationale.** Replace "(services / routes / config / new modules, schema deferred)" with a
   sentence citing D-297: an instance has no core tree to own a table from, so the deferral's premise
   (D-106) does not hold there, and one module concept is cheaper than two.

## Sync Impact Report checklist (for the amending merge request)

- Modified: XV (items 1 – 5). Added / removed sections: none.
- Templates: `.specify/templates/*` — grep for "ship no schema" / "shadow"; expected none.
- `AGENTS.md` summary of XV ("a deployment customises through an overlay module, never by editing
  core") stays true — not edited.
- Docs aligned in the same pass: `contracts/docs-pass.md`.
