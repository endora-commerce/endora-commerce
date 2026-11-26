import {
  PROJECT_READ_PORT_SEARCH_MAX,
  type ProjectNotePage,
  type ProjectNoteQuery,
  type ProjectRecord,
  type ProjectReadPort,
  type ProjectRecordKind,
  type ProjectSearchQuery,
} from '@endora-commerce/contracts';
import type { ProjectCommentService } from './comment-service.js';
import type { ProjectAccess, VisibleProjectRow } from './project-access.js';
import type { ProjectReadService } from './project-read-service.js';
import type { RecordProjectService } from './record-project-service.js';

export interface ProjectReadPortDeps {
  access: Pick<ProjectAccess, 'findVisible' | 'findVisibleMany' | 'searchVisible'>;
  read: Pick<ProjectReadService, 'summary'>;
  records: Pick<RecordProjectService, 'findByRecord'>;
  /** The notes listing — the comment service's, which owns the table (issue #1905). */
  notes: Pick<ProjectCommentService, 'listNotes'>;
}

/**
 * `projectReadPort` (`specs/163-projects-and-tasks/contracts/ports-and-events.md`
 * §2) — reading Projects from another module, an overlay or a later feature.
 *
 * Every answer starts from `ProjectAccess` under the caller's own context: by
 * id through `findVisible`, by record through the record panel's link lookup
 * (`record-project-service.ts`), which hands the id it finds to `findVisible`.
 * Out of reach, invisible and missing are one answer, `null`. The record is a
 * plain object, never an entity; its current Stage's name and its
 * Organizations come from the summary the record panel answers with. Notes
 * are listed by the comment service, whose statement carries `ProjectAccess`'s
 * predicate over each note's Project.
 */
export class ProjectReadPortService implements ProjectReadPort {
  constructor(private readonly deps: ProjectReadPortDeps) {}

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.deps.access.findVisible(id);
    return row === null ? null : this.#record(row);
  }

  /** The Projects of `ids` the caller may see; a hidden or missing id is absent (165 R-5). */
  async findByIds(ids: readonly string[]): Promise<ProjectRecord[]> {
    const rows = await this.deps.access.findVisibleMany(ids);
    return Promise.all(rows.map((row) => this.#record(row)));
  }

  /** Projects the caller may see by number or title, newest first, at most 20 (165 R-5). */
  async search(query: ProjectSearchQuery): Promise<ProjectRecord[]> {
    const limit = Math.min(Math.max(0, Math.trunc(query.limit)), PROJECT_READ_PORT_SEARCH_MAX);
    const rows = await this.deps.access.searchVisible(query.q ?? '', limit);
    return Promise.all(rows.map((row) => this.#record(row)));
  }

  /** The notes of the Projects the caller may see, a keyset page at a time (issue #1905). */
  listNotes(query: ProjectNoteQuery): Promise<ProjectNotePage> {
    return this.deps.notes.listNotes(query);
  }

  async findByRecord(kind: ProjectRecordKind, id: string): Promise<ProjectRecord | null> {
    const row = await this.deps.records.findByRecord(kind, id);
    return row === null ? null : this.#record(row);
  }

  #record(row: VisibleProjectRow): Promise<ProjectRecord> {
    return projectRecordOf(row, this.deps.read);
  }
}

/**
 * A Project row as it crosses a module boundary: a plain object, never the
 * entity. Its current Stage's name and its Organizations come from the summary
 * the record panel answers with; its custom-field values are the stored bag
 * (`specs/186-aggregate-ports/` FR-015), every key included. Shared by
 * `projectReadPort` and `projectCommandPort`, which answers the record a write
 * left.
 */
export async function projectRecordOf(
  row: VisibleProjectRow,
  read: Pick<ProjectReadService, 'summary'>,
): Promise<ProjectRecord> {
  const summary = await read.summary(row);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    state: row.state,
    currentStageId: row.current_stage_id,
    currentStageName: summary.currentStage?.name ?? null,
    organizationIds: summary.organizations.map((organization) => organization.id),
    valueAmount: row.value_amount,
    valueCurrency: row.value_currency,
    templateId: row.template_id,
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    createdAt: new Date(row.created_at),
    customFieldValues: { ...(row.custom_field_values ?? {}) },
    version: row.version,
    configurationVersion: row.configuration_version,
  };
}
