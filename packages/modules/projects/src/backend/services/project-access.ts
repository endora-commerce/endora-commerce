import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ADMIN_PERMISSION_WILDCARD,
  ERROR_CODES,
  projectVisibilitySettingSchema,
  type AdminTenantScopePort,
  type AdminUserReadPort,
  type PermissionReadPort,
  type ProjectState,
  type ProjectVisibility,
  type ProjectVisibilitySetting,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import {
  getTenantContext,
  orgInScope,
  orgConstraintFor,
  orgConstraintForAdminScope,
  orgScopeSql,
} from '@endora-commerce/platform/tenancy';
import { orgReachOf, type OrgReach, type ProjectViewer } from '../domain/visibility-rule.js';

/**
 * `ProjectAccess` — **the module's only read path to a Project**
 * (`specs/163-projects-and-tasks/research.md` R-2, R-3).
 *
 * Every Project-owned entity is `@RuleScoped`, and that classification has
 * **no ORM filter behind it**: the platform's global filters scope `org` and
 * `customer` entities and walk `transitive` chains, while a rule-scoped
 * entity's rule lives in its owning service. The rule here is the module's
 * own — a Project of several Organizations is visible only with **every** one
 * in reach (owner ruling Q1 = C), and inside that the visibility rule of R-3 —
 * and the platform's published `ruleInScope` states the opposite
 * semantics (any-of, no Organization visible to all). So this file states the
 * rule once, as one SQL predicate over `projects p`, and every list, count,
 * search, panel and port of the module either composes that predicate or
 * starts from a Project this file returned. `project-access-seam.test.ts`
 * refuses a read of a rule-scoped table anywhere else, except in the files
 * {@link PROJECT_ACCESS_READERS} names with their reason.
 *
 * Out of reach, invisible and non-existent answer alike: 404
 * `PROJECT_NOT_FOUND` by id, absence from lists and totals (Constitution XI).
 * `orgConstraintFor()` is asked on every path, so a request without a tenant
 * context throws instead of seeing everything (fail-closed). The system — a
 * worker, a subscriber — is not narrowed.
 *
 * The pure statement of both rules, and their truth table, is
 * `domain/visibility-rule.ts`; this file is their SQL twin.
 */

/**
 * Files besides this one that read rule-scoped Project tables, each with why
 * that is safe. A file belongs here only when **every** such read either
 * composes {@link ProjectAccess.visibleProjectSql} or is keyed by Project ids
 * this file handed out. Paths are relative to `src/backend/`.
 */
