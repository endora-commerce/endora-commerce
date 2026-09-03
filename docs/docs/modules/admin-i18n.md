---
title: Admin UI Languages
description: Admin UI per-user language preference + module-scoped translation bundles
---

# Admin UI Languages

Per-user language preference for the Admin UI plus a module-scoped translation pipeline that
lets every backend module ship its own bundle of translated strings. Polish and English are
shipped at launch; English is the platform-wide fallback. Feature 019.

The subsystem itself is the workspace package `@endora-commerce/mod-i18n`, at
`packages/modules/_i18n/` (platform-internal — leading underscore, which the npm name drops).
Its translation bundles sit at the package root, `packages/modules/_i18n/i18n/`, because the
platform anchors a module's `bundlesDir` to the module's own directory and a package's own
directory is where its `package.json` is. The admin SPA's runtime lives at `admin/src/i18n/`.

## How a user changes their language

1. Sign in to the Admin UI.
2. Open the **Profile** page (top-right avatar, or the `EN` / `PL` badge in the topbar).
3. Pick **English** or **Polski** in the **Language** section, then click **Save language**.
4. The whole Admin UI re-renders in the chosen language. No sign-out is required.

The choice is persisted on the user's record and follows the user across devices: signing in
from a different browser or machine yields the same Admin UI language as the most recent
saved choice.

New users (and users who have never made a choice) see English by default.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/i18n/bundles?language=<en\|pl>` | Returns the merged `core` + per-module bundle for the requested language plus a monotonically-non-decreasing `version` vector the SPA uses to detect refreshes. Permission: any authenticated admin. |
| `PATCH /api/v1/admin/me/preferred-language` | Sets the calling user's preferred language. Body: `{ "preferredLanguage": "en" \| "pl" \| null }`. Idempotent; `null` reverts to "no preference saved" → English fallback. Permission: any authenticated admin. |

The session-bootstrap response (`GET /api/v1/admin/me`) carries `preferredLanguage` in the
`adminUser` object so the SPA can seed its `<TranslationProvider>` without an extra round-trip.

## How a module ships translations

1. Declare the bundle directory in your manifest:

   ```typescript
   // backend/src/modules/<my_module>/manifest.ts
   import { defineModuleManifest } from '@endora-commerce/contracts';

   export const manifest = defineModuleManifest({
     id: 'my_module',
     name: 'My module',
     version: '1.0.0',
     dependencies: [],
     i18n: { bundlesDir: 'i18n' }, // ← add this
   });
   ```

2. Author per-language JSON files at `backend/src/modules/<my_module>/i18n/<lang>.json`.
   The shape is a flat `Record<string, string>` — keys are dotted (`"actions.save"`),
   values are strings. `{name}`-style placeholders are interpolated at runtime.

   ```jsonc
   // backend/src/modules/my_module/i18n/en.json
   {
     "actions.save": "Save",
     "validation.required": "This field is required.",
     "audit.userCreated": "Created user \"{email}\"."
   }
   ```

3. Replace inline strings in the admin code with `useTranslation(scope)` calls:

   ```tsx
   import { useTranslation } from '@/i18n/useTranslation';

   export function MyForm() {
     const t = useTranslation('my_module');
     return <button>{t('actions.save')}</button>;
   }
   ```

4. Restart (or re-install) the backend. The boot-time bundle reconciler walks every module
   declaring `manifest.i18n` and refreshes its `translation_bundles` rows from the JSON files
   on disk. Failures are logged but do not abort boot.

### Rules and constraints

- The supported set is currently `['en', 'pl']` (closed enum in `@endora-commerce/contracts/src/admin-i18n.ts`).
- Files for unsupported languages are rejected at install time.
- A module that ships any bundle MUST ship `en.json` (English is the platform-wide fallback).
  A Polish bundle is encouraged but optional — ship it in the same PR as the English file.
- Two modules MAY use the same key string (for example `actions.save`); each bundle is scoped
  to its owning module so the strings do not collide.
- User-authored content (CMS pages, product names, blog posts, setting *values*) is **out of
  scope** for this feature — it is rendered as authored, not re-translated.

## How the resolver picks a string

Every lookup goes through a three-step fallback chain:

1. The user's preferred-language entry under the module's scope.
2. The English entry under the module's scope.
3. A literal placeholder `${scope}.${key}` (always non-empty so the UI never goes blank).

Both the backend resolver (`I18nService.translate(...)`) and the admin SPA resolver
(`admin/src/i18n/resolver.ts`) share the same chain.

## Diagnosing missing translations

When the resolver falls back, the backend writes a structured log line through the platform's
existing logger:

```json
{ "event": "i18n.fallback", "moduleId": "settings", "languageCode": "pl", "key": "actions.save", "fellBackTo": "en" }
```

Operators can answer "what's missing in our Polish bundle?" with a single grep:

```bash
grep '"event":"i18n.fallback"' /var/log/b2b-backend.log | jq -r '"\(.languageCode) \(.moduleId).\(.key) → \(.fellBackTo)"' | sort -u
```

The admin SPA emits the same gap as a `console.warn` in development (`import.meta.env.DEV`)
and is silent in production.

## Database

One MikroORM migration (`040_admin_i18n_init.ts`) introduces:

- Sequence `translation_bundles_version_seq` (the cache-invalidation vector).
- Table `translation_bundles` — one row per `(module_id, language_code)`, JSONB `entries`,
  `version` defaults to `nextval(translation_bundles_version_seq)` so every UPSERT advances
  the sequence.
- Column `admin_users.preferred_language` (varchar(12), nullable). NULL means "no preference
  saved" → resolver treats as English.

No FK on `translation_bundles.module_id` — modules are filesystem-driven (feature 018) and the
hard-uninstall hook is the cleanup mechanism, not `ON DELETE CASCADE`.

## Adding a third language

Adding `de` (or any other BCP-47 code) is treated as a separate feature because the cost is
mostly translation work, not engineering. The schema change is one line in
`@endora-commerce/contracts/src/admin-i18n.ts`:

```typescript
export const SupportedAdminLanguageSchema = z.enum(['en', 'pl', 'de']);
```

After that, each module that emits admin-visible strings must ship `de.json` (or accept the
EN fallback). The Profile page's selector picks up the new code automatically.

## Testing

Unit tests live next to the implementation:

- `backend/test/unit/_i18n/bundle-loader.unit.test.ts` — every `BundleLoadError` reason path
  (parse-failed, invalid-shape, unsupported-language-file, missing-fallback-bundle) plus the
  happy path and EN-only acceptance.
- `backend/test/unit/_i18n/missing-key-logger.unit.test.ts` — structured log line shape.
- `backend/test/unit/_i18n/i18n-service.unit.test.ts` — the three-step fallback chain plus
  interpolation.
- `admin/test/i18n/resolver.test.ts` — the same chain on the SPA side.
- `admin/test/i18n/interpolate.test.ts` — placeholder regex.
