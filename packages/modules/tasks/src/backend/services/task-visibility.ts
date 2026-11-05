import type { TaskContextDescriptor } from '@endora-commerce/contracts';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { isUuidShape } from '@endora-commerce/contracts';

/**
 * Which Tasks the caller may see (163 FR-031, research R-9; 165 research R-3)
 * — **the module's only read path**. `Task` is `@RuleScoped`: no ORM filter narrows it, so every
 * list, count and read by id of the `tasks` table asks this service first.
 *
 * - A Task without a context is visible to every holder of `tasks:read` (the
 *   route's gate decides that, not this service).
 * - A Task with a context is visible only when a **present** module registered
 *   its type and lists the id as visible to the caller. An unregistered type,
 *   or one whose owner is off, hides its Tasks (fail-closed).
 * - **And**, whatever its context (165 R-3): a **draft** is visible to its
 *   Creator only, even to a holder of `tasks:see_private`; a **private** Task
 *   to its Creator and to holders of `tasks:see_private`. One conjunct, the
 *   same in the list pre-filter and in a read by id:
 *   `created_by = :me or (not is_draft and (not is_private or :seePrivate))`.
 * - The **system** actor — a sweep, a subscriber, anything with no request
 *   behind it — is not narrowed. Every other caller is, including one with no
 *   tenant context at all: an absent actor is not the system.
 *
 * Lists and counts are narrowed by one SQL pre-filter built **before** the
 * query runs, from each present contributor's `allVisibleContextIds()`, so
 * pages and totals stay exact. A single Task asks its own contributor about
 * its one id instead.
 */

/** Every context id of one type the caller may see. */
export interface VisibleContexts {
  readonly contextType: string;
  readonly ids: readonly string[];
}

/** Who the caller is for the draft/private rule: their id, and whether they hold `tasks:see_private`. */
export interface TaskViewer {
  readonly adminUserId: string | null;
  readonly seePrivate: boolean;
}

export type TaskVisibilityScope =
  | { readonly unrestricted: true }
  | { readonly unrestricted: false; readonly contexts: readonly VisibleContexts[]; readonly viewer: TaskViewer };

/** What one Task's visibility depends on. */
export interface TaskVisibilityFacts {
  contextType: string | null;
  contextId: string | null;
  createdByAdminUserId: string;
  draft: boolean;
  private: boolean;
}

export interface SqlFragment {
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * The pre-filter over `tasks` aliased `alias`, or `null` for an unrestricted
 * caller. A type whose visible set is empty adds nothing — none of its Tasks
 * can match, which is what leaving it out says.
 *
 * Arrays travel as one Postgres array literal per parameter: `em.execute`
 * formats parameters into the statement on the client, where a JavaScript
 * array would become a comma-separated list rather than one value.
 */
export function taskVisibilitySql(scope: TaskVisibilityScope, alias: string): SqlFragment | null {
  if (scope.unrestricted) return null;
  const disjuncts = [`${alias}."context_type" is null`];
  const params: unknown[] = [];
  for (const { contextType, ids } of scope.contexts) {
    if (ids.length === 0) continue;
    disjuncts.push(`(${alias}."context_type" = ? and ${alias}."context_id" = any(?::uuid[]))`);
    params.push(contextType, uuidArray(ids));
  }
  const draftPrivate = draftPrivateSql(scope.viewer, alias);
  return { sql: `(${disjuncts.join(' or ')}) and ${draftPrivate.sql}`, params: [...params, ...draftPrivate.params] };
}

/** The draft/private conjunct of research R-3, over `tasks` aliased `alias`. */
function draftPrivateSql(viewer: TaskViewer, alias: string): SqlFragment {
  const published = viewer.seePrivate
    ? `not ${alias}."is_draft"`
    : `(not ${alias}."is_draft" and not ${alias}."is_private")`;
  if (viewer.adminUserId === null) return { sql: published, params: [] };
  if (!isUuidShape(viewer.adminUserId)) throw new Error(`tasks: "${viewer.adminUserId}" is not an administrator id.`);
  return { sql: `(${alias}."created_by_admin_user_id" = ?::uuid or ${published})`, params: [viewer.adminUserId] };
}

/** The draft/private rule for one Task, as the pre-filter states it. */
export function viewerMaySee(viewer: TaskViewer, task: Pick<TaskVisibilityFacts, 'createdByAdminUserId' | 'draft' | 'private'>): boolean {
  if (viewer.adminUserId !== null && task.createdByAdminUserId === viewer.adminUserId) return true;
  if (task.draft) return false;
  return !task.private || viewer.seePrivate;
}

/** A Postgres `uuid[]` literal. The ids come from contributors, so each is checked before it is quoted. */
export function uuidArray(ids: readonly string[]): string {
  for (const id of ids) {
    if (!isUuidShape(id)) throw new Error(`tasks: "${id}" is not a uuid a context may be identified by.`);
  }
  return `{${ids.map((id) => `"${id}"`).join(',')}}`;
}

/** Whether the ambient caller is the system — the one caller visibility does not narrow. */
export function isSystemActor(): boolean {
  return getTenantContext()?.actor.kind === 'system';
}

export interface TaskVisibilityDeps {
  /** The contributors whose owner is effectively present (the registry's enumeration). */
  contributors: () => readonly TaskContextDescriptor[];
  /** Read per call: the same service answers a request and a sweep. */
  isSystemActor: () => boolean;
  /** The caller's id and whether they hold `tasks:see_private` — asked per call, never for the system. */
  viewer: () => Promise<TaskViewer>;
}

export class TaskVisibility {
  constructor(private readonly deps: TaskVisibilityDeps) {}

  /** What the caller may see, asked of every present contributor under the caller's context. */
  async scope(): Promise<TaskVisibilityScope> {
    if (this.deps.isSystemActor()) return { unrestricted: true };
    const contexts: VisibleContexts[] = [];
    for (const descriptor of this.deps.contributors()) {
      contexts.push({ contextType: descriptor.contextType, ids: await descriptor.allVisibleContextIds() });
    }
    return { unrestricted: false, contexts, viewer: await this.deps.viewer() };
  }

  /** The caller as the draft/private rule sees them; `null` for the system, whom it does not narrow. */
  async viewer(): Promise<TaskViewer | null> {
    return this.deps.isSystemActor() ? null : this.deps.viewer();
  }

  /** The pre-filter for a list or a count over `tasks` aliased `alias`; `null` for the system. */
  async condition(alias: string): Promise<SqlFragment | null> {
    return taskVisibilitySql(await this.scope(), alias);
  }

  /**
   * Whether the caller may see one Task — the draft/private rule first, then
   * its own contributor is asked about its one id.
   */
  async canSee(task: TaskVisibilityFacts): Promise<boolean> {
    if (this.deps.isSystemActor()) return true;
    if (!viewerMaySee(await this.deps.viewer(), task)) return false;
    return this.canSeeContext(task);
  }

  /**
   * Whether the caller may see a context alone — the history's question about
   * a context a Task was once in, not about a Task.
   */
  async canSeeContext(task: { contextType: string | null; contextId: string | null }): Promise<boolean> {
    if (this.deps.isSystemActor()) return true;
    if (task.contextType === null || task.contextId === null) return true;
    const descriptor = this.deps.contributors().find((d) => d.contextType === task.contextType);
    if (!descriptor) return false;
    return (await descriptor.visibleContextIds([task.contextId])).has(task.contextId);
  }
}
