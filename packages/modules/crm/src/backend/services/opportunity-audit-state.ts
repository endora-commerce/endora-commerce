import type { EntityManager } from '@mikro-orm/postgresql';
import { isDeepStrictEqual } from 'util';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import {
  CrmOpportunityValueChange,
  type CrmOpportunityValueState,
} from '../entities/crm-opportunity-value-change.entity.js';

/**
 * What a `crm.opportunity.*` audit entry may say, and where the rest goes
 * (issue #470, D-288; `specs/conventions/audit-state.md`).
 *
 * The platform audit log is one global table read under `audit_log:read`
 * without Organization reach, so an Opportunity's entry carries **names and
 * structure**: its number, codes, ids of global records and of its own child
 * rows, dates, booleans, lengths, and the names of what changed. Its title,
 * description, value, currency, contact person, Organization, tag names,
 * custom-field values, a transition's reason, an Event's name and a file's
 * name go to `crm_opportunity_value_changes` instead, written in the same
 * Command, and the entry carries that row's id as `valueChangeId`. The
 * Opportunity's change history puts them back for a reader who may see the
 * Opportunity (`opportunity-history-service.ts`).
 *
 * The title is a value here (owner question O-1 on #470 asks it for every
 * module; CRM was ruled not gated by it): it is free text and routinely names
 * the customer and the deal. The global audit screen names an Opportunity by
 * its number, and by its title only through the scoped audit-reference
 * resolver (`crm-audit-references.ts`).
 */

/**
 * Every top-level key a `crm.opportunity.*` Command may put in an audit state.
 * Anything else is a value until somebody classifies it on purpose —
 * `opportunity-audit-state.test.ts` holds the snapshot to this list and the
 * sentinel tests hold every Command's recorded state to it.
 */
export const CRM_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // The Opportunity: number, codes, global ids, a date.
  'number',
  'statusCode',
  'salesChannelId',
  'assignedAdminUserId',
  'valueMode',
  'expectedCloseDate',
  'source',
  // What changed, by name, and where the values are.
  'changedFields',
  'changedCustomFields',
  'valueChangeId',
  // A document linked: its kind and id, the link's own row and flags.
  'linkedDocument',
  'linkId',
  'documentKind',
  'documentId',
  'syncStatus',
  'linkSource',
  // Feature 162 — what a carry did, by field key and reason code.
  'customFieldCarry',
  // Notes and messages: by id, kind and length (research N-R6).
  'commentId',
  'kind',
  'authorAdminUserId',
  'length',
  'deleted',
  // Events: by id, flags and times.
  'eventId',
  'allDay',
  'startsAt',
  'endsAt',
  'remindAt',
  // Attachments: the row and the library file, by id.
  'attachmentId',
  'assetId',
  // A status change and what an Order made of it.
  'status',
  'cause',
  'causeOrderId',
  'propagationId',
  'orderId',
  'orderStatusCode',
  'skippedStatus',
  'outcome',
  'dismissed',
]);

/**
 * The audit snapshot of an Opportunity: names and structure only. What it
 * leaves out is {@link opportunityValues}.
 */
export function auditSnapshot(opportunity: CrmOpportunity): Record<string, unknown> {
  return {
    number: opportunity.number,
    statusCode: opportunity.statusCode,
    salesChannelId: opportunity.salesChannelId ?? null,
    assignedAdminUserId: opportunity.assignedAdminUserId ?? null,
    valueMode: opportunity.valueMode,
    expectedCloseDate: opportunity.expectedCloseDate ?? null,
  };
}

/**
 * The values of an Opportunity its history shows and the audit log may not
 * hold. `tags` are the tag names, as the history has always shown them.
 */
export function opportunityValues(
  opportunity: CrmOpportunity,
  tags: readonly string[] | null = null,
): CrmOpportunityValueState {
  return {
    title: opportunity.title,
    description: opportunity.description ?? null,
    organizationId: opportunity.organizationId,
    customerAccountId: opportunity.customerAccountId ?? null,
    manualValue: opportunity.manualValue ?? null,
    currency: opportunity.currency,
    ...(tags === null ? {} : { tags: [...tags] }),
    customFieldValues: { ...(opportunity.customFieldValues ?? {}) },
  };
}

/** What an audit entry says of a value change: the names, and the store row. */
export interface ValueChangeKeys {
  changedFields?: string[];
  changedCustomFields?: string[];
  valueChangeId?: string;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * Record what a write changed among the values the audit log may not hold:
 * a {@link CrmOpportunityValueChange} row in the Command's transaction, and the
 * keys the audit entry carries instead — `changedFields`, `changedCustomFields`
 * (sorted, each only when non-empty) and `valueChangeId`.
 *
 * `before: null` is something that only arrived: every non-empty value of
 * `after` counts as changed. `after: null` is something that went. Otherwise a
 * key counts when its value differs; `customFieldValues` is compared key by
 * key. Each stored side holds only what changed. Nothing changed writes no row
 * and answers `{}`.
 *
 * **Call it inside a Command, with that Command's EntityManager and an
 * Opportunity that was loaded through the scoped one** — the row carries no
 * tenant column of its own.
 */
export function recordValueChange(
  em: EntityManager,
  opportunityId: string,
  change: { before: CrmOpportunityValueState | null; after: CrmOpportunityValueState | null },
): ValueChangeKeys {
  const before = change.before ?? {};
  const after = change.after ?? {};
  const changedFields: string[] = [];
  const changedCustomFields: string[] = [];
  const storedBefore: CrmOpportunityValueState = {};
  const storedAfter: CrmOpportunityValueState = {};

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => key !== 'customFieldValues',
  );
  for (const field of fields) {
    const was = before[field] ?? null;
    const is = after[field] ?? null;
    const changed =
      change.before === null ? !isEmpty(is) : change.after === null ? !isEmpty(was) : !isDeepStrictEqual(was, is);
    if (!changed) continue;
    changedFields.push(field);
    storedBefore[field] = was;
    storedAfter[field] = is;
  }

  const customBefore = (before.customFieldValues ?? {}) as Record<string, unknown>;
  const customAfter = (after.customFieldValues ?? {}) as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(customBefore), ...Object.keys(customAfter)])]) {
    if (isDeepStrictEqual(customBefore[key] ?? null, customAfter[key] ?? null)) continue;
    changedCustomFields.push(key);
  }
  changedFields.sort();
  changedCustomFields.sort();
  if (changedCustomFields.length > 0) {
    storedBefore.customFieldValues = Object.fromEntries(changedCustomFields.map((key) => [key, customBefore[key] ?? null]));
    storedAfter.customFieldValues = Object.fromEntries(changedCustomFields.map((key) => [key, customAfter[key] ?? null]));
  }
  if (changedFields.length === 0 && changedCustomFields.length === 0) return {};

  // command-coverage-ignore: runs only inside a `crm.opportunity.*` Command's `run`, on the
  // `em` the bus handed it — the row commits with that Command's one audit entry.
  const row = em.create(CrmOpportunityValueChange, {
    opportunityId,
    before: change.before === null ? null : storedBefore,
    after: change.after === null ? null : storedAfter,
  });
  return {
    ...(changedFields.length > 0 ? { changedFields } : {}),
    ...(changedCustomFields.length > 0 ? { changedCustomFields } : {}),
    valueChangeId: row.id,
  };
}
