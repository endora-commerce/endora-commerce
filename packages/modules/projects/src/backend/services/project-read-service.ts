import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  pickLocalized,
  type AdminUserReadPort,
  type AdminUserRecord,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
  type CustomFieldListFilterPort,
  type CustomFieldValuePort,
  type OrganizationDetailsPort,
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectListResponse,
  type ProjectLossReason,
  type ProjectRole,
  type ProjectStage,
  type ProjectStageEntry,
  type ProjectStageEntryKind,
  type ProjectStageEntryNote,
  type ProjectSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { z } from 'zod';
import type { ProjectAdminSearchQuery } from '../admin-search-provider.js';
import { StageGraph } from '../domain/stage-graph.js';
import type { ProjectReferenceService } from './reference-service.js';
import {
  actingAdminUserId,
  isUuid,
  uuidArray,
  VISIBLE_PROJECT_COLUMNS,
  type ProjectAccess,
  type VisibleProjectRow,
} from './project-access.js';

/**
 * Projects — the read side of `specs/163-projects-and-tasks/contracts/admin-api.md`
 * §2.1 – §2.2: the list, one Project with everything its screen shows, its
 * Stage history, and the two dictionaries (§2.5) its forms offer.
 *
 * **Every Project this file answers came through `ProjectAccess`**: the list
 * and its total compose `visibleProjectSql`, the detail and the history start
 * from `loadVisible` — or, after a write that began there, from
 * `rowAfterWrite`. Stages, moves, Organizations, Members and links are read
 * only for the ids of Projects those returned, which is why this file is on
 * `PROJECT_ACCESS_READERS`.
 *
 * The description's reference tokens are resolved for the reader
 * (`reference-service.ts`, User Story 7). Custom Field values are answered as
 * `custom_fields` projects them — a value whose definition is gone is not
 * shown — and the list filters on them through `custom_fields`' list-filter
 * port, whose condition only narrows the visible set (User Story 9).
 */

export const PROJECTS_ALERTS_TIME_ZONE_SETTING = 'projects.alerts_time_zone';

/** The role whose holders the list names as Project Managers. */
const PROJECT_MANAGER_ROLE = 'project_manager';

const timeZoneSchema = z.string().min(1);

type SortKey = 'createdAt' | 'value' | 'deadline';

/**
 * The sort column of `value` and `deadline`, over `projects p`, as text a
 * cursor can carry and a comparison can cast back. `null` when empty.
 */
const SORT_EXPRESSIONS: Record<Exclude<SortKey, 'createdAt'>, { expr: string; cast: string }> = {
  value: { expr: `p."value_amount"`, cast: 'numeric' },
  deadline: {
    expr: `(select ks."deadline_on" from "project_stages" ks where ks."id" = p."current_stage_id")`,
    cast: 'date',
  },
};

interface Cursor {
  sort: SortKey;
  at: string;
  id: string;
  /** The sort key as text, `null` when the row's key is empty; absent for `createdAt`. */
  key: string | null;
}

interface ListRow extends VisibleProjectRow {
  sort_key: string | null;
}

function encodeCursor(sort: SortKey, row: ListRow): string {
  return Buffer.from(
    JSON.stringify({ s: sort, a: row.cursor_at, i: row.id, ...(sort === 'createdAt' ? {} : { k: row.sort_key }) }),
    'utf8',
  ).toString('base64url');
}

function badCursor(): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this list issued.');
}

