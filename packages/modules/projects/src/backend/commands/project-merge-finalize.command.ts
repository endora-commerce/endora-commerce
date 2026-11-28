import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECT_MERGE_EVENTS,
  type CustomFieldValuePort,
  type MergeStepInput,
  type ProjectMergeFieldCode,
  type ProjectMergedEventV1,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { ProjectReference } from '../entities/project-reference.entity.js';
import { ProjectValueChange, type ProjectValueState } from '../entities/project-value-change.entity.js';
import { Project } from '../entities/project.entity.js';
import { changedKeys, effectiveFieldChoices, resolvedCustomFieldValues } from '../merge/project-merge-rules.js';
import { mergeProjectCustomFields } from '../services/project-custom-fields.js';
import { referenceTokensOf, storedReferencesOf } from '../services/reference-service.js';

/**
 * `projects.project.merge.finalize` (`specs/192-organization-merge/` US6,
 * FR-051, FR-054, FR-090, FR-093) — once per merge, after every step:
 *
 *  - the survivor takes the values the operator chose from the loser (each
 *    field's default where nothing was chosen) — title, description, value,
 *    start date, visibility — and the chosen custom-field values, validated
 *    against the current definitions (FR-031). Its state, current Stage,
 *    Stages and Template are never touched. A description taken from the loser
 *    brings its references with it; title, value and custom-field values are
 *    kept in the Project's own value store, as an edit's are;
 *  - the loser is archived: it keeps its row, its Stages, Stage history, moves,
 *    value changes and alerts, and gains its survivor, the time and the merge
 *    id (FR-051, FR-093);
 *  - `project.merged.v1` is dispatched once, on commit.
 *
 * Idempotent: a loser already merged into this survivor answers with nothing
 * written, nothing audited and no event. Audit: field and custom-field names,
 * never a value (`specs/conventions/audit-state.md`).
 */
export interface ProjectMergeFinalizeDeps {
  readonly recordMerge: () => RecordMergeService;
  /** Validates the chosen custom-field values against the current definitions. Absent: none to hold them to. */
  readonly customFieldValues?: () => CustomFieldValuePort;
}

export interface ProjectMergeFinalizeResult {
  readonly finalized: boolean;
  readonly survivorId: string;
}

function applyField(survivor: Project, loser: Project, code: ProjectMergeFieldCode): void {
  switch (code) {
    case 'title':
      survivor.title = loser.title;
      return;
    case 'description':
      survivor.description = loser.description;
      return;
    case 'value':
      survivor.valueAmount = loser.valueAmount ?? null;
      survivor.valueCurrency = loser.valueCurrency ?? null;
      return;
    case 'startOn':
      if (loser.startOn !== undefined) survivor.startOn = loser.startOn;
      return;
    case 'visibility':
      survivor.visibility = loser.visibility;
      return;
  }
}

function snapshot(project: Project): Record<string, unknown> {
  return {
    title: project.title,
    description: project.description,
    value: `${project.valueAmount ?? ''} ${project.valueCurrency ?? ''}`,
    startOn: project.startOn ?? null,
    visibility: project.visibility,
  };
}

