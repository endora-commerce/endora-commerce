import type { ProjectVisibility, ProjectVisibilitySetting } from '@endora-commerce/contracts';
import { isOrgInScope, type OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * Who sees a Project — the pure rules (`specs/163-projects-and-tasks/research.md`
 * R-2 and R-3). No I/O: `services/project-access.ts` gathers the facts and
 * states the same rules as one SQL predicate for lists and counts; these
 * functions are the statement a single Project is judged by, and the truth
 * table both are held to (`visibility-rule.test.ts`).
 *
 * **The Organization rule comes first and nothing widens it.** A Project of
 * several Organizations is visible only to an administrator who reaches every
 * one of them (owner ruling Q1 = C); a Project of none — an internal Project —
 * only to one unrestricted in reach. `projects:see_all`, membership and the
 * Project's own visibility act inside that, never around it (Constitution XI).
 */

/**
 * An administrator's Organization reach: unrestricted, or the platform's
 * constraint — a named set, or (a sales representative, issue #305) every
 * Organization nobody else governs. Read through {@link reaches} and the
 * platform's helpers, never through the constraint's ids.
 */
export interface OrgReach {
  readonly all: boolean;
  readonly constraint: OrgConstraint;
}

/** The reach a constraint gives. */
export function orgReachOf(constraint: OrgConstraint): OrgReach {
  return { all: constraint.kind === 'all', constraint };
}

/** Whether the reach includes one Organization. */
export function reaches(reach: OrgReach, organizationId: string): boolean {
  return reach.all || isOrgInScope(organizationId, reach.constraint);
}

/** Whoever is reading: an administrator, or the system (`adminUserId: null`, sees all, reaches all). */
export interface ProjectViewer {
  readonly adminUserId: string | null;
  /**
   * Holds `projects:read`. Every Projects route is gated by it, but a Project
   * is also read through other modules' surfaces — a Task's context, an audit
   * label, `projectReadPort` — whose own gate is somebody else's code, so the
   * rule asks it too: without it, no Project is visible (T144 F1).
   */
  readonly canRead: boolean;
  /** Holds `projects:see_all` (a wildcard holder does). */
  readonly seeAll: boolean;
  readonly reach: OrgReach;
}

/** What the rules need to know about one Project. */
export interface ProjectVisibilityFacts {
  readonly organizationIds: readonly string[];
  readonly visibility: ProjectVisibility;
  readonly memberIds: readonly string[];
  /** The people listed on the Project (`project_viewers`). */
  readonly viewerIds: readonly string[];
}

/**
 * R-2: unrestricted reach sees every Project; a restricted one sees a Project
 * that names at least one Organization and only Organizations in reach. An
 * empty set is not "every Organization in reach" — `every()` over it would
 * hand every internal Project to every representative (the price-book
 * precedent's review finding 4).
 */
export function projectOrgRule(reach: OrgReach, organizationIds: readonly string[]): boolean {
  if (reach.all) return true;
  return organizationIds.length > 0 && organizationIds.every((id) => reaches(reach, id));
}

/** R-3: a Project set to `inherit` follows the module setting (`members` meaning members and listed people). */
export function effectiveVisibility(
  visibility: ProjectVisibility,
  setting: ProjectVisibilitySetting,
): 'everyone' | 'members_and_listed' {
  if (visibility === 'inherit') return setting === 'everyone' ? 'everyone' : 'members_and_listed';
  return visibility;
}

/**
 * R-2 then R-3: in reach, and then a holder of `projects:see_all`, a Member, a
 * listed person, or anybody when the effective visibility is `everyone`.
 * Without `projects:read` nothing is visible, whatever surface asks.
 */
export function canSee(
  viewer: ProjectViewer,
  project: ProjectVisibilityFacts,
  setting: ProjectVisibilitySetting,
): boolean {
  if (!viewer.canRead) return false;
  if (!projectOrgRule(viewer.reach, project.organizationIds)) return false;
  if (viewer.seeAll) return true;
  if (viewer.adminUserId !== null) {
    if (project.memberIds.includes(viewer.adminUserId)) return true;
    if (project.viewerIds.includes(viewer.adminUserId)) return true;
  }
  return effectiveVisibility(project.visibility, setting) === 'everyone';
}
