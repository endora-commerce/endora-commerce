import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  CLIENT_MAP_FILLS_GAP,
  makeInvoiceLedgerMergeReassignCommand,
  type InvoiceLedgerMergePart,
} from '../commands/invoice-ledger-merge-reassign.command.js';

/** The manifest keys of this module's two Organization participations. */
export const INVOICE_LEDGER_CLIENT_MAPS_MERGE_KEY = 'client-maps';
export const INVOICE_LEDGER_DOCUMENT_MAPS_MERGE_KEY = 'document-maps';

/** The loser's client mappings that stay on the archived loser, because the survivor's win (OQ-10). */
export const INVOICE_LEDGER_CLIENT_MAP_KEPT = 'INVOICE_LEDGER_CLIENT_MAP_KEPT';

export interface InvoiceLedgerMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `invoice_ledger` participants of the Organization merge
 * (`specs/192-organization-merge/` T045): `client-maps` in `configuration`,
 * `document-maps` in `records`. They check no permission and no presence
 * (`contracts/merge-participant.md` §2).
 */
export class InvoiceLedgerOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(
    private readonly part: InvoiceLedgerMergePart,
    private readonly deps: InvoiceLedgerMergeParticipantDeps,
  ) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory();
    if (this.part === 'document-maps') {
      const [row] = await em.execute<Array<{ moved: number }>>(
        `select count(*)::int as "moved" from "invoice_ledger_document_maps" where "organization_id" = ?`,
        [input.loserId],
      );
      return { counts: { 'InvoiceLedgerDocumentMap.organizationId': row?.moved ?? 0 }, conflicts: [], warnings: [], refusals: [] };
    }
    const rows = await em.execute<Array<{ id: string; moves: boolean }>>(
      `select "m"."id", ${CLIENT_MAP_FILLS_GAP} as "moves"
         from "invoice_ledger_client_maps" as "m" where "m"."organization_id" = ? order by "m"."id"`,
      [input.survivorId, input.loserId],
    );
    const kept = rows.filter((row) => !row.moves).map((row) => row.id);
    return {
      counts: { 'InvoiceLedgerClientMap.organizationId': rows.length - kept.length },
      conflicts: [],
      warnings: kept.length > 0 ? [{ code: INVOICE_LEDGER_CLIENT_MAP_KEPT, details: { clientMapIds: kept } }] : [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makeInvoiceLedgerMergeReassignCommand(this.part, input));
    return { moved };
  }
}
