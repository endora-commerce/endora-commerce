---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
---

Issue #501 — bulk operations and language tags in the catalog admin.

- **Undo refusals have their own codes.** `POST /api/v1/admin/catalog/bulk-operations/:id/undo` used to refuse every case with `409 VERSION_CONFLICT`. It now answers `409 BULK_OPERATION_RUNNING` while the operation is pending or running, `409 BULK_OPERATION_ALREADY_REVERTED` once it has been undone, and `409 BULK_OPERATION_NOT_REVERSIBLE` when there is nothing it can restore. All three are added to `ERROR_CODES` in `@endora-commerce/contracts` (additive), declared by `catalog` and translated (en, pl). A client that matched `VERSION_CONFLICT` on this route should match the new codes. The admin still hides Undo until an operation completes.
- **"Unchanged" on the bulk operation detail page.** A product already in the requested state stays `succeeded` with empty `changedFields`, so the API contract is unchanged. The detail page now shows it as *Unchanged* / *Bez zmian*, using the same rule as the bulk edit dialog's summary. The succeeded count is untouched.
- **Language tags in canonical case.** The scope map, the bulk status dialog's language list and the scope and URL-key messages show a language tag as stored (`de-DE`) instead of upper-cased (`DE-DE`). The scope map's language column headers opt out of the table header's upper-case style.
