import type { OpportunityHookData, OpportunityOutbox, OpportunityRecord, OpportunityStatusKind } from '@endora-commerce/contracts';
import { isDeepStrictEqual } from 'util';
import { effectiveOpportunityValue } from '../domain/effective-value.js';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { auditSnapshot, type ValueChangeKeys } from './opportunity-audit-state.js';

/**
 * An Opportunity row as the published {@link OpportunityRecord} — the one
 * mapping `opportunityReadPort` answers with and `crm.opportunity.create` /
 * `.update` hand their hooks. `statusKind` is the caller's to resolve: the
 * read port from the workflow graph, a Command from the status row it holds.
 */
export function opportunityRecordOf(row: CrmOpportunity, statusKind: OpportunityStatusKind): OpportunityRecord {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    organizationId: row.organizationId,
    customerAccountId: row.customerAccountId ?? null,
    salesChannelId: row.salesChannelId ?? null,
    statusCode: row.statusCode,
    statusKind,
    assignedAdminUserId: row.assignedAdminUserId ?? null,
    value: effectiveOpportunityValue(row),
    valueMode: row.valueMode,
    currency: row.currency,
    closedAt: row.closedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // `specs/186-aggregate-ports/` R-8 — on the row already, so no query.
    customFieldValues: { ...(row.customFieldValues ?? {}) },
  };
}

/** The audit snapshot's fields a hook is told about by name; `number` is assigned, never written. */
const SNAPSHOT_FIELDS = ['assignedAdminUserId', 'expectedCloseDate', 'salesChannelId', 'statusCode', 'valueMode'] as const;

/**
 * What `crm.opportunity.create` and `.update` hand a `beforeCommit` hook
 * (`specs/193-admin-form-extensions/` FR-111): the uncommitted after-state,
 * and the names of what the write set or changed — the value-store names
 * `recordValueChange` answered, joined with the audit snapshot's fields that
 * differ from `snapshotBefore` (`null` for a creation: every non-empty one).
 */
export function opportunityHookData(
  row: CrmOpportunity,
  statusKind: OpportunityStatusKind,
  snapshotBefore: Record<string, unknown> | null,
  values: ValueChangeKeys,
): OpportunityHookData {
  const after = auditSnapshot(row);
  const snapshotChanged = SNAPSHOT_FIELDS.filter((field) =>
    snapshotBefore === null
      ? (after[field] ?? null) !== null
      : !isDeepStrictEqual(snapshotBefore[field] ?? null, after[field] ?? null),
  );
  return {
    opportunity: opportunityRecordOf(row, statusKind),
    changedFields: [...new Set([...(values.changedFields ?? []), ...snapshotChanged])].sort(),
    changedCustomFields: [...(values.changedCustomFields ?? [])],
  };
}

/** The `afterCommit` row of either action: ids and names only (audit-state list 1). */
export function opportunityOutboxData(hook: OpportunityHookData): OpportunityOutbox {
  return {
    opportunityId: hook.opportunity.id,
    organizationId: hook.opportunity.organizationId,
    changedFields: [...hook.changedFields],
    changedCustomFields: [...hook.changedCustomFields],
  };
}