export const PROJECT_ACCESS_READERS: Readonly<Record<string, string>> = {
  'services/project-read-service.ts':
    'The list, its total and the global-search provider’s query compose `visibleProjectSql`; the ' +
    'detail and the Stage history start from ' +
    '`loadVisible`; Stages, moves, Organizations, Members and links are read only for the ids of ' +
    'Projects those returned, or of a Project the caller has just written.',
  'services/project-service.ts':
    'Every write starts from `loadVisible`; inside its Command the Project is locked (and asked again whether the caller sees it) and its ' +
    'Organizations, Members and links are read by that id only.',
  'services/stage-service.ts':
    'Every write starts from `loadVisible`; inside its Command the Project is locked (and asked again whether the caller sees it) and its ' +
    'Stages and moves are read by that id only.',
  'services/move-service.ts':
    'A move, close or reopen starts from `loadVisible`; inside its Command the Project is locked (and asked again whether the caller sees it) ' +
    'and its Stages and moves are read by that id only.',
  'services/stage-task-service.ts':
    'Every route starts from `loadVisible`; the materialisation after a move and its failure record ' +
    'are handed the id of the Project the move loaded that way. Stages, Stage Task definitions, ' +
    'Members and Stage entries are read by that id only.',
  'services/role-service.ts':
    'Deleting a Project Role asks whether any Member, Stage or Stage Task holds it: one `exists` ' +
    'across every Project, answered as a yes or no to a `projects:configure` holder, who learns ' +
    'no Project, id or count from it.',
  'services/loss-reason-service.ts':
    'Deleting a loss reason asks whether any Project was lost for it: one `exists` across every ' +
    'Project, answered as a yes or no to a `projects:configure` holder, who learns no Project, id ' +
    'or count from it.',
  'services/link-service.ts':
    'Every read and write starts from `loadVisible`; links and Organizations are read by that ' +
    'Project’s id. The holder of an already-linked record is looked up by record to name it, and is ' +
    'named only through `findVisible`; otherwise it answers nothing but "linked elsewhere".',
  'services/record-project-service.ts':
    'Looks up the Project id a record is linked to — an id and nothing else — and answers only ' +
    'what `findVisible` returns for it; no visible Project is the same 404 as no link, and the ' +
    'same `null` to `projectReadPort.findByRecord`.',
  'services/comment-service.ts':
    'Every read and write starts from `loadVisible`; comments, Members and read markers are read by ' +
    'that Project’s id only, and every person told is asked `canSeeAs` first.',
  'services/attachment-service.ts':
    'Every read and write starts from `loadVisible`; attachments are read by that Project’s id. Which ' +
    'Projects hold a file is read by asset only to ask `visibleIds` of them, and answers nothing but ' +
    '"not there" for a file held out of sight.',
  'services/project-asset-references.ts':
    'The asset library’s deletion guard: one batched, platform-wide "does a Project use this file" ' +
    'answered to whoever deletes it, labelled by the Project’s number only — referential integrity, ' +
    'which must hold for a deleter who may not see the Project and while this module is off. Its reader ' +
    'restriction (`specs/166-asset-reference-visibility/` FR-002) adds the attached files of the Projects the ' +
    'caller may **not** see — the NULL-safe complement of `visibleProjectSql`, `(…) is not true` — and every ' +
    'attached file, read while Projects is off; which Projects the caller sees is `visibleIds`.',
  'services/history-service.ts':
    'A history page starts from `loadVisible`; the values its entries changed are read from ' +
    '`project_value_changes` by that Project’s id and the row ids its audit entries point at — a ' +
    'pointer to another Project’s row reads nothing.',
  'services/project-audit-references.ts':
    'Labels the audit rows of only the Projects `visibleIds` hands back for the reader, by those ids.',
  'services/stage-alert-service.ts':
    'The deadline-alert sweep, run in the system scope its worker enters: it claims the alerts due ' +
    'today across every Project and reads the Members of a claimed Project by that id only. Nobody ' +
    'is told anything until `canSeeAs` has answered for them, and the probe answers one bit.',
  'services/analytics-service.ts':
    'Every figure is one grouped statement over `projects p` carrying `visibleProjectSql` for the ' +
    'reader; Stage entries, Members and Organizations are read only joined to, or keyed by, the ' +
    'Projects that statement selects, and a reader who reaches no Organization runs none. The most ' +
    'valuable open Projects are summarised from the rows that statement returned.',
  'services/task-context-descriptor.ts':
    'The `project` Task context answers `allVisibleIds` / `visibleIds` and describes only the ids ' +
    '`visibleIds` handed back; Projects and their Stages are read by those ids only.' +
    ' Which Projects and Stages still exist (`existingContexts`) is `existingWithStages`, in this file.',
};

/** The permission that lifts the visibility rule — never the Organization rule (R-3). */
export const PROJECTS_SEE_ALL_PERMISSION = 'projects:see_all';
/** The permission that gates every read route of the module. */
export const PROJECTS_READ_PERMISSION = 'projects:read';
/** Creating, editing, walking, closing and deleting Projects. */
export const PROJECTS_WRITE_PERMISSION = 'projects:write';
/** Roles, loss reasons, Templates and the module's settings (a later story declares it). */
export const PROJECTS_CONFIGURE_PERMISSION = 'projects:configure';

export const PROJECTS_VISIBILITY_SETTING = 'projects.visibility';

export function isUuid(value: string): boolean {
  return isUuidShape(value);
}

/** A Postgres array literal of uuids, for `?::uuid[]`. Only uuids reach it. */
export function uuidArray(ids: Iterable<string>): string {
  return `{${[...ids].filter(isUuid).join(',')}}`;
}

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** One `projects` row as the access path selects it. */
export interface VisibleProjectRow {
  id: string;
  number: string;
  title: string;
  description: string;
  state: ProjectState;
  current_stage_id: string | null;
  /** `numeric(18,2)` as Postgres prints it. */
  value_amount: string | null;
  value_currency: string | null;
  /** `YYYY-MM-DD`. */
  start_on: string;
  visibility: ProjectVisibility;
  template_id: string | null;
  lost_stage_id: string | null;
  loss_reason_id: string | null;
  loss_comment: string | null;
  custom_field_values: Record<string, unknown>;
  version: number;
  closed_at: Date | null;
  created_at: Date;
  /** `created_at` at full precision — a keyset cursor's key. */
  cursor_at: string;
}