function decodeCursor(cursor: string | undefined, sort: SortKey): Cursor | null {
  if (!cursor) return null;
  let parsed: { s?: unknown; a?: unknown; i?: unknown; k?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    // A cursor is opaque, and one this service did not issue is a malformed
    // request rather than "page one".
    throw badCursor();
  }
  // A cursor written before sorting existed carries no `s`: it was `createdAt`'s.
  const issuedFor = parsed.s ?? 'createdAt';
  if (issuedFor !== sort || typeof parsed.a !== 'string' || typeof parsed.i !== 'string' || !isUuid(parsed.i)) {
    throw badCursor();
  }
  if (sort !== 'createdAt' && !(parsed.k === null || typeof parsed.k === 'string')) throw badCursor();
  return { sort, at: parsed.a, id: parsed.i, key: sort === 'createdAt' ? null : (parsed.k as string | null) };
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function personName(person: { firstName: string; lastName: string; email: string }): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(person: AdminUserRecord | undefined): boolean {
  return person !== undefined && person.status === 'active' && person.deletedAt === null;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export interface ProjectReadServiceDeps {
  emFactory: () => EntityManager;
  access: ProjectAccess;
  /** `organizations`' read port — lazy, resolved per call. */
  organizations: OrganizationDetailsPort;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  settings: SettingsReadPort;
  /** What the description's tokens name, for the reader (User Story 7). */
  references: Pick<ProjectReferenceService, 'resolve'>;
  /** `custom_fields`' value service — lazy, resolved per call (User Story 9). */
  customFields: Pick<CustomFieldValuePort, 'project'>;
  /** `custom_fields`' list-filter port — lazy, resolved per call (User Story 9). */
  customFieldListFilter: CustomFieldListFilterPort;
}

interface CurrentStageRow {
  id: string;
  name: string;
  color: string;
  deadline_on: string | null;
  overdue: boolean;
}

interface StageRow {
  id: string;
  name: string;
  color: string;
  position: number;
  planned_duration_days: number;
  responsible_role_ids: string[] | string;
  alert_offsets_days: number[] | string;
  completion_gate: boolean;
  completion_permitted: boolean;
  started_on: string | null;
  deadline_on: string | null;
  deadline_manual: boolean;
  tasks_materialized_at: Date | null;
  tasks_skipped_at: Date | null;
  version: number;
}

interface StageTaskRow {
  id: string;
  stage_id: string;
  title: string;
  description: string;
  responsible_role_id: string | null;
  due_offset_days: number;
  position: number;
}

interface EntryRow {
  id: string;
  kind: ProjectStageEntryKind;
  from_stage_id: string | null;
  to_stage_id: string | null;
  from_stage_name: string | null;
  to_stage_name: string | null;
  notes: ProjectStageEntryNote[] | string;
  actor_admin_user_id: string | null;
  at: Date;
}

interface DictionaryRow {
  id: string;
  code: string;
  name: Record<string, string>;
  default_name: string;
  is_system: boolean;
  archived_at: Date | null;
  position: number;
}

/** A Postgres array as the driver hands it: parsed, or still in its text form. */
function pgArray(value: readonly unknown[] | string | null): string[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  const inner = (value as string).replace(/^\{|\}$/g, '');
  return inner === '' ? [] : inner.split(',');
}

export class ProjectReadService {
  constructor(private readonly deps: ProjectReadServiceDeps) {}

  /** `projects.alerts_time_zone` — the calendar "today" is counted in. */
  async timeZone(): Promise<string> {
    return this.deps.settings.get(PROJECTS_ALERTS_TIME_ZONE_SETTING, null, timeZoneSchema);
  }

  /**
   * `GET /projects` — on a keyset cursor, with the total the caller may see.
   * Newest first by default; `sort=value` and `sort=deadline` (the current
   * Stage's) order by that column with empty ones **last in both directions**,
   * ties broken by creation time and then id in the same direction. Out of
   * reach and invisible Projects are excluded by `visibleProjectSql`, so a
   * page, the next one and the total are exact.
   */
  async list(query: ProjectListQuery): Promise<ProjectListResponse> {
    const sort: SortKey = query.sort ?? 'createdAt';
    const where: string[] = [];
    const params: unknown[] = [];
    const visible = await this.deps.access.visibleProjectSql();
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    if (query.state && query.state.length > 0) {
      where.push(`p."state" = any(?::text[])`);
      params.push(`{${query.state.join(',')}}`);
    }
    if (query.organizationId) {
      where.push(
        `exists (select 1 from "project_organizations" f_po where f_po."project_id" = p."id" and f_po."organization_id" = ?)`,
      );
      params.push(query.organizationId);
    }
    const memberId = query.memberId === 'me' ? actingAdminUserId() : (query.memberId ?? null);
    if (query.memberId !== undefined) {
      // "Me" is whoever asks; with no administrator behind the request nobody is.
      if (memberId === null) return { items: [], nextCursor: null, total: 0 };
      where.push(
        `exists (select 1 from "project_members" f_pm where f_pm."project_id" = p."id" and f_pm."admin_user_id" = ?)`,
      );
      params.push(memberId);
    }
    if (query.roleId) {
      where.push(
        `exists (select 1 from "project_members" f_rm join "project_member_roles" f_rr on f_rr."member_id" = f_rm."id"
                  where f_rm."project_id" = p."id" and f_rr."role_id" = ?)`,
      );
      params.push(query.roleId);
    }
    if (query.templateId) {
      where.push(`p."template_id" = ?`);
      params.push(query.templateId);
    }
    if (query.stageName) {
      where.push(
        `exists (select 1 from "project_stages" f_ps where f_ps."id" = p."current_stage_id"
                  and lower(trim(f_ps."name")) = lower(trim(?)))`,
      );
      params.push(query.stageName);
    }
    if (query.q) {
      const like = likePattern(query.q);
      where.push(`(p."title" ilike ? or p."number" ilike ?)`);
      params.push(like, like);
    }
    // An id sub-select over `projects`, intersected with the visible set above:
    // it narrows, never widens. A field the list does not offer throws, and the
    // route answers 400 naming it.
    const custom = await this.#customFieldCondition(query.customFieldFilters);
    if (custom) {
      where.push(`p."id" in (${custom.sql})`);
      params.push(...custom.params);
    }

    const em = this.deps.emFactory();
    const filtered = where.length > 0 ? `where ${where.join(' and ')}` : '';
    const counted = (await em.execute(`select count(*)::int as "n" from "projects" p ${filtered}`, params)) as Array<{
      n: number;
    }>;

    const order = query.order === 'asc' ? 'asc' : 'desc';
    const cmp = order === 'desc' ? '<' : '>';
    const page = [...where];
    const pageParams = [...params];
    const after = decodeCursor(query.cursor, sort);
    let keySelect = `null::text as "sort_key"`;
    let orderBy = `p."created_at" ${order}, p."id" ${order}`;
    if (sort !== 'createdAt') {
      const { expr, cast } = SORT_EXPRESSIONS[sort];
      keySelect = `(${expr})::text as "sort_key"`;
      // Empty keys last whichever way the list runs.
      orderBy = `(${expr}) is null, (${expr}) ${order}, p."created_at" ${order}, p."id" ${order}`;
      if (after) {
        if (after.key === null) {
          // Past the last keyed row: only empty keys remain, in creation order.
          page.push(`(${expr}) is null and (p."created_at", p."id") ${cmp} (?::timestamptz, ?::uuid)`);
          pageParams.push(after.at, after.id);
        } else {
          page.push(
            `((${expr}) is null or ((${expr}), p."created_at", p."id") ${cmp} (?::${cast}, ?::timestamptz, ?::uuid))`,
          );
          pageParams.push(after.key, after.at, after.id);
        }
      }
    } else if (after) {
      page.push(`(p."created_at", p."id") ${cmp} (?::timestamptz, ?::uuid)`);
      pageParams.push(after.at, after.id);
    }
    const rows = (await em.execute(
      `select ${VISIBLE_PROJECT_COLUMNS}, ${keySelect} from "projects" p
        ${page.length > 0 ? `where ${page.join(' and ')}` : ''}
        order by ${orderBy}
        limit ?`,
      [...pageParams, query.limit + 1],
    )) as ListRow[];
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: await this.#summaries(items),
      nextCursor: hasMore ? encodeCursor(sort, items[items.length - 1]!) : null,
      total: Number(counted[0]?.n ?? 0),
    };
  }

  /**
   * Admin global search (`contracts/admin-surfaces.md` §6): the Projects the
   * caller may see whose number, title or Organization name — whichever
   * `fields` selects — contains the text, or whose id it is. The exact number
   * ranks first, then a number it begins, then the newest; `limit + 1` rows are
   * read to answer `hasMore`. The same `visibleProjectSql` as the list.
   */
  async searchForAdmin(query: ProjectAdminSearchQuery): Promise<{ rows: ProjectSummary[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const like = `%${query.likeEscaped}%`;
    const or: string[] = [];
    const orParams: unknown[] = [];
    if (fields.has('number')) {
      or.push(`p."number" ilike ?`);
      orParams.push(like);
    }
    if (fields.has('title')) {
      or.push(`p."title" ilike ?`);
      orParams.push(like);
    }
    if (fields.has('organizationName')) {
      const organizationIds = await this.deps.organizations.searchIdsByName(query.text);
      if (organizationIds.length > 0) {
        or.push(
          `exists (select 1 from "project_organizations" s_po
                    where s_po."project_id" = p."id" and s_po."organization_id" = any(?::uuid[]))`,
        );
        orParams.push(uuidArray(organizationIds));
      }
    }
    if (query.isUuid && isUuid(query.text)) {
      or.push(`p."id" = ?::uuid`);
      orParams.push(query.text);
    }
    if (or.length === 0) return { rows: [], hasMore: false };

    const where = [`(${or.join(' or ')})`];
    const params = [...orParams];
    const visible = await this.deps.access.visibleProjectSql();
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const rank = fields.has('number')
      ? `case when lower(p."number") = lower(?) then 0 when p."number" ilike ? then 1 else 2 end, `
      : '';
    const rankParams = fields.has('number') ? [query.text, `${query.likeEscaped}%`] : [];
    const rows = (await this.deps.emFactory().execute(
      `select ${VISIBLE_PROJECT_COLUMNS} from "projects" p
        where ${where.join(' and ')}
        order by ${rank}p."created_at" desc, p."id" desc
        limit ?`,
      [...params, ...rankParams, query.limit + 1],
    )) as VisibleProjectRow[];
    const hasMore = rows.length > query.limit;
    return { rows: await this.#summaries(hasMore ? rows.slice(0, query.limit) : rows), hasMore };
  }

  /** `GET /projects/custom-field-filters` — the Project custom fields the list offers as filters. */
  async customFieldFilterFields(): Promise<CustomFieldListFilterField[]> {
    return this.deps.customFieldListFilter.listFilterable('project');
  }

  async #customFieldCondition(filters: CustomFieldFilters | undefined) {
    if (filters === undefined || Object.keys(filters).length === 0) return null;
    return this.deps.customFieldListFilter.condition('project', filters);
  }

  /** `GET /projects/:id` — 404 `PROJECT_NOT_FOUND` for out of reach, invisible and missing alike. */
  async get(id: string, language: string): Promise<ProjectDetail> {
    return this.#detail(await this.deps.access.loadVisible(id), language);
  }

  /** The summary of one Project `ProjectAccess` let through — the record panel's answer (User Story 6). */
  async summary(row: VisibleProjectRow): Promise<ProjectSummary> {
    const [summary] = await this.#summaries([row]);
    return summary!;
  }

  /**
   * The summaries of Projects a statement carrying `visibleProjectSql` selected
   * — the most valuable open Projects of analytics (User Story 10) — in order.
   */
  async summaries(rows: readonly VisibleProjectRow[]): Promise<ProjectSummary[]> {
    return this.#summaries(rows);
  }

  /** The Project a write that began with `loadVisible` has just changed. */
  async afterWrite(id: string, language: string): Promise<ProjectDetail> {
    return this.#detail(await this.deps.access.rowAfterWrite(id), language);
  }

  /** One Stage of a Project the caller has just written. */
  async stageAfterWrite(projectId: string, stageId: string): Promise<ProjectStage> {
    const stages = await this.#stages(projectId);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'No such Stage on this Project.');
    return stage;
  }

  /** `GET /projects/:id/stage-history` — oldest first. */
  async stageHistory(id: string): Promise<ProjectStageEntry[]> {
    const row = await this.deps.access.loadVisible(id);
    return this.#entries(row.id, null);
  }

  /** One history row, by id, of a Project the caller has just written. */
  async entryAfterWrite(projectId: string, entryId: string): Promise<ProjectStageEntry> {
    const [entry] = await this.#entries(projectId, entryId);
    if (!entry) throw new Error(`projects: the Stage entry ${entryId} just written is gone.`);
    return entry;
  }

  /** The Project's workflow as the domain sees it — for a Project the caller may see. */
  async graphOf(projectId: string): Promise<{ graph: StageGraph; stages: StageRow[] }> {
    const em = this.deps.emFactory();
    const stages = (await em.execute(
      `select s."id", s."name", s."position", s."completion_permitted", s."planned_duration_days",
              to_char(s."started_on", 'YYYY-MM-DD') as "started_on", to_char(s."deadline_on", 'YYYY-MM-DD') as "deadline_on",
              s."deadline_manual", s."color", s."responsible_role_ids", s."alert_offsets_days", s."completion_gate",
              s."tasks_materialized_at", s."tasks_skipped_at", s."version"
         from "project_stages" s where s."project_id" = ? order by s."position", s."id"`,
      [projectId],
    )) as StageRow[];
    const moves = (await em.execute(
      `select m."from_stage_id", m."to_stage_id" from "project_stage_moves" m where m."project_id" = ?`,
      [projectId],
    )) as Array<{ from_stage_id: string; to_stage_id: string }>;
    return {
      graph: new StageGraph(
        stages,
        moves.map((m) => ({ fromStageId: m.from_stage_id, toStageId: m.to_stage_id })),
      ),
      stages,
    };
  }

  /** `GET /projects/roles` — by position; `activeOnly` leaves archived ones out. */
  async roles(activeOnly: boolean, language: string): Promise<ProjectRole[]> {
    return this.#dictionary('project_roles', activeOnly, language);
  }

  /** `GET /projects/loss-reasons` — by position; `activeOnly` leaves archived ones out. */
  async lossReasons(activeOnly: boolean, language: string): Promise<ProjectLossReason[]> {
    return this.#dictionary('project_loss_reasons', activeOnly, language);
  }

  async #dictionary(
    table: 'project_roles' | 'project_loss_reasons',
    activeOnly: boolean,
    language: string,
  ): Promise<ProjectRole[]> {
    const rows = (await this.deps.emFactory().execute(
      `select "id", "code", "name", "default_name", "is_system", "archived_at", "position" from "${table}"
        ${activeOnly ? 'where "archived_at" is null' : ''}
        order by "position", "default_name", "id"`,
    )) as DictionaryRow[];
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      defaultName: row.default_name,
      label: pickLocalized(row.name, language) || row.default_name,
      isSystem: row.is_system,
      archivedAt: iso(row.archived_at),
      position: row.position,
    }));
  }

  async #stages(projectId: string): Promise<ProjectStage[]> {
    const { stages } = await this.graphOf(projectId);
    const tasks = (await this.deps.emFactory().execute(
      `select t."id", t."stage_id", t."title", t."description", t."responsible_role_id", t."due_offset_days", t."position"
         from "project_stage_tasks" t join "project_stages" s on s."id" = t."stage_id"
        where s."project_id" = ? order by t."position", t."id"`,
      [projectId],
    )) as StageTaskRow[];
    // A Stage whose last entry recorded a failure to create its Tasks, and
    // which has had them neither created nor skipped since (the retry's rule).
    const failed = new Set(
      (
        (await this.deps.emFactory().execute(
          `select distinct on (e."to_stage_id") e."to_stage_id", 'tasks_materialize_failed' = any(e."notes") as "failed"
             from "project_stage_entries" e
            where e."project_id" = ? and e."to_stage_id" is not null
            order by e."to_stage_id", e."at" desc, e."id" desc`,
          [projectId],
        )) as Array<{ to_stage_id: string; failed: boolean }>
      )
        .filter((row) => row.failed)
        .map((row) => row.to_stage_id),
    );
    return stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      position: stage.position,
      plannedDurationDays: stage.planned_duration_days,
      responsibleRoleIds: pgArray(stage.responsible_role_ids),
      alertOffsetsDays: pgArray(stage.alert_offsets_days).map(Number),
      completionGate: stage.completion_gate,
      completionPermitted: stage.completion_permitted,
      startedOn: stage.started_on,
      deadlineOn: stage.deadline_on,
      deadlineManual: stage.deadline_manual,
      tasksMaterializedAt: iso(stage.tasks_materialized_at),
      tasksSkippedAt: iso(stage.tasks_skipped_at),
      tasksMaterializeFailed: failed.has(stage.id) && stage.tasks_materialized_at === null && stage.tasks_skipped_at === null,
      stageTasks: tasks
        .filter((task) => task.stage_id === stage.id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          responsibleRoleId: task.responsible_role_id,
          dueOffsetDays: task.due_offset_days,
          position: task.position,
        })),
      version: Number(stage.version),
    }));
  }

  async #entries(projectId: string, entryId: string | null): Promise<ProjectStageEntry[]> {
    const rows = (await this.deps.emFactory().execute(
      `select e."id", e."kind", e."from_stage_id", e."to_stage_id", e."from_stage_name", e."to_stage_name",
              e."notes", e."actor_admin_user_id", e."at"
         from "project_stage_entries" e
        where e."project_id" = ?${entryId ? ` and e."id" = ?` : ''}
        order by e."at", e."id"`,
      entryId ? [projectId, entryId] : [projectId],
    )) as EntryRow[];
    const actorIds = [...new Set(rows.map((row) => row.actor_admin_user_id).filter((id): id is string => id !== null))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return rows.map((row) => {
      const actor = row.actor_admin_user_id ? byId.get(row.actor_admin_user_id) : undefined;
      return {
        id: row.id,
        kind: row.kind,
        fromStageId: row.from_stage_id,
        toStageId: row.to_stage_id,
        fromStageName: row.from_stage_name,
        toStageName: row.to_stage_name,
        notes: pgArray(row.notes) as ProjectStageEntryNote[],
        actor: row.actor_admin_user_id
          ? { id: row.actor_admin_user_id, name: actor ? personName(actor) : '' }
          : null,
        at: new Date(row.at).toISOString(),
      };
    });
  }

  /** Everything the Project's screen shows — for a row `ProjectAccess` let through. */
  async #detail(row: VisibleProjectRow, language: string): Promise<ProjectDetail> {
    const em = this.deps.emFactory();
    const reader = actingAdminUserId();
    const [
      [summary],
      stages,
      moveRows,
      memberRows,
      roleRows,
      viewerRows,
      templateRows,
      lossRows,
      linkRows,
      unread,
      permissions,
      references,
      customFieldValues,
    ] = await Promise.all([
        this.#summaries([row]),
        this.#stages(row.id),
        em.execute(
          `select m."from_stage_id", m."to_stage_id" from "project_stage_moves" m where m."project_id" = ?`,
          [row.id],
        ) as Promise<Array<{ from_stage_id: string; to_stage_id: string }>>,
        em.execute(
          `select pm."id", pm."admin_user_id", pm."added_at" from "project_members" pm
            where pm."project_id" = ? order by pm."added_at", pm."id"`,
          [row.id],
        ) as Promise<Array<{ id: string; admin_user_id: string; added_at: Date }>>,
        em.execute(
          `select pmr."member_id", r."id", r."name", r."default_name", r."archived_at"
             from "project_member_roles" pmr
             join "project_members" pm on pm."id" = pmr."member_id"
             join "project_roles" r on r."id" = pmr."role_id"
            where pm."project_id" = ? order by r."position", r."id"`,
          [row.id],
        ) as Promise<
          Array<{ member_id: string; id: string; name: Record<string, string>; default_name: string; archived_at: Date | null }>
        >,
        em.execute(`select v."admin_user_id" from "project_viewers" v where v."project_id" = ?`, [row.id]) as Promise<
          Array<{ admin_user_id: string }>
        >,
        row.template_id
          ? (em.execute(`select t."id", t."name" from "project_templates" t where t."id" = ?`, [row.template_id]) as Promise<
              Array<{ id: string; name: string }>
            >)
          : Promise.resolve([]),
        row.loss_reason_id
          ? (em.execute(
              `select lr."id", lr."name", lr."default_name" from "project_loss_reasons" lr where lr."id" = ?`,
              [row.loss_reason_id],
            ) as Promise<Array<{ id: string; name: Record<string, string>; default_name: string }>>)
          : Promise.resolve([]),
        em.execute(`select count(*)::int as "n" from "project_links" l where l."project_id" = ?`, [row.id]) as Promise<
          Array<{ n: number }>
        >,
        this.#unreadMessages(row.id, reader),
        this.deps.access.callerPermissions(),
        this.deps.references.resolve(row.description),
        this.deps.customFields.project('project', row.custom_field_values ?? {}),
      ]);

    const personIds = [...new Set([...memberRows.map((m) => m.admin_user_id), ...viewerRows.map((v) => v.admin_user_id)])];
    const people = personIds.length > 0 ? await this.deps.adminUsers.findByIds(personIds) : [];
    const personById = new Map(people.map((person) => [person.id, person]));
    const nameOf = (id: string) => {
      const person = personById.get(id);
      return person ? personName(person) : '';
    };

    const graph = new StageGraph(
      stages,
      moveRows.map((m) => ({ fromStageId: m.from_stage_id, toStageId: m.to_stage_id })),
    );
    const positionOf = new Map(stages.map((stage) => [stage.id, stage.position]));
    const moves = moveRows
      .map((m) => ({ fromStageId: m.from_stage_id, toStageId: m.to_stage_id }))
      .sort(
        (a, b) =>
          (positionOf.get(a.fromStageId) ?? 0) - (positionOf.get(b.fromStageId) ?? 0) ||
          (positionOf.get(a.toStageId) ?? 0) - (positionOf.get(b.toStageId) ?? 0),
      );
    const loss = lossRows[0];

    return {
      ...summary!,
      description: row.description,
      references,
      startOn: row.start_on,
      visibility: row.visibility,
      viewers: viewerRows.map((v) => ({ id: v.admin_user_id, name: nameOf(v.admin_user_id) })),
      template: templateRows[0] ? { id: templateRows[0].id, name: templateRows[0].name } : null,
      lostStageId: row.lost_stage_id,
      lossReason: loss ? { id: loss.id, name: pickLocalized(loss.name, language) || loss.default_name } : null,
      lossComment: row.loss_comment,
      stages,
      moves,
      unreachableStageIds: graph.unreachable(),
      members: memberRows.map((member) => ({
        id: member.id,
        adminUser: {
          id: member.admin_user_id,
          name: nameOf(member.admin_user_id),
          active: isActive(personById.get(member.admin_user_id)),
        },
        roles: roleRows
          .filter((role) => role.member_id === member.id)
          .map((role) => ({
            id: role.id,
            name: pickLocalized(role.name, language) || role.default_name,
            archived: role.archived_at !== null,
          })),
        addedAt: new Date(member.added_at).toISOString(),
      })),
      linkCount: Number(linkRows[0]?.n ?? 0),
      unreadMessageCount: unread,
      customFieldValues: customFieldValues as ProjectDetail['customFieldValues'],
      version: row.version,
      configurationVersion: row.configuration_version,
      permissions,
    };
  }

  /**
   * Messages somebody else wrote since the reader's marker — or, with no
   * marker, since the module's read baseline (CRM's rule). Nobody is behind a
   * system read, so it has none.
   */
  async #unreadMessages(projectId: string, reader: string | null): Promise<number> {
    if (reader === null) return 0;
    const rows = (await this.deps.emFactory().execute(
      `select count(*)::int as "n" from "project_comments" c
        where c."project_id" = ? and c."kind" = 'message' and c."author_admin_user_id" <> ?
          and c."created_at" > coalesce(
            (select r."last_read_at" from "project_message_reads" r where r."project_id" = ? and r."admin_user_id" = ?),
            (select b."unread_since" from "project_message_read_baselines" b where b."id" = 1),
            '-infinity'::timestamptz)`,
      [projectId, reader, projectId, reader],
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** Summaries of rows `ProjectAccess` let through — their children read by those ids only. */
  async #summaries(rows: readonly VisibleProjectRow[]): Promise<ProjectSummary[]> {
    if (rows.length === 0) return [];
    const em = this.deps.emFactory();
    const ids = uuidArray(rows.map((row) => row.id));
    const timeZone = await this.timeZone();

    const [stages, organizationLinks, managers] = await Promise.all([
      em.execute(
        `select s."id", s."name", s."color", to_char(s."deadline_on", 'YYYY-MM-DD') as "deadline_on",
                (pr."state" = 'open' and s."deadline_on" is not null
                   and s."deadline_on" < (now() at time zone ?)::date) as "overdue"
           from "projects" pr join "project_stages" s on s."id" = pr."current_stage_id"
          where pr."id" = any(?::uuid[])`,
        [timeZone, ids],
      ) as Promise<CurrentStageRow[]>,
      em.execute(
        `select po."project_id", po."organization_id" from "project_organizations" po
          where po."project_id" = any(?::uuid[])`,
        [ids],
      ) as Promise<Array<{ project_id: string; organization_id: string }>>,
      em.execute(
        `select pm."project_id", pm."admin_user_id" from "project_members" pm
           join "project_member_roles" pmr on pmr."member_id" = pm."id"
           join "project_roles" r on r."id" = pmr."role_id"
          where pm."project_id" = any(?::uuid[]) and r."code" = ?
          order by pm."added_at", pm."id"`,
        [ids, PROJECT_MANAGER_ROLE],
      ) as Promise<Array<{ project_id: string; admin_user_id: string }>>,
    ]);

    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const organizationIds = [...new Set(organizationLinks.map((link) => link.organization_id))];
    const managerIds = [...new Set(managers.map((manager) => manager.admin_user_id))];
    const [organizations, people] = await Promise.all([
      organizationIds.length > 0 ? this.deps.organizations.findByIds(organizationIds) : Promise.resolve([]),
      managerIds.length > 0 ? this.deps.adminUsers.findByIds(managerIds) : Promise.resolve([]),
    ]);
    const organizationName = new Map(organizations.map((organization) => [organization.id, organization.name]));
    const personById = new Map(people.map((person) => [person.id, person]));

    return rows.map((row) => {
      const stage = row.current_stage_id ? stageById.get(row.current_stage_id) : undefined;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        state: row.state,
        currentStage: stage
          ? { id: stage.id, name: stage.name, color: stage.color, deadlineOn: stage.deadline_on, overdue: stage.overdue }
          : null,
        organizations: organizationLinks
          .filter((link) => link.project_id === row.id)
          .map((link) => ({ id: link.organization_id, name: organizationName.get(link.organization_id) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        value:
          row.value_amount !== null && row.value_currency !== null
            ? { amount: row.value_amount, currency: row.value_currency }
            : null,
        projectManagers: managers
          .filter((manager) => manager.project_id === row.id)
          .map((manager) => personById.get(manager.admin_user_id))
          .filter((person): person is NonNullable<typeof person> => person !== undefined)
          .map((person) => ({ id: person.id, name: personName(person) })),
        createdAt: new Date(row.created_at).toISOString(),
        closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      };
    });
  }
}
