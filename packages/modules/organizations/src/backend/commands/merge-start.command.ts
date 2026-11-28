import {
  ERROR_CODES,
  type ErrorCode,
  type OrganizationMergeStartHookData,
  type OrganizationMergeStartOutbox,
  type RecordMergeChoice,
  type RecordMergeRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { MERGE_FIELD_SET_WRITES, mergedSurvivorFields, organizationMergeRefusals } from '../merge/organization-merge-rules.js';

/**
 * `organization.merge.start` (`specs/192-organization-merge/` FR-004, FR-060,
 * FR-061; `contracts/organization-merge.md` §2) — hookable, irreversible.
 *
 * The caller has already asked the aggregated preview and refused on any
 * refusal (participants and the completeness twin read their own tables, on
 * their own connections). This Command then locks both Organization rows,
 * asks the host's own rules again on what it locked — so the start never
 * accepts what the preview refused — and records the merge through the
 * platform: the merge row, its steps, and the two lock rows whose primary key
 * refuses a racing start. The freeze and the enqueue follow the commit
 * (`recordMergeService.announce`). A `beforeCommit` hook's veto rolls all of it
 * back; nothing is written.
 *
 * Audit: ids, codes and counts only — the field choices as `{ name: 'loser' }`,
 * never a name (`specs/conventions/audit-state.md`, O-2).
 */
export interface MergeStartCommandInput {
  readonly mergeId: string;
  readonly survivorId: string;
  readonly loserId: string;
  readonly fieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly source: string | null;
  /** The preview's per-module counts, recorded for the history (FR-060). */
  readonly participantCounts: Readonly<Record<string, number>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export function mergeRefusalError(refusal: {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}): HttpError {
  const status = refusal.code === ERROR_CODES.RECORD_MERGE_SAME_RECORD ? 422 : 409;
  return new HttpError(
    status,
    refusal.code as ErrorCode,
    'These organizations cannot be merged.',
    refusal.details ? { ...refusal.details } : undefined,
  );
}

export function makeMergeStartCommand(
  deps: { readonly recordMerge: () => RecordMergeService },
  input: MergeStartCommandInput,
): Command<RecordMergeRecord> {
  // `specs/193-admin-form-extensions/` D-300.28 — the outcome this start fixes
  // on the survivor, set by `run` on the rows it locked, before the bus asks for
  // the hook data and the field-rule check holds it.
  let survivor: OrganizationMergeStartHookData['survivor'] = {
    after: Object.fromEntries(MERGE_FIELD_SET_WRITES.map((key) => [key, undefined])),
    changed: [],
  };
  return {
    action: 'organization.merge.start',
    objectType: 'organization',
    objectId: input.survivorId,
    ...(input.extensions ? { extensions: input.extensions } : {}),
    hookData: (): OrganizationMergeStartHookData => ({
      mergeId: input.mergeId,
      survivorId: input.survivorId,
      loserId: input.loserId,
      source: input.source,
      survivor,
    }),
    outboxData: (): OrganizationMergeStartOutbox => ({
      organizationId: input.survivorId,
      mergeId: input.mergeId,
      survivorId: input.survivorId,
      loserId: input.loserId,
      source: input.source,
    }),
    run: async ({ em, actor }) => {
      // Both rows, in id order, so two starts over the same pair queue instead
      // of deadlocking; the merge lock rows below are what refuses the second.
      const ordered = [input.survivorId, input.loserId].sort();
      await em.execute('select "id" from "organizations" where "id" in (?, ?) order by "id" for update', ordered);
      const [survivorRow, loserRow] = await Promise.all([
        em.findOne(Organization, { id: input.survivorId }, { refresh: true }),
        em.findOne(Organization, { id: input.loserId }, { refresh: true }),
      ]);
      const refusals = organizationMergeRefusals(survivorRow, loserRow, input);
      if (refusals.length > 0) throw mergeRefusalError(refusals[0]!);
      // Only after the refusals: they answer for missing rows.
      const outcome = mergedSurvivorFields(survivorRow!, loserRow!, input.fieldChoices);
      survivor = { after: outcome.after, changed: outcome.changed };

      const record = await deps.recordMerge().begin(em, {
        mergeId: input.mergeId,
        hostType: 'organization',
        survivorId: input.survivorId,
        loserId: input.loserId,
        fieldChoices: input.fieldChoices,
        customFieldChoices: input.customFieldChoices,
        actor,
        source: input.source,
      });
      return {
        result: record,
        before: null,
        after: {
          mergeId: record.id,
          loserId: input.loserId,
          fieldChoices: { ...input.fieldChoices },
          customFieldChoices: { ...input.customFieldChoices },
          source: input.source,
          participantCounts: { ...input.participantCounts },
        },
      };
    },
  };
}
