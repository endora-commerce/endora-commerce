import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge steps (`specs/192-organization-merge/` R-12). */
export const INVOICE_LEDGER_MERGE_REASSIGN_ACTION = 'invoice_ledger.merge_reassign';

/** Which of this module's two Organization participations a batch belongs to. */
export type InvoiceLedgerMergePart = 'client-maps' | 'document-maps';

export interface InvoiceLedgerMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

/**
 * The loser's client mappings the survivor has no mapping for under the same
 * adapter, credential and environment — the ones that move (S+f). The others
 * stay on the archived loser (OQ-10).
 */
export const CLIENT_MAP_FILLS_GAP = `not exists (
  select 1 from "invoice_ledger_client_maps" as "s"
   where "s"."organization_id" = ? and "s"."adapter_id" = "m"."adapter_id"
     and "s"."environment" = "m"."environment" and "s"."credential_code" = "m"."credential_code")`;

/**
 * `invoice_ledger.merge_reassign` — one batch of either `invoice_ledger`
 * participant (`specs/192-organization-merge/` T045, FR-044, OQ-10):
 *
 *  - `client-maps` (S+f): a loser mapping moves to the survivor only where the
 *    survivor has none for its adapter, credential and environment — the
 *    survivor's mapping wins, and the loser's stays on the archived loser,
 *    listed in the preview, for the operator to resolve in the external system;
 *  - `document-maps` (R): the loser's document mappings are re-pointed.
 *
 * The delivery log is kept as it was written. Moving a row consumes the
 * loser's state (R-3), and a mapping left behind is not counted again.
 * Irreversible, no event; the audit names the merge and the ids only.
 */
export function makeInvoiceLedgerMergeReassignCommand(
  part: InvoiceLedgerMergePart,
  input: MergeStepInput,
): Command<InvoiceLedgerMergeReassignResult> {
  return {
    action: INVOICE_LEDGER_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const limit = Math.max(1, input.batchSize);
      const rows =
        part === 'client-maps'
          ? await em.execute<Array<{ id: string }>>(
              `update "invoice_ledger_client_maps" set "organization_id" = ?, "updated_at" = now()
                where "id" = any(array(select "m"."id" from "invoice_ledger_client_maps" as "m"
                                where "m"."organization_id" = ? and ${CLIENT_MAP_FILLS_GAP}
                                order by "m"."id" limit ? for update))
                returning "id"`,
              [input.survivorId, input.loserId, input.survivorId, limit],
            )
          : await em.execute<Array<{ id: string }>>(
              `update "invoice_ledger_document_maps" set "organization_id" = ?
                where "id" = any(array(select "id" from "invoice_ledger_document_maps" where "organization_id" = ? order by "id" limit ? for update))
                returning "id"`,
              [input.survivorId, input.loserId, limit],
            );
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, part, moved: ids.length, ids },
      };
    },
  };
}
