import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type CustomFieldValuePort,
  type ProjectMergePreview,
  type ProjectMergeRecord,
  type ProjectMergeView,
  type RecordMergeChoice,
  type RecordMergeState,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { makeProjectMergeCancelCommand, makeProjectMergeResumeCommand } from '../commands/project-merge-control.command.js';
import { makeProjectMergeStartCommand, projectMergeRefusalError } from '../commands/project-merge-start.command.js';
import { Project } from '../entities/project.entity.js';
import { mergeProjectCustomFields } from '../services/project-custom-fields.js';
import { changedKeys, resolvedCustomFieldValues } from './project-merge-rules.js';

/**
 * The Project merge as an operation (`specs/192-organization-merge/` US6,
 * `contracts/project-merge.md` §1 – §3): what the admin routes call, what
 * `projectReadPort.previewMerge / resolveMerged / getMerge` read, and what
 * `projectCommandPort.startMerge / resumeMerge / cancelMerge` will call once
 * that port exists (#1828). Visibility and edit of both Projects are the
 * caller's gate; the start Command asks visibility again under its lock.
 */
export interface ProjectMergeStartRequest {
  readonly loserId: string;
  readonly fieldChoices?: Readonly<Partial<Record<string, RecordMergeChoice>>>;
  readonly customFieldChoices?: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible?: boolean;
  /** D-293.6: the integration that asked, recorded on the merge and its audit entry. */
  readonly source?: string | null;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ProjectMergeServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: { run<T>(command: Command<T>): Promise<T> };
  readonly recordMerge: () => RecordMergeService;
  readonly assertVisibleUnderLock: (em: EntityManager, id: string) => Promise<void>;
  readonly customFieldValues?: () => CustomFieldValuePort;
  readonly adminUsers?: () => Pick<AdminUserReadPort, 'findByIds'>;
}

function definedChoices(choices: Readonly<Partial<Record<string, RecordMergeChoice>>> | undefined): Record<string, RecordMergeChoice> {
  const out: Record<string, RecordMergeChoice> = {};
  for (const [key, value] of Object.entries(choices ?? {})) if (value !== undefined) out[key] = value;
  return out;
}

export class ProjectMergeService {
  constructor(private readonly deps: ProjectMergeServiceDeps) {}

  /** FR-002 — every refusal, per present participant what would follow, and the values that differ. Writes nothing. */
  preview(survivorId: string, loserId: string): Promise<ProjectMergePreview> {
    return this.deps.recordMerge().preview('project', survivorId, loserId);
  }

  /**
   * FR-003, FR-004 — re-checks everything the preview checked, refuses on the
   * first refusal (with every refusal in `details.refusals`), validates the
   * chosen custom-field values (FR-031), then runs the start Command and hands
   * the committed merge to the runner.
   */
  async start(survivorId: string, request: ProjectMergeStartRequest): Promise<ProjectMergeRecord> {
    if (request.acknowledgeIrreversible !== true) {
      throw new HttpError(
        422,
        ERROR_CODES.RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED,
        'A merge cannot be undone; confirm that before starting it.',
      );
    }
    const preview = await this.preview(survivorId, request.loserId);
    const first = preview.refusals[0];
    if (first !== undefined) {
      const error = projectMergeRefusalError(first);
      throw new HttpError(error.statusCode, error.code, error.message, {
        ...(first.details ?? {}),
        refusals: preview.refusals.map((refusal) => refusal.code),
      });
    }

    const customFieldChoices = definedChoices(request.customFieldChoices);
    await this.#validateCustomFieldChoices(survivorId, request.loserId, customFieldChoices);

    const participantCounts: Record<string, number> = {};
    for (const participant of preview.participants) {
      const total = Object.values(participant.counts).reduce((sum, count) => sum + count, 0);
      participantCounts[participant.moduleId] = (participantCounts[participant.moduleId] ?? 0) + total;
    }

    const record = await this.deps.commandBus.run(
      makeProjectMergeStartCommand(
        { recordMerge: this.deps.recordMerge, assertVisibleUnderLock: this.deps.assertVisibleUnderLock },
        {
          mergeId: randomUUID(),
          survivorId,
          loserId: request.loserId,
          fieldChoices: definedChoices(request.fieldChoices),
          customFieldChoices,
          source: request.source ?? null,
          participantCounts,
          ...(request.extensions ? { extensions: request.extensions } : {}),
        },
      ),
    );
    await this.deps.recordMerge().announce(record.id);
    return (await this.deps.recordMerge().get(record.id)) ?? record;
  }