/** The columns {@link VisibleProjectRow} reads, over the alias `p`. */
export const VISIBLE_PROJECT_COLUMNS = `p."id", p."number", p."title", p."description", p."state",
  p."current_stage_id", p."value_amount"::text as "value_amount", p."value_currency",
  to_char(p."start_on", 'YYYY-MM-DD') as "start_on", p."visibility", p."template_id",
  p."lost_stage_id", p."loss_reason_id", p."loss_comment", p."custom_field_values", p."version",
  p."closed_at", p."created_at", p."created_at"::text as "cursor_at"`;

export function projectNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.PROJECT_NOT_FOUND, 'Project not found.');
}

/**
 * Both rules as one predicate over a Project aliased `p`, for `viewer` under
 * the module setting; `null` when nothing narrows (the system, or an
 * unrestricted holder of `projects:see_all`). Pure: the caller gathers the
 * viewer and the setting.
 */
export function visibleProjectSqlFor(viewer: ProjectViewer, setting: ProjectVisibilitySetting): SqlFragment | null {
  // Not a reader of Projects at all: whatever surface asks, nothing is visible.
  if (!viewer.canRead) return { sql: 'false', params: [] };
  const sql: string[] = [];
  const params: unknown[] = [];
  if (!viewer.reach.all) {
    // R-2: at least one Organization, and none out of reach. An empty reach
    // sees no Project at all.
    sql.push(`exists (select 1 from "project_organizations" po_any where po_any."project_id" = p."id")`);
    // `coalesce`: a predicate that is `NULL` for a row counts as out of reach.
    const reach = orgScopeSql('po_out."organization_id"', viewer.reach.constraint);
    sql.push(
      `not exists (select 1 from "project_organizations" po_out
                    where po_out."project_id" = p."id" and not coalesce(${reach.sql}, false))`,
    );
    params.push(...reach.params);
  }
  if (!viewer.seeAll) {
    // R-3: open to everyone by the effective visibility, or a Member, or listed.
    const open =
      setting === 'everyone' ? `p."visibility" in ('inherit', 'everyone')` : `p."visibility" = 'everyone'`;
    const alternatives = [open];
    if (viewer.adminUserId !== null) {
      alternatives.push(
        `exists (select 1 from "project_members" pm_me where pm_me."project_id" = p."id" and pm_me."admin_user_id" = ?)`,
        `exists (select 1 from "project_viewers" pv_me where pv_me."project_id" = p."id" and pv_me."admin_user_id" = ?)`,
      );
      params.push(viewer.adminUserId, viewer.adminUserId);
    }
    sql.push(`(${alternatives.join(' or ')})`);
  }
  return sql.length === 0 ? null : { sql: `(${sql.join(' and ')})`, params };
}

/** The reach the ambient tenant context gives the caller — throws without one (fail-closed). */
export function ambientReach(): Promise<OrgReach> {
  return orgReachOf(orgConstraintFor());
}

/** The administrator behind the current request, or `null` for anybody else. */
export function actingAdminUserId(): string | null {
  const actor = getTenantContext()?.actor;
  return actor?.kind === 'admin' && actor.id ? actor.id : null;
}

/**
 * Whether the ambient caller is the system — a worker, a subscriber — the one
 * caller the rules do not narrow. A customer, an api key or anything else
 * without an administrator behind it is **not** the system: it sees no Project
 * (fail-closed; `tasks`' `isSystemActor` is the same test, T144 F6).
 */
export function isSystemActor(): boolean {
  return getTenantContext()?.actor.kind === 'system';
}

function holds(held: readonly string[], code: string): boolean {
  return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(code);
}

export interface ProjectAccessDeps {
  emFactory: () => EntityManager;
  /**
   * `admin_roles`' `permissionService` — lazy, resolved per call. Its published
   * read port, plus the capability check `hasPermission`, which the container
   * entry carries beside it (the `organizations:rollup` precedent).
   */
  permissions: PermissionReadPort & { hasPermission(adminUserId: string, permission: string): Promise<boolean> };
  /** `organizations`' reach of an administrator other than the caller — lazy. */
  tenantScopes: AdminTenantScopePort;
  /** `admin_users`' read port — lazy. */
  adminUsers: AdminUserReadPort;
  settings: SettingsReadPort;
}

export class ProjectAccess {
  constructor(private readonly deps: ProjectAccessDeps) {}

