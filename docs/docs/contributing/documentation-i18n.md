---
title: Documentation site i18n
description: Manual bilingual workflow for English source pages and Polish materialisations in the Docusaurus docs site.
sidebar_label: Documentation i18n
---

# Documentation site i18n

The Docusaurus site under `docs/` ships **English and Polish** user-facing prose.
Repository working language for code, specs and commit messages stays English
(Constitution Principle VIII). Polish documentation is **authored manually** in
the same merge request as the English edit — there is no machine-translation
step in CI or production builds.

This page is the workflow for **docs-site** translations. Admin UI string bundles
(`packages/modules/*/i18n/`) are a separate system — see
[Admin UI Translations](./translations).

## What must be translated

`pnpm --filter backend run check:docs-translations` (FR-022) enumerates every
English source and expects a pinned cache entry plus a materialised markdown
file for each locale in `docs/locales.config.json` → `translateLocales`
(v1: `pl` only):

| Layer | English source | Cache `sourcePath` key |
| --- | --- | --- |
| Hand-authored site pages | `docs/docs/**/*.md` (excluding generated categories) | repo-relative path, e.g. `docs/docs/intro.md` |
| Module reference (generated) | `docs/docs/module-reference/*.md` | `generated:module-reference/<slug>` |
| Module map (generated) | `docs/docs/modules/module-map.generated.md` | repo-relative path |
| Module-owned pages | `packages/modules/<id>/docs/**/*.md` | repo-relative path |

Paths listed in `docs/translation-skip.json` are excluded (today:
`docs/docs/contributing/translations.md`, which is the Admin UI glossary).

Sidebar category and doc labels from `docs/sidebars.js` and
`docs/sidebars.modules.generated.js` need matching message ids in
`docs/i18n/<locale>/code.json` (`sidebar.main.category.<key>`,
`sidebar.main.doc.<key>`).

## Three-step edit sequence

Use this sequence when you change one English page and its Polish translation
(SC-006). Steps 1–2 are file edits; step 3 is the local guard.

1. **Edit the English source** — hand-authored page under `docs/docs/`, or the
   module's own `docs/` directory at the package root (not under `src/`).
2. **Write or update the Polish materialisation** in the same merge request:
   - Add or update the cache entry at
     `docs/translation-cache/pl/<sourceKey>.json` (slashes in the source path
     become `--`, e.g. `docs/docs/intro.md` →
     `docs--docs--intro.md.json`).
   - Set `sourceHash` to the sha256 of the normalised English **body** (YAML
     front matter stripped; see `hashSourceBody()` in
     `backend/scripts/lib/docs-translation-cache.ts`).
   - Set `content` to the full Polish markdown (front matter + body).
   - Copy `content` to the materialised path
     `docs/i18n/pl/docusaurus-plugin-content-docs/current/<docId>.md`
     (e.g. `packages/modules/catalog/docs/catalog.md` →
     `.../current/modules/catalog.md`).
   - If you changed a sidebar label or added a sidebar entry, add the matching
     key to `docs/i18n/pl/code.json`.
3. **Run the completeness check**:

   ```bash
   pnpm --filter backend run check:docs-translations
   ```

   Exit code `0` = every source has a fresh cache entry, materialised file, and
   sidebar message. Exit code `2` lists `missing-translation`,
   `stale-translation`, or `missing-sidebar-message` findings.

### Cache entry shape

```json
{
  "sourcePath": "docs/docs/intro.md",
  "sourceHash": "<sha256 of English body>",
  "locale": "pl",
  "content": "---\ntitle: Wstęp\n---\n\n…",
  "meta": {
    "provider": "manual",
    "updatedAt": "2026-09-17T12:00:00.000Z"
  }
}
```

Preserve code fences, inline code, URLs, file paths, CLI commands, JSON/YAML
literals, HTTP methods/paths and module ids unchanged in Polish prose (FR-007).

## Generated English artefacts

`pnpm --filter backend run composer:generate` emits **English only** for:

- module reference pages under `docs/docs/module-reference/`,
- the module map at `docs/docs/modules/module-map.generated.md`,
- the generated sidebar fragment `docs/sidebars.modules.generated.js`.

After regeneration, **manually mirror Polish** under `docs/i18n/pl/`:

- cache entries keyed as `generated:module-reference/<slug>` (and the module-map
  repo-relative path),
- materialised files under
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/` and
  `.../modules/`,
- new or changed sidebar message ids in `docs/i18n/pl/code.json`.

Do not edit generated English files for Polish — update the i18n tree and cache
instead (FR-012, FR-014).

`pnpm --filter backend run docs:collect` (English copies into `docs/docs/modules/`)
does not write Polish; committed i18n files supply the Polish locale at build
time.

## Optional verification

After `check:docs-translations` passes, confirm both locales build:

```bash
pnpm --filter docs run build
```

`onBrokenLinks: 'throw'` must pass for English and Polish (FR-008).

## Adding a future locale (FR-025)

Additional locales are **additive** — no pipeline rearchitecture. To add, for
example, German:

1. Append `"de"` to `locales` and `translateLocales` in
   `docs/locales.config.json`.
2. Add `label` (and related theme strings) for `de` in
   `docs/docusaurus.config.js` → `i18n.localeConfigs`.
3. Scaffold `docs/i18n/de/code.json` (copy the `pl` structure and translate
   theme + sidebar messages).
4. Manually author cache entries under `docs/translation-cache/de/` and
   materialised markdown under
   `docs/i18n/de/docusaurus-plugin-content-docs/current/` for every English
   source (same layers and keys as Polish).
5. Run `pnpm --filter backend run check:docs-translations` and
   `pnpm --filter docs run build` — both must exit `0`.

All consumers (`check-docs-translations.ts`, Docusaurus config, future hooks)
read `loadDocsLocales()` from `docs/locales.config.json` — do not hard-code
locale codes in scripts.

## See also

- [Admin UI Translations](./translations) — Polish glossary and
  `packages/modules/*/i18n/` bundle workflow (feature 021).
- `specs/conventions/module-documentation.md` — where module-owned English pages live
  before translation.