  async cancel(mergeId: string, expectedVersion: number): Promise<ProjectMergeRecord> {
    const merge = await this.#require(mergeId);
    const record = await this.deps.commandBus.run(
      makeProjectMergeCancelCommand(
        { recordMerge: this.deps.recordMerge },
        { mergeId, survivorId: merge.survivorId, loserId: merge.loserId, expectedVersion },
      ),
    );
    await this.deps.recordMerge().announce(mergeId);
    return record;
  }

  async resume(mergeId: string, expectedVersion: number): Promise<ProjectMergeRecord> {
    const merge = await this.#require(mergeId);
    const record = await this.deps.commandBus.run(
      makeProjectMergeResumeCommand(
        { recordMerge: this.deps.recordMerge },
        { mergeId, survivorId: merge.survivorId, loserId: merge.loserId, expectedVersion },
      ),
    );
    await this.deps.recordMerge().announce(mergeId);
    return record;
  }

  async get(mergeId: string): Promise<ProjectMergeRecord | null> {
    const merge = await this.deps.recordMerge().get(mergeId);
    return merge !== null && merge.hostType === 'project' ? merge : null;
  }

  list(filter: { readonly state?: RecordMergeState; readonly projectId?: string }): Promise<ProjectMergeRecord[]> {
    return this.deps.recordMerge().list({
      hostType: 'project',
      ...(filter.state !== undefined ? { state: filter.state } : {}),
      ...(filter.projectId !== undefined ? { recordId: filter.projectId } : {}),
    });
  }

  /** FR-052, FR-093 — the survivor's id for a merged Project, else the id itself (one hop by construction). */
  async resolveMerged(id: string): Promise<string> {
    const archived = this.deps.recordMerge().archivedInto('project', id);
    if (archived !== null) return archived;
    const rows = await this.deps
      .emFactory()
      .execute<Array<{ merged_into_project_id: string | null }>>(
        `select "merged_into_project_id" from "projects" where "id" = ?`,
        [id],
      )
      .catch(() => []);
    return rows[0]?.merged_into_project_id ?? id;
  }

  /**
   * The merges as the Admin UI reads them: each Project's label
   * (`<number> <title>`, the archived loser's included) and the starting
   * administrator's name beside the ids; `null` where one cannot be read.
   */
  async views(records: readonly ProjectMergeRecord[]): Promise<ProjectMergeView[]> {
    if (records.length === 0) return [];
    const labels = await this.labels(records.flatMap((record) => [record.survivorId, record.loserId]));
    const actorIds = [...new Set(records.flatMap((record) => (record.actorAdminUserId === null ? [] : [record.actorAdminUserId])))];
    const admins = new Map<string, string>();
    if (actorIds.length > 0 && this.deps.adminUsers !== undefined) {
      for (const row of await this.deps.adminUsers().findByIds(actorIds)) {
        const full = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
        admins.set(row.id, full.length > 0 ? full : row.email);
      }
    }
    return records.map((record) => ({
      ...record,
      survivorName: labels.get(record.survivorId) ?? null,
      loserName: labels.get(record.loserId) ?? null,
      actorName: record.actorAdminUserId === null ? null : (admins.get(record.actorAdminUserId) ?? null),
    }));
  }

  /**
   * Project labels (`<number> <title>`) by id, the archived loser's included —
   * for the merge screens and the bell, both of which show only merges whose
   * Projects their reader sees.
   */
  async labels(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.deps
      .emFactory()
      .fork({ clear: true })
      .find(Project, { id: { $in: unique } }, { fields: ['id', 'number', 'title'] });
    return new Map(rows.map((row) => [row.id, `${row.number} ${row.title}`]));
  }

  async #require(mergeId: string): Promise<ProjectMergeRecord> {
    const merge = await this.get(mergeId);
    if (merge === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
    return merge;
  }

  async #validateCustomFieldChoices(
    survivorId: string,
    loserId: string,
    choices: Readonly<Record<string, RecordMergeChoice>>,
  ): Promise<void> {
    if (this.deps.customFieldValues === undefined) return;
    const em = this.deps.emFactory().fork({ clear: true });
    const [survivor, loser] = await Promise.all([
      em.findOneOrFail(Project, { id: survivorId }),
      em.findOneOrFail(Project, { id: loserId }),
    ]);
    const current = { ...(survivor.customFieldValues ?? {}) };
    const resolved = resolvedCustomFieldValues(survivor, loser, choices);
    const changed = changedKeys(current, resolved);
    if (changed.length === 0) return;
    await mergeProjectCustomFields(
      this.deps.customFieldValues(),
      current,
      Object.fromEntries(changed.map((key) => [key, resolved[key]])),
    );
  }
}