  /**
   * Who is reading, from the ambient tenant context: the administrator, whether
   * they hold `projects:read` and `projects:see_all`, and their Organization
   * reach. The system actor is unrestricted — but the reach is still asked of
   * the context, so a missing context throws; any other caller without an
   * administrator behind it reads nothing.
   *
   * `projects:read` is asked here and not only on the routes: a Task's context,
   * an audit label and `projectReadPort` reach this file behind another
   * module's gate (`tasks:read`, `audit_logs:read`, …), and a Project is not
   * theirs to show to somebody who may not read Projects (T144 F1).
   */
  async currentViewer(): Promise<ProjectViewer> {
    const reach = await ambientReach();
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) {
      return isSystemActor()
        ? { adminUserId: null, canRead: true, seeAll: true, reach }
        : { adminUserId: null, canRead: false, seeAll: false, reach };
    }
    // The capability check of `projects:see_all` — no route asks for the code,
    // this is where it is enforced (a wildcard holder holds it).
    const [canRead, seeAll] = await Promise.all([
      this.deps.permissions.hasPermission(adminUserId, PROJECTS_READ_PERMISSION),
      this.deps.permissions.hasPermission(adminUserId, PROJECTS_SEE_ALL_PERMISSION),
    ]);
    return { adminUserId, canRead, seeAll, reach };
  }

  /** The module setting `projects.visibility` (default `members`). */
  async visibilitySetting(): Promise<ProjectVisibilitySetting> {
    return this.deps.settings.get(PROJECTS_VISIBILITY_SETTING, null, projectVisibilitySettingSchema);
  }

  /**
   * The predicate every list, count, search and analytics query of the module
   * carries, over `projects p`, for the caller — or for `viewer` when given.
   * `null` when nothing narrows.
   */
  async visibleProjectSql(viewer?: ProjectViewer): Promise<SqlFragment | null> {
    const resolved = viewer ?? (await this.currentViewer());
    return visibleProjectSqlFor(resolved, await this.visibilitySetting());
  }

  /** One Project the caller may see, or `null` — out of reach, invisible and missing alike. */
  async findVisible(id: string): Promise<VisibleProjectRow | null> {
    if (!isUuid(id)) return null;
    const viewer = await this.currentViewer();
    if (!viewer.canRead) return null;
    const visible = await this.visibleProjectSql(viewer);
    const rows = (await this.deps.emFactory().execute(
      `select ${VISIBLE_PROJECT_COLUMNS} from "projects" p
        where p."id" = ?${visible ? ` and ${visible.sql}` : ''}`,
      [id, ...(visible?.params ?? [])],
    )) as VisibleProjectRow[];
    return rows[0] ?? null;
  }

  /**
   * The Projects of `ids` the caller may see, in no particular order — a hidden,
   * missing or malformed id is simply absent (`projectReadPort.findByIds`,
   * `specs/165-task-management/` research R-5).
   */
  async findVisibleMany(ids: readonly string[]): Promise<VisibleProjectRow[]> {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return [];
    const viewer = await this.currentViewer();
    if (!viewer.canRead) return [];
    const visible = await this.visibleProjectSql(viewer);
    return (await this.deps.emFactory().execute(
      `select ${VISIBLE_PROJECT_COLUMNS} from "projects" p
        where p."id" = any(?::uuid[])${visible ? ` and ${visible.sql}` : ''}`,
      [uuidArray(candidates), ...(visible?.params ?? [])],
    )) as VisibleProjectRow[];
  }

  /**
   * Projects the caller may see whose number or title contains `q`
   * (case-insensitively; every visible one for an empty `q`), newest first, at
   * most `limit` — `projectReadPort.search`, the `@@` document list's Projects
   * (`specs/165-task-management/` research R-5).
   */
  async searchVisible(q: string, limit: number): Promise<VisibleProjectRow[]> {
    const viewer = await this.currentViewer();
    if (!viewer.canRead || limit <= 0) return [];
    const visible = await this.visibleProjectSql(viewer);
    const where: string[] = [];
    const params: unknown[] = [];
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const needle = q.trim();
    if (needle !== '') {
      const like = `%${needle.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      where.push(`(p."number" ilike ? or p."title" ilike ?)`);
      params.push(like, like);
    }
    return (await this.deps.emFactory().execute(
      `select ${VISIBLE_PROJECT_COLUMNS} from "projects" p
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        order by p."created_at" desc, p."id" desc
        limit ?`,
      [...params, Math.trunc(limit)],
    )) as VisibleProjectRow[];
  }

  /**
   * The **only** way a route or a service obtains a Project: 404
   * `PROJECT_NOT_FOUND` for a Project out of reach, invisible or missing. A
   * child read (Stages, comments, Members, links, attachments) loads its
   * Project here first.
   */
  async loadVisible(id: string): Promise<VisibleProjectRow> {
    const row = await this.findVisible(id);
    if (!row) throw projectNotFound();
    return row;
  }

  /**
   * Inside a write's Command, after the Project's row is locked: whether the
   * caller may still see it, asked on the Command's own `em` (T144 F3). 404
   * `PROJECT_NOT_FOUND`, as {@link loadVisible} answers, when not. `reach`
   * asks the Organization rule alone (see `lockProject`).
   */
  async assertVisibleUnderLock(em: EntityManager, id: string, rule: 'visible' | 'reach'): Promise<void> {
    const viewer = await this.currentViewer();
    const predicate = visibleProjectSqlFor(
      rule === 'reach' ? { ...viewer, seeAll: true } : viewer,
      await this.visibilitySetting(),
    );
    if (predicate === null) return;
    const rows = (await em.execute(
      `select 1 as "one" from "projects" p where p."id" = ? and ${predicate.sql}`,
      [id, ...predicate.params],
    )) as unknown[];
    if (rows.length === 0) throw projectNotFound();
  }

  /**
   * Whether a Project **the caller has just written** is in their Organization
   * reach — the Organization rule alone, never the visibility rule.
   */
  async inReachAfterWrite(id: string): Promise<boolean> {
    const reach = await this.#reachSql();
    if (reach === null) return true;
    const rows = (await this.deps.emFactory().execute(
      `select 1 as "one" from "projects" p where p."id" = ? and ${reach.sql}`,
      [id, ...reach.params],
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * The row of a Project **the caller has just written** — read by id under
   * the Organization rule, without the visibility rule. Only a write that began
   * with {@link loadVisible} calls it, to answer with the Project it changed:
   * that write may have taken the Project out of the caller's own sight
   * (removing themselves as a Member under *members only*), and answering 404
   * for a change that committed would misreport it. Never a first read.
   *
   * The Organization rule still applies (T144 F3): an Organization out of the
   * caller's reach, added by somebody else since the write, is not theirs to be
   * shown — 404 as for a missing Project. A Project the caller's own
   * `PUT /organizations` made internal is answered by `setOrganizations`
   * before this is asked.
   */
  async rowAfterWrite(id: string): Promise<VisibleProjectRow> {
    const reach = await this.#reachSql();
    const rows = (await this.deps.emFactory().execute(
      `select ${VISIBLE_PROJECT_COLUMNS} from "projects" p where p."id" = ?${reach ? ` and ${reach.sql}` : ''}`,
      [id, ...(reach?.params ?? [])],
    )) as VisibleProjectRow[];
    if (!rows[0]) throw projectNotFound();
    return rows[0];
  }

  /** The Organization rule alone for the caller, or `null` when it narrows nothing. */
  async #reachSql(): Promise<SqlFragment | null> {
    const viewer = await this.currentViewer();
    return visibleProjectSqlFor({ ...viewer, seeAll: true }, await this.visibilitySetting());
  }

  /** What the caller may do to a Project they see — the detail's `permissions`. */
  async callerPermissions(): Promise<{ canWrite: boolean; canConfigure: boolean }> {
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) return { canWrite: false, canConfigure: false };
    const held = await this.deps.permissions.listPermissions(adminUserId);
    return {
      canWrite: holds(held, PROJECTS_WRITE_PERMISSION),
      canConfigure: holds(held, PROJECTS_CONFIGURE_PERMISSION),
    };
  }

  /** Whether the caller holds `code` (wildcards included) — `false` for the system. */
  async callerHolds(code: string): Promise<boolean> {
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) return false;
    return holds(await this.deps.permissions.listPermissions(adminUserId), code);
  }

  /** Which of `ids` the caller may see. */
  async visibleIds(ids: readonly string[]): Promise<Set<string>> {
    const candidates = ids.filter(isUuid);
    if (candidates.length === 0) return new Set();
    const viewer = await this.currentViewer();
    if (!viewer.canRead) return new Set();
    const visible = await this.visibleProjectSql(viewer);
    const rows = (await this.deps.emFactory().execute(
      `select p."id" from "projects" p
        where p."id" = any(?::uuid[])${visible ? ` and ${visible.sql}` : ''}`,
      [uuidArray(candidates), ...(visible?.params ?? [])],
    )) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Which of `ids` are Projects that exist, each with the ids of its Stages —
   * **regardless of who may see them** (`specs/165-task-management/` R-19,
   * issue #450). The Tasks module's maintenance pass asks it, through the
   * `project` Task context, to tell a Project deleted while Tasks was off from
   * one merely hidden. Answered only to the **system** — the pass runs in the
   * system scope its worker enters — and refused to anybody else, for whom it
   * would be an existence oracle past both rules. One statement, keyed by the
   * ids asked; an id that is not a uuid is answered as existing, with no
   * Stages taken from it: absence here deletes Tasks, so only an id this
   * module can rule on is ever said to be gone.
   */
  async existingWithStages(ids: readonly string[]): Promise<Map<string, ReadonlySet<string>>> {
    if (!isSystemActor()) {
      throw new Error('projects: which Projects exist, whoever may see them, is answered to the system only.');
    }
    const out = new Map<string, Set<string>>();
    const candidates = ids.filter(isUuid);
    if (candidates.length > 0) {
      const rows = (await this.deps.emFactory().execute(
        `select p."id", s."id" as "stage_id" from "projects" p
           left join "project_stages" s on s."project_id" = p."id"
          where p."id" = any(?::uuid[])`,
        [uuidArray(candidates)],
      )) as Array<{ id: string; stage_id: string | null }>;
      for (const row of rows) {
        const stages = out.get(row.id) ?? new Set<string>();
        if (row.stage_id !== null) stages.add(row.stage_id);
        out.set(row.id, stages);
      }
    }
    for (const id of ids) if (!isUuid(id) && !out.has(id)) out.set(id, new Set());
    return out;
  }

  /** Every Project id the caller may see — the Task context's pre-filter (research R-9). */
  async allVisibleIds(): Promise<string[]> {
    const viewer = await this.currentViewer();
    if (!viewer.canRead) return [];
    const visible = await this.visibleProjectSql(viewer);
    const rows = (await this.deps.emFactory().execute(
      `select p."id" from "projects" p${visible ? ` where ${visible.sql}` : ''}`,
      visible?.params ?? [],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Whether **another** administrator may see a Project — for a notification
   * or an alert about it (research R-4). Active, holding `projects:read`, and
   * passing both rules against **their own** reach, which `organizations`
   * establishes the way the request-scope hook does for a caller. An
   * administrator whose reach cannot be established reaches nothing.
   */
  async canSeeAs(adminUserId: string, projectId: string): Promise<boolean> {
    if (!isUuid(adminUserId) || !isUuid(projectId)) return false;
    const admin = await this.deps.adminUsers.findById(adminUserId);
    if (!admin || admin.status !== 'active' || admin.deletedAt !== null) return false;
    const held = await this.deps.permissions.listPermissions(adminUserId);
    if (!holds(held, PROJECTS_READ_PERMISSION)) return false;
    const scope = await this.deps.tenantScopes.resolveForAdmin(adminUserId);
    const reach: OrgReach = await orgReachOf(orgConstraintForAdminScope(scope));
    const visible = visibleProjectSqlFor(
      { adminUserId, canRead: true, seeAll: holds(held, PROJECTS_SEE_ALL_PERMISSION), reach },
      await this.visibilitySetting(),
    );
    const rows = (await this.deps.emFactory().execute(
      `select 1 as "one" from "projects" p where p."id" = ?${visible ? ` and ${visible.sql}` : ''}`,
      [projectId, ...(visible?.params ?? [])],
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * The Organizations of a Project **this file handed out** — by
   * {@link loadVisible} or {@link findVisible} — for a lookup keyed by them
   * (the `@@` list's Orders and Quote Requests). Never a first read.
   */
  async organizationIdsOf(projectId: string): Promise<string[]> {
    const rows = (await this.deps.emFactory().execute(
      `select po."organization_id" from "project_organizations" po where po."project_id" = ? order by po."organization_id"`,
      [projectId],
    )) as Array<{ organization_id: string }>;
    return rows.map((row) => row.organization_id);
  }

  /** Whether the caller may name this Organization on a Project they write (FR-004). */
  orgInScope(organizationId: string): Promise<boolean> {
    return orgInScope(organizationId);
  }
}
