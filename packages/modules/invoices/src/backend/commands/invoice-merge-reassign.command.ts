import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const INVOICE_MERGE_REASSIGN_ACTION = 'invoice.merge_reassign';

export interface InvoiceMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

/**
 * `invoice.merge_reassign` — one batch of the `invoices` participant
 * (`specs/192-organization-merge/` T044): at most `batchSize` of the loser's
 * invoices are re-pointed to the survivor. Only the owning Organization
 * changes: the issued document — number, buyer snapshot, amounts, its own
 * `updated_at` — stays as it was printed (FR-043).
 *
 * Moving the row consumes the loser's state (R-3). Irreversible, no event; the
 * audit names the merge and the ids only.
 */
export function makeInvoiceMergeReassignCommand(input: MergeStepInput): Command<InvoiceMergeReassignResult> {
  return {
    action: INVOICE_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ id: string }>>(
        `update "invoices" set "organization_id" = ?
          where "id" in (select "id" from "invoices" where "organization_id" = ? order by "id" limit ? for update)
          returning "id"`,
        [input.survivorId, input.loserId, Math.max(1, input.batchSize)],
      );
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
