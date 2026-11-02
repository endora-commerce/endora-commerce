# Contract: admin HTTP API (`/api/v1/admin/forms*`, `/api/v1/admin/forms/entries*`)

All routes are registered through `ctx.routes` in `packages/modules/forms/src/backend/index.ts`
(Principle XVII: `503 MODULE_DISABLED` while off), declare their gate as the route `preHandler`
(`requireAdmin('<code>')` literal), validate with the Zod schemas of `packages/contracts/src/forms.ts`,
and run every write through `CommandBus.run` (actor from the ambient TenantContext). Responses use the
platform envelope `{ data }` / `{ error: { code, message, details?, requestId } }`. JSON camelCase.

## §1 Forms — `forms:read` / `forms:write`

| Method & path | Gate | Body / query | Answer |
| --- | --- | --- | --- |
| `GET /api/v1/admin/forms` | `forms:read` | `?status=&q=&page=&pageSize≤100` | `{ items: FormSummary[], total }` — `FormSummary = { id, key, name, status, defaultLanguage, publishedVersionNumber, entryCount, updatedAt, warnings }` |
| `POST /api/v1/admin/forms` | `forms:write` | `{ name, key?, defaultLanguage }` (key derived from name when absent, unique-suffixed) | `201 FormDetail` (status `draft`, one empty one-column section) · `409 FORM_KEY_TAKEN` |
| `GET /api/v1/admin/forms/:id` | `forms:read` | — | `FormDetail = FormSummary & { definition, recipients, channelRecipients, retentionDays, revision, warnings, publishedDefinition: FormDefinition \| null }` · `404 FORM_NOT_FOUND` |
| `PUT /api/v1/admin/forms/:id` | `forms:write` | `{ expectedRevision, name?, key?, defaultLanguage?, definition? }` — shape-validated only | `FormDetail` · `409 FORM_REVISION_CONFLICT` · `409 FORM_KEY_TAKEN` |
| `PUT /api/v1/admin/forms/:id/notifications` | `forms:write` | `{ expectedRevision, recipients: email[] ≤ 10, channelRecipients: Record<uuid, email[] ≤ 10> }` | `FormDetail` |
| `PUT /api/v1/admin/forms/:id/retention` | `forms:write` + `forms:entries_write` + unrestricted scope | `{ expectedRevision, retentionDays: number \| null }` | `FormDetail` · `403 FORM_SCOPE_REQUIRED` |
| `GET /api/v1/admin/forms/:id/retention-impact` | `forms:write` | `?days=` | `{ entriesToDelete: number }` (edge case: warn before saving; counted in the caller's scope) |
| `POST /api/v1/admin/forms/:id/publish` | `forms:write` | `{ expectedRevision }` | `FormDetail` (new version) · `400 FORM_DEFINITION_INVALID` `details.issues: { code, elementId, path }[]` |
| `POST /api/v1/admin/forms/:id/close` | `forms:write` | `{ expectedRevision }` | `FormDetail` (from `published`) |
| `POST /api/v1/admin/forms/:id/reopen` | `forms:write` | `{ expectedRevision }` | `FormDetail` (from `closed`) |
| `POST /api/v1/admin/forms/:id/duplicate` | `forms:write` | `{ name? }` | `201 FormDetail` (new draft, key suffixed, working copy of the source, no entries) |
| `DELETE /api/v1/admin/forms/:id` | `forms:write` | `?expectedRevision=&confirmEntriesDeletion=true` | `204` · `409 FORM_HAS_ENTRIES` (entries exist, flag absent; `details.entryCount`) · with entries: also `forms:entries_write` and unrestricted scope, else `403 FORM_SCOPE_REQUIRED` |
| `GET /api/v1/admin/forms/:id/versions` | `forms:read` | — | `{ items: { number, publishedAt, publishedByAdminUserId }[] }` |
| `GET /api/v1/admin/forms/:id/versions/:number` | `forms:read` | — | `{ number, definition, defaultLanguage, publishedAt }` |
| `GET /api/v1/admin/forms/:id/preview` | `forms:read` | `?language=&source=working\|published` | `PublicFormDefinition` (public-api.md §1) built from the chosen copy, plus `status` — the editor canvas and the builder preview read this |

Every write emits `forms.form.changed` on commit when it changes the public read (publish, close,
reopen, delete).

## §2 Entries — `forms:entries_read` / `forms:entries_write` / `forms:entries_export`

Moved under /forms/entries (lead decision, 2026-11-02): check:action-route-permissions resolution —
the palette action `open-form-entries` (`/forms/entries`, `forms:entries_read`) resolves to
`GET /api/v1/admin/forms/entries` without an `ACTION_PERMISSION_DISAGREEMENTS` entry. The static
`entries` segment wins over the parametric `/forms/:id` in the router.

Every read passes through the tenancy guard (`FormEntry` is `@CustomerScoped`): an out-of-scope entry
is `404 FORM_ENTRY_NOT_FOUND`, the same body as a missing one, on every route below.

| Method & path | Gate | Body / query | Answer |
| --- | --- | --- | --- |
| `GET /api/v1/admin/forms/entries` | `forms:entries_read` | `?formId=&status=new&status=read…&submittedFrom=&submittedTo=&salesChannelId=&q=&cursor=&limit≤100` | `{ items: FormEntrySummary[], nextCursor }` newest first — `FormEntrySummary = { id, formId, formName, formVersion, status, salesChannelId, language, submittedAt, submitterEmail, attributed: boolean }` |
| `GET /api/v1/admin/forms/entries/:id` | `forms:entries_read` | — | `FormEntryDetail = summary & { pageUrl, answers: { fieldKey, label, type, value }[] (version labels, version order, removed fields included), consents, customerAccountId, organizationId, notes: { id, body, authorAdminUserId, createdAt }[] }` — no side effect |
| `POST /api/v1/admin/forms/entries/:id/mark-read` | `forms:entries_read` | — | `FormEntryDetail` (status `new` → `read`; otherwise unchanged, no audit) |
| `PATCH /api/v1/admin/forms/entries/:id/status` | `forms:entries_write` | `{ status, expectedStatus }` | `FormEntryDetail` · `409 FORM_ENTRY_STATUS_CONFLICT` |
| `POST /api/v1/admin/forms/entries/:id/notes` | `forms:entries_write` | `{ body }` (1…5 000) | `201 note` |
| `DELETE /api/v1/admin/forms/entries/:id` | `forms:entries_write` | — | `204` |
| `POST /api/v1/admin/forms/entries/delete` | `forms:entries_write` | `{ ids: uuid[] 1…200 }` | `{ deleted: number }` (ids out of scope or missing are skipped silently — indistinguishable) |
| `GET /api/v1/admin/forms/entries/export` | `forms:entries_export` | list filters, `formId` **required** | `200 text/csv; charset=utf-8`, `content-disposition: attachment; filename="form-<key>-entries.csv"`, streamed (`config.streamingResponse`) — columns per research R-18 |

## §3 Error codes used

`FORM_NOT_FOUND`, `FORM_KEY_TAKEN`, `FORM_DEFINITION_INVALID`, `FORM_REVISION_CONFLICT`,
`FORM_HAS_ENTRIES`, `FORM_SCOPE_REQUIRED`, `FORM_ENTRY_NOT_FOUND`, `FORM_ENTRY_STATUS_CONFLICT`, plus
the platform's `VALIDATION_FAILED`, `FORBIDDEN`, `UNAUTHORIZED`, `MODULE_DISABLED`.

## §4 Contract tests (`backend/test/contract/forms/`)

`forms-admin.contract.test.ts` and `form-entries-admin.contract.test.ts` assert every row: the gate
(401 without session, 403 without the code — before validation), the request schema (400), the
response schema (parsed with the contracts schema), and the error codes. The OpenAPI baseline
(`backend/test/fixtures/openapi-baseline.json`) is regenerated with
`UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run test/contract/kernel/openapi-baseline.test.ts`
and reviewed to contain only `forms` paths.