export function makeProjectMergeFinalizeCommand(
  deps: ProjectMergeFinalizeDeps,
  input: MergeStepInput,
): Command<ProjectMergeFinalizeResult> {
  const mergedAt = new Date();
  let source: string | null = null;
  let organizationIds: string[] = [];
  return {
    action: 'projects.project.merge.finalize',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em: commandEm }) => {
      const em = commandEm as EntityManager;
      const ordered = [input.survivorId, input.loserId].sort();
      await em.execute('select "id" from "projects" where "id" in (?, ?) order by "id" for update', ordered);
      const [survivor, loser] = await Promise.all([
        em.findOne(Project, { id: input.survivorId }, { refresh: true }),
        em.findOne(Project, { id: input.loserId }, { refresh: true }),
      ]);
      if (survivor === null || loser === null) throw new HttpError(404, ERROR_CODES.PROJECT_NOT_FOUND, 'Project not found.');
      if (loser.mergedIntoProjectId === survivor.id) {
        return { result: { finalized: false, survivorId: survivor.id }, skipAudit: true };
      }
      if (survivor.mergedIntoProjectId || loser.mergedIntoProjectId) {
        throw new HttpError(409, ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE, 'These projects cannot be merged.', {
          record: survivor.mergedIntoProjectId ? 'survivor' : 'loser',
        });
      }
      const merge = await deps.recordMerge().getWithin(em, input.mergeId);
      if (merge === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
      source = merge.source;

      const before = snapshot(survivor);
      const valueBefore: ProjectValueState = {
        title: survivor.title,
        valueAmount: survivor.valueAmount ?? null,
        valueCurrency: survivor.valueCurrency ?? null,
      };
      const customBefore = { ...(survivor.customFieldValues ?? {}) };

      const choices = effectiveFieldChoices(survivor, loser, merge.fieldChoices);
      for (const [code, choice] of Object.entries(choices) as [ProjectMergeFieldCode, string][]) {
        if (choice === 'loser') applyField(survivor, loser, code);
      }

      // Custom fields (FR-031): the resolved bag, validated as an edit of the changed keys would be.
      const resolved = resolvedCustomFieldValues(survivor, loser, merge.customFieldChoices);
      const changedCustom = changedKeys(customBefore, resolved);
      if (changedCustom.length > 0) {
        const patch = Object.fromEntries(changedCustom.map((key) => [key, resolved[key]]));
        survivor.customFieldValues =
          deps.customFieldValues !== undefined
            ? await mergeProjectCustomFields(deps.customFieldValues(), customBefore, patch)
            : resolved;
      }

      const changedFields = changedKeys(before, snapshot(survivor));
      const changedCustomFields = changedKeys(customBefore, survivor.customFieldValues ?? {});

      // A description taken from the loser brings the references its text holds.
      if (changedFields.includes('description')) {
        const sourceRef = { projectId: survivor.id, kind: 'description' as const, sourceId: null };
        await em.nativeDelete(ProjectReference, storedReferencesOf(sourceRef));
        for (const token of referenceTokensOf(survivor.description)) {
          em.create(ProjectReference, {
            projectId: survivor.id,
            sourceKind: 'description',
            sourceId: null,
            targetType: token.type,
            targetId: token.id,
          });
        }
      }

      // The values themselves go to the Project's own store, as an edit's do (T145).
      let valueChangeId: string | undefined;
      const valueFields = changedFields.filter((field) => field === 'title' || field === 'value');
      if (valueFields.length > 0 || changedCustomFields.length > 0) {
        const beforeState: ProjectValueState = {};
        const afterState: ProjectValueState = {};
        if (valueFields.includes('title')) {
          beforeState.title = valueBefore.title ?? null;
          afterState.title = survivor.title;
        }
        if (valueFields.includes('value')) {
          beforeState.valueAmount = valueBefore.valueAmount ?? null;
          beforeState.valueCurrency = valueBefore.valueCurrency ?? null;
          afterState.valueAmount = survivor.valueAmount ?? null;
          afterState.valueCurrency = survivor.valueCurrency ?? null;
        }
        if (changedCustomFields.length > 0) {
          const side = (values: Record<string, unknown>) =>
            Object.fromEntries(changedCustomFields.map((key) => [key, values[key] ?? null]));
          beforeState.customFieldValues = side(customBefore);
          afterState.customFieldValues = side(survivor.customFieldValues ?? {});
        }
        valueChangeId = em.create(ProjectValueChange, { projectId: survivor.id, before: beforeState, after: afterState }).id;
      }
      if (changedFields.length > 0 || changedCustomFields.length > 0) survivor.version += 1;

      // The archive (FR-051): the loser keeps everything it had, and its pointer.
      loser.mergedIntoProjectId = survivor.id;
      loser.mergedAt = mergedAt;
      loser.mergeId = input.mergeId;
      loser.version += 1;
      loser.configurationVersion += 1;
      await em.flush();
      // A pointer is never more than one hop: what was merged into the loser
      // earlier now points at the survivor.
      const repointed = await em.execute<Array<{ id: string }>>(
        `update "projects" set "merged_into_project_id" = ? where "merged_into_project_id" = ? returning "id"`,
        [survivor.id, loser.id],
      );
      organizationIds = (
        await em.execute<Array<{ organization_id: string }>>(
          `select "organization_id" from "project_organizations" where "project_id" = ? order by "organization_id"`,
          [survivor.id],
        )
      ).map((row) => row.organization_id);

      return {
        result: { finalized: true, survivorId: survivor.id },
        before: null,
        after: {
          mergeId: input.mergeId,
          loserId: input.loserId,
          changedFields,
          changedCustomFields,
          ...(valueChangeId !== undefined ? { valueChangeId } : {}),
          ...(repointed.length > 0 ? { repointedMergedIds: repointed.map((row) => row.id).sort() } : {}),
        },
      };
    },
    event: ({ finalized, survivorId }) => {
      if (!finalized) return undefined;
      const payload: ProjectMergedEventV1 = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        projectId: survivorId,
        mergedProjectId: input.loserId,
        mergeId: input.mergeId,
        mergedAt: mergedAt.toISOString(),
        source,
        organizationIds,
      };
      return { eventName: PROJECT_MERGE_EVENTS.MERGED, payload };
    },
  };
}
