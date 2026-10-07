import {
  foldDiacritics,
  mentionedAdminUserIds,
  type AdminUserReadPort,
  type AdminUserRecord,
  type OpportunityMentionLookupQuery,
  type OpportunityMentionOption,
  type PermissionReadPort,
} from '@endora-commerce/contracts';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import type { AdminReach } from './admin-reach.js';
import { crmNotificationText, type CrmNotifier } from './crm-notifier.js';
import { actingAdminUserId, isActiveAdministrator } from './opportunity-assignment-service.js';

/** The permission that makes somebody a person a text may mention: they can open what it is about. */
export const MENTIONABLE_PERMISSION = 'crm:read';

export interface MentionServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  permissions: PermissionReadPort;
  notifier: CrmNotifier;
  /** Whether another administrator may reach an Organization. */
  canReach: AdminReach;
}

/** A save that may have mentioned somebody new, as the Command that made it reports it. */
export interface SavedMentions {
  opportunityId: string;
  organizationId: string;
  number: string;
  /** The people the saved text mentions who the text it replaced did not. */
  adminUserIds: readonly string[];
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

/**
 * The people `next` mentions and `previous` did not — who a save tells
 * (`specs/143-crm-sales-opportunities/research.md` N-M4). Pure, so the Command
 * that saves a text works it out from the text it replaces, inside its own
 * transaction, and asks nobody.
 */
export function newlyMentioned(
  previous: string | null | undefined,
  next: string | null | undefined,
): string[] {
  const before = new Set(mentionedAdminUserIds(previous));
  return mentionedAdminUserIds(next).filter((id) => !before.has(id));
}

/**
 * People mentioned in an Opportunity's texts (User Story 18; research N-M1 …
 * N-M5): who may be mentioned, and who is told.
 *
 * **Who may be mentioned** is an active administrator holding `crm:read` — a
 * mention is a call to come and look, so it is offered only of somebody who
 * can. With an Organization named, the caller's own reach to it is the first
 * question and each candidate's the second, both put to the platform's own
 * answers; an Organization out of the caller's reach offers nobody.
 *
 * **Who is told** is decided again when the text is saved, because the token is
 * text and can be typed by hand: the same three conditions, and never the
 * author. The bell entry names the Opportunity by number and the author by
 * name — a bell is read outside the tenant scope, so never the text
 * (research N-R2).
 *
 * A permission is read through `admin_roles`' port, which answers per
 * administrator; an administrator holds exactly one role, so within one call
 * the answer for a role is asked once.
 *
 * Nothing here catches anything: a caller tells after its commit, under
 * `tellAfterCommit`.
 */
export class MentionService {
  constructor(private readonly deps: MentionServiceDeps) {}

  async mentionable(query: OpportunityMentionLookupQuery): Promise<OpportunityMentionOption[]> {
    const organizationId = query.organizationId;
    if (organizationId !== undefined && !isOrgInScope(organizationId)) return [];
    const needle = foldDiacritics(query.q ?? '').trim().toLowerCase();
    const candidates = (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter(isActiveAdministrator)
      .filter(
        (admin) =>
          needle === '' ||
          [personName(admin), admin.email].some((value) => foldDiacritics(value).toLowerCase().includes(needle)),
      )
      .map((admin) => ({ admin, name: personName(admin) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.admin.id.localeCompare(b.admin.id));

    const holds = this.#permissionCheck();
    const options: OpportunityMentionOption[] = [];
    // In name order, stopping at the limit: the two questions below are asked
    // of as many people as the list shows, not of every administrator.
    for (const { admin, name } of candidates) {
      if (options.length >= query.limit) break;
      if (!(await holds(admin))) continue;
      if (organizationId !== undefined && !(await this.deps.canReach(admin.id, organizationId))) continue;
      options.push({ id: admin.id, name });
    }
    return options;
  }

  /**
   * Tell the newly mentioned, and answer who was addressed — so a message does
   * not tell the same person a second time as a participant. One entry per
   * person, whatever the text.
   */
  async tell(saved: SavedMentions): Promise<string[]> {
    const author = actingAdminUserId();
    const ids = [...new Set(saved.adminUserIds)].filter((id) => id !== author);
    if (ids.length === 0) return [];

    const [people, authors] = await Promise.all([
      this.deps.adminUsers.findByIds(ids),
      author === null ? Promise.resolve([]) : this.deps.adminUsers.findByIds([author]),
    ]);
    const authorName = authors[0] ? personName(authors[0]) : null;
    const holds = this.#permissionCheck();
    const addressed: string[] = [];
    for (const person of people.filter(isActiveAdministrator)) {
      if (!(await holds(person))) continue;
      if (!(await this.deps.canReach(person.id, saved.organizationId))) continue;
      await this.deps.notifier.notify({
        kind: 'crm.opportunity.mention',
        targetAdminUserId: person.id,
        opportunityId: saved.opportunityId,
        ...crmNotificationText.mention(saved.number, authorName),
      });
      addressed.push(person.id);
    }
    return addressed;
  }

  /** Whether an administrator holds `crm:read`, asked once per role. */
  #permissionCheck(): (admin: AdminUserRecord) => Promise<boolean> {
    const byRole = new Map<string, Promise<boolean>>();
    return (admin) => {
      const key = admin.adminRoleId ?? `admin:${admin.id}`;
      let answer = byRole.get(key);
      if (!answer) {
        answer = this.deps.permissions
          .listPermissions(admin.id)
          .then((held) => held.includes('*') || held.includes(MENTIONABLE_PERMISSION));
        byRole.set(key, answer);
      }
      return answer;
    };
  }
}
