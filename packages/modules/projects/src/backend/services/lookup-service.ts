import {
  foldDiacritics,
  type AdminUserReadPort,
  type OrganizationDetailsPort,
  type ProjectAdminUserLookupQuery,
  type ProjectAdminUserOption,
  type ProjectOrganizationLookupQuery,
  type ProjectOrganizationOption,
} from '@endora-commerce/contracts';
import { isOrgInScope, orgConstraintFor } from '@endora-commerce/platform/tenancy';

export interface ProjectLookupServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
}

/** Case- and diacritic-insensitive "contains", as a person types a name. */
function matches(query: string | undefined, ...haystack: string[]): boolean {
  const needle = foldDiacritics(query ?? '').trim().toLowerCase();
  if (needle === '') return true;
  return haystack.some((value) => foldDiacritics(value).toLowerCase().includes(needle));
}

function personName(person: { firstName: string; lastName: string; email: string }): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

/**
 * What the Projects screens' pickers choose from — the Organizations of a
 * Project, its Members and listed people, and the list's member filter
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.1a; the CRM
 * precedent `crm-lookup-service.ts`).
 *
 * **Why Projects answers these itself.** The admin kit's pickers read the
 * owners' lists, `/organizations` and `/admin-users`, each behind its owner's
 * code — which somebody running Projects has no reason to hold. Each read here
 * goes through the owner's **published read port**, as the Project screens
 * already do to name an Organization or a Member, and answers the minimum a
 * picker shows. Nobody's gate is widened: the owners' endpoints answer as
 * before.
 *
 * **Tenant scope is applied here, by name.** An Organization is the tenant, not
 * a tenant-scoped row, so its port answers whoever asks; the caller's reach is
 * `orgConstraintFor()` / `isOrgInScope()`, and an Organization out of reach is
 * neither listed nor labelled — exactly what `POST /projects` would refuse.
 */
export class ProjectLookupService {
  constructor(private readonly deps: ProjectLookupServiceDeps) {}

  async organizations(query: ProjectOrganizationLookupQuery): Promise<ProjectOrganizationOption[]> {
    const option = (row: { id: string; name: string }): ProjectOrganizationOption => ({ id: row.id, name: row.name });
    if (query.id !== undefined) {
      if (!isOrgInScope(query.id)) return [];
      const found = await this.deps.organizations.findById(query.id);
      return found ? [option(found)] : [];
    }
    const constraint = orgConstraintFor();
    if (constraint.kind === 'all') {
      return (await this.deps.organizations.searchByName(query.q ?? '', query.limit)).map(option);
    }
    if (constraint.kind === 'excluded') {
      // A sales representative (issue #305) reaches every Organization nobody
      // else governs, so the population is the platform's and the search pages
      // through it — widening the window until a page holds `limit` in reach
      // or the matches run out. The excluded set is bounded by the B2B book,
      // so the window grows rarely and never far.
      for (let window = query.limit * 2; ; window *= 2) {
        const page = await this.deps.organizations.searchByName(query.q ?? '', window);
        const inReach = page.filter((row) => isOrgInScope(row.id, constraint));
        if (inReach.length >= query.limit || page.length < window) return inReach.slice(0, query.limit).map(option);
      }
    }
    // A confined administrator: the allowed set is the population and the
    // search narrows it — never a platform-wide page filtered afterwards, which
    // could hold none of the caller's Organizations.
    const allowed =
      constraint.kind === 'allowed'
        ? [...constraint.organizationIds]
        : constraint.organizationId
          ? [constraint.organizationId]
          : [];
    if (allowed.length === 0) return [];
    return (await this.deps.organizations.findByIds(allowed))
      .filter((row) => matches(query.q, row.name))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, query.limit)
      .map(option);
  }

  /**
   * Active administrators — who may be made a Member or listed (the rule the
   * writes hold) — by name or e-mail. By `id`, the one administrator whatever
   * their status: that is the label of somebody already chosen, a deactivated
   * Member included.
   */
  async adminUsers(query: ProjectAdminUserLookupQuery): Promise<ProjectAdminUserOption[]> {
    const option = (admin: { id: string; firstName: string; lastName: string; email: string }): ProjectAdminUserOption => ({
      id: admin.id,
      name: personName(admin),
      email: admin.email,
    });
    if (query.id !== undefined) {
      const found = await this.deps.adminUsers.findById(query.id);
      return found && found.deletedAt === null ? [option(found)] : [];
    }
    return (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter((admin) => admin.status === 'active' && admin.deletedAt === null)
      .filter((admin) => matches(query.q, personName(admin), admin.email))
      .map(option)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, query.limit);
  }
}
