import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ErrorCode,
  type ProjectMergeStartHookData,
  type ProjectMergeStartOutbox,
  type RecordMergeChoice,
  type RecordMergeRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { Project } from '../entities/project.entity.js';
import { projectMergeRefusals } from '../merge/project-merge-rules.js';

/**
 * `projects.project.merge.start` (`specs/192-organization-merge/` US6, FR-060,
 * FR-061, FR-090; `contracts/project-merge.md` §2) — hookable, irreversible.
 *
 * The caller has asked the aggregated preview and refused on any refusal. This
 * Command locks both Project rows, asks again — under the lock — whether the
 * caller still sees both (`404 PROJECT_NOT_FOUND` otherwise) and the host's own
 * rules on what it locked, and records the merge through the platform: the
 * merge row, its steps and the two lock rows whose primary key refuses a racing
 * start. The freeze and the enqueue follow the commit
 * (`recordMergeService.announce`). A `beforeCommit` hook's veto rolls all of it
 * back.
 *
 * Audit: ids, codes and counts only — the field choices as `{ title: 'loser' }`,
 * never a title (`specs/conventions/audit-state.md`).
 */
export interface ProjectMergeStartCommandInput {
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

export interface ProjectMergeStartDeps {
  readonly recordMerge: () => RecordMergeService;
  /** Whether the caller still sees the Project, asked on the Command's own `em` (`ProjectAccess`). */
  readonly assertVisibleUnderLock: (em: EntityManager, id: string) => Promise<void>;
}

/** The HTTP error a host refusal answers: `422` for the same Project, `409` otherwise. */
export function projectMergeRefusalError(refusal: {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}): HttpError {
  const status = refusal.code === ERROR_CODES.RECORD_MERGE_SAME_RECORD ? 422 : 409;
  return new HttpError(
    status,
    refusal.code as ErrorCode,
    'These projects cannot be merged.',
    refusal.details ? { ...refusal.details } : undefined,
  );
}

export function makeProjectMergeStartCommand(
  deps: ProjectMergeStartDeps,
  input: ProjectMergeStartCommandInput,
): Command<RecordMergeRecord> {
  const hooked = (): ProjectMergeStartHookData & ProjectMergeStartOutbox => ({
    projectId: input.survivorId,
    mergeId: input.mergeId,
    survivorId: input.survivorId,
    loserId: input.loserId,
    source: input.source,
  });
  return {
    action: 'projects.project.merge.start',
    objectType: 'project',
    objectId: input.survivorId,
    ...(input.extensions ? { extensions: input.extensions } : {}),
    hookData: hooked,
    outboxData: hooked,
    run: async ({ em, actor }) => {
      // Both rows, in id order, so two starts over the same pair queue instead
      // of deadlocking; the merge lock rows below are what refuses the second.
      const ordered = [input.survivorId, input.loserId].sort();
      await em.execute('select "id" from "projects" where "id" in (?, ?) order by "id" for update', ordered);
      const [survivor, loser] = await Promise.all([
        em.findOne(Project, { id: input.survivorId }, { refresh: true }),
        em.findOne(Project, { id: input.loserId }, { refresh: true }),
      ]);
      const refusals = projectMergeRefusals(survivor, loser, input);
      if (refusals.length > 0) throw projectMergeRefusalError(refusals[0]!);
      await deps.assertVisibleUnderLock(em as EntityManager, input.survivorId);
      await deps.assertVisibleUnderLock(em as EntityManager, input.loserId);

      const record = await deps.recordMerge().begin(em as EntityManager, {
        mergeId: input.mergeId,
        hostType: 'project',
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
