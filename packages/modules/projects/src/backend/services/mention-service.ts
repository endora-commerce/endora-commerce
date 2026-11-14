import {
  ADMIN_PERMISSION_WILDCARD,
  foldDiacritics,
  mentionedAdminUserIds,
  type AdminUserReadPort,
  type AdminUserRecord,
  type PermissionReadPort,
  type ProjectMentionableOption,
} from '@endora-commerce/contracts';
import { actingAdminUserId, PROJECTS_READ_PERMISSION, type ProjectAccess } from './project-access.js';
import { projectNotificationText, type ProjectNotifier } from './project-notifier.js';

/** How many people the mention list offers for one search. */
export const MENTIONABLE_LIMIT = 20;

export interface ProjectMentionServiceDeps {
  access: Pick<ProjectAccess, 'loadVisible' | 'canSeeAs' | 'canSeeAsMany'>;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  permissions: PermissionReadPort;
  notifier: ProjectNotifier;
}

/** A save that may have mentioned somebody new, as the Command that made it reports it. */
export interface SavedProjectMentions {
  projectId: string;
  number: string;
  /** The people the saved text mentions who the text it replaced did not. */
  adminUserIds: readonly string[];
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(person: AdminUserRecord): boolean {
  return person.status === 'active' && person.deletedAt === null;
}

/**
 * The people `next` mentions and `previous` did not — who a save tells. Pure,
 * so the Command that saves a text works it out from the text it replaces
 * (CRM's `newlyMentioned`, copied — research R-17: a few lines, and the
 * platform surface is deliberately narrow).
 */
export function newlyMentioned(previous: string | null | undefined, next: string | null | undefined): string[] {
  const before = new Set(mentionedAdminUserIds(previous));
  return mentionedAdminUserIds(next).filter((id) => !before.has(id));
}

/**
 * People mentioned in a Project's texts (FR-026; research R-4).
 *
 * **Who may be mentioned** is somebody who may see the Project: an active
 * administrator holding `projects:read` who passes the visibility rule and the
 * Organization rule against their own reach (`ProjectAccess.canSeeAs`). On the
 * create form, before there is a Project, the holders of `projects:read`.
 *
 * **Who is told** is decided again when the text is saved, because the token is
 * text and can be typed by hand: the same question, and never the author. The
 * bell entry names the Project by number and the author by name, never the text.
 * Nothing here catches anything: a caller tells after its commit, under
 * `tellAfterCommit`.
 */
export class ProjectMentionService {
  constructor(private readonly deps: ProjectMentionServiceDeps) {}

  async mentionable(query: {
    projectId?: string | undefined;
    q?: string | undefined;
  }): Promise<ProjectMentionableOption[]> {
    // The Project first: one the caller may not see is 404 as one that does not exist.
    const project = query.projectId !== undefined ? await this.deps.access.loadVisible(query.projectId) : null;
    const needle = foldDiacritics(query.q ?? '')
      .trim()
      .toLowerCase();
    const candidates = (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter(isActive)
      .filter(
        (admin) =>
          needle === '' ||
          [personName(admin), admin.email].some((value) => foldDiacritics(value).toLowerCase().includes(needle)),
      )
      .map((admin) => ({ admin, name: personName(admin) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.admin.id.localeCompare(b.admin.id));

    const options: ProjectMentionableOption[] = [];
    if (project !== null) {
      // Issue #461 — who may see the Project, asked once for every candidate:
      // a fixed number of statements, however many administrators there are.
      const seeing =
        candidates.length > 0
          ? await this.deps.access.canSeeAsMany(
              candidates.map(({ admin }) => admin.id),
              project.id,
            )
          : new Set<string>();
      for (const { admin, name } of candidates) {
        if (options.length >= MENTIONABLE_LIMIT) break;
        if (seeing.has(admin.id)) options.push({ id: admin.id, name, email: admin.email });
      }
      return options;
    }
    const holds = this.#readPermission();
    // In name order, stopping at the limit: the permission is asked once per
    // role, of as many people as the list shows.
    for (const { admin, name } of candidates) {
      if (options.length >= MENTIONABLE_LIMIT) break;
      if (await holds(admin)) options.push({ id: admin.id, name, email: admin.email });
    }
    return options;
  }

  /**
   * Tell the newly mentioned who may see the Project, and answer who was
   * addressed — so a message does not tell a mentioned Member a second time.
   */
  async tell(saved: SavedProjectMentions): Promise<string[]> {
    const author = actingAdminUserId();
    const ids = [...new Set(saved.adminUserIds)].filter((id) => id !== author);
    if (ids.length === 0) return [];
    const [people, authors] = await Promise.all([
      this.deps.adminUsers.findByIds(ids),
      author === null ? Promise.resolve([]) : this.deps.adminUsers.findByIds([author]),
    ]);
    const authorName = authors[0] ? personName(authors[0]) : null;
    const addressed: string[] = [];
    for (const person of people.filter(isActive)) {
      if (!(await this.deps.access.canSeeAs(person.id, saved.projectId))) continue;
      await this.deps.notifier.notify({
        kind: 'projects.project.mention',
        targetAdminUserId: person.id,
        projectId: saved.projectId,
        ...projectNotificationText.mention(saved.number, authorName),
      });
      addressed.push(person.id);
    }
    return addressed;
  }

  /** Whether an administrator holds `projects:read`, asked once per role. */
  #readPermission(): (admin: AdminUserRecord) => Promise<boolean> {
    const byRole = new Map<string, Promise<boolean>>();
    return (admin) => {
      const key = admin.adminRoleId ?? `admin:${admin.id}`;
      let answer = byRole.get(key);
      if (!answer) {
        answer = this.deps.permissions
          .listPermissions(admin.id)
          .then((held) => held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(PROJECTS_READ_PERMISSION));
        byRole.set(key, answer);
      }
      return answer;
    };
  }
}
