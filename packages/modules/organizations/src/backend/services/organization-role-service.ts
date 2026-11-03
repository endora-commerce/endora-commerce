import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  SUPPORTED_LANGUAGES,
  type CreateOrganizationRoleRequest,
  type CustomerAccountReadPort,
  type CustomerAccountRoleCommandPort,
  type DeleteOrganizationRoleResponse,
  type OrganizationOwnRoleResponse,
  type OrganizationPermissionCatalogueResponse,
  type OrganizationPermissionSubject,
  type OrganizationRoleKind,
  type OrganizationRoleRef,
  type OrganizationRoleView,
  type SupportedLanguage,
  type UpdateOrganizationRoleRequest,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { makeCreateOrganizationRoleCommand } from '../commands/organization-role-create.command.js';
import { makeDeleteOrganizationRoleCommand } from '../commands/organization-role-delete.command.js';
import { makeUpdateOrganizationRoleCommand } from '../commands/organization-role-update.command.js';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { effectiveCodes, type OrganizationRoleCatalogue } from './organization-role-catalogue.js';
import type { OrganizationRoleCache } from './organization-role-cache.js';
import type { OrganizationRolePermissionService } from './organization-role-permission-port.js';
import { roleNotFound } from './organization-role-rules.js';
import { entityManagerRoleStore, type OrganizationRoleRow } from './organization-role-store.js';

/**
 * The role-management surface both role route files call
 * (`specs/170-organization-roles/` WP-02a; `contracts/storefront-api.md` §2,
 * `contracts/operator-api.md` §2).
 *
 * Writes go through the three `organization_role.*` Commands on the bus
 * (Principle XIII) and, **after** the bus resolves — after commit — drop the
 * role cache and announce the drop ({@link runRoleCommandAndAnnounce}); a
 * Command that rolled back drops nothing (`contracts/commands-audit-events.md`
 * §5). Reads are views over this module's own tables in the request's tenant
 * scope, so an Organization the caller cannot see is `404`, as is a personal
 * one (spec *Edge Cases*).
 */

/** Resolves a key of a module's bundle; `${moduleId}.${key}` when it has none. */
export type ModuleTranslate = (moduleId: string, key: string, language: SupportedLanguage) => Promise<string>;

export interface OrganizationRoleServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: { run<T>(command: Command<T>): Promise<T> };
  readonly cache: Pick<OrganizationRoleCache, 'dropAndAnnounce'>;
  readonly catalogue: OrganizationRoleCatalogue;
  readonly permissions: Pick<OrganizationRolePermissionService, 'effective'>;
  readonly customerAccountRead: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  /** The holders of a role and the Command that moves one (WP-02b, research R-22). */
  readonly customerAccountRoles: Pick<CustomerAccountRoleCommandPort, 'changeRole' | 'holdersOf'>;
  readonly translate: ModuleTranslate;
}

/**
 * Runs a role Command and, only once it resolved, drops and announces the
 * Organization's cache entry. A Command that throws — rolled back — drops
 * nothing (R-16).
 */
export async function runRoleCommandAndAnnounce<T>(
  commandBus: { run<R>(command: Command<R>): Promise<R> },
  cache: Pick<OrganizationRoleCache, 'dropAndAnnounce'>,
  organizationId: string,
  command: Command<T>,
): Promise<T> {
  const result = await commandBus.run(command);
  await cache.dropAndAnnounce(organizationId);
  return result;
}

const PREDEFINED_FALLBACK_NAMES: Readonly<Record<'administrator' | 'member', string>> = {
  administrator: 'Administrator',
  member: 'Member',
};

const KIND_ORDER: Readonly<Record<OrganizationRoleKind, number>> = { administrator: 0, member: 1, custom: 2 };

export class OrganizationRoleService {
  constructor(private readonly deps: OrganizationRoleServiceDeps) {}

  /** Every role of a company Organization, administrator and member first, then custom by name. */
  async list(organizationId: string, language: SupportedLanguage): Promise<OrganizationRoleView[]> {
    const em = this.deps.emFactory();
    const organization = await this.requireCompanyOrganization(em, organizationId);
    const roles = await em.find(OrganizationRole, { organizationId });
    const counts = await this.counts(em, organization);
    const views = await Promise.all(roles.map((role) => this.view(role, counts, language)));
    return views.sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, language),
    );
  }

  async get(organizationId: string, roleId: string, language: SupportedLanguage): Promise<OrganizationRoleView> {
    const em = this.deps.emFactory();
    const organization = await this.requireCompanyOrganization(em, organizationId);
    const role = await em.findOne(OrganizationRole, { id: roleId, organizationId });
    if (!role) throw roleNotFound();
    return this.view(role, await this.counts(em, organization), language);
  }

  async create(
    organizationId: string,
    body: CreateOrganizationRoleRequest,
    language: SupportedLanguage,
  ): Promise<OrganizationRoleView> {
    await this.requireCompanyOrganization(this.deps.emFactory(), organizationId);
    const role = await runRoleCommandAndAnnounce(
      this.deps.commandBus,
      this.deps.cache,
      organizationId,
      makeCreateOrganizationRoleCommand(await this.commandDeps(), {
        organizationId,
        name: body.name,
        description: body.description ?? null,
        permissions: body.permissions,
      }),
    );
    return this.get(organizationId, role.id, language);
  }

  async update(
    organizationId: string,
    roleId: string,
    body: UpdateOrganizationRoleRequest,
    language: SupportedLanguage,
  ): Promise<OrganizationRoleView> {
    await this.requireCompanyOrganization(this.deps.emFactory(), organizationId);
    await runRoleCommandAndAnnounce(
      this.deps.commandBus,
      this.deps.cache,
      organizationId,
      makeUpdateOrganizationRoleCommand(await this.commandDeps(), {
        organizationId,
        roleId,
        expectedVersion: body.expectedVersion,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
      }),
    );
    return this.get(organizationId, roleId, language);
  }

  async delete(
    organizationId: string,
    roleId: string,
    body: { expectedVersion: number; replacementRoleId?: string | undefined },
  ): Promise<DeleteOrganizationRoleResponse['data']> {
    await this.requireCompanyOrganization(this.deps.emFactory(), organizationId);
    return runRoleCommandAndAnnounce(
      this.deps.commandBus,
      this.deps.cache,
      organizationId,
      makeDeleteOrganizationRoleCommand(
        { catalogue: this.deps.catalogue, store: entityManagerRoleStore, accounts: this.deps.customerAccountRoles },
        {
          organizationId,
          roleId,
          expectedVersion: body.expectedVersion,
          ...(body.replacementRoleId !== undefined ? { replacementRoleId: body.replacementRoleId } : {}),
        },
      ),
    );
  }

  /** `404` unless `organizationId` is a company Organization the request can see. */
  async assertCompanyOrganization(organizationId: string): Promise<void> {
    await this.requireCompanyOrganization(this.deps.emFactory(), organizationId);
  }

  /** The present codes, grouped by declaring module, translated (R-31). */
  async permissionCatalogue(language: SupportedLanguage): Promise<OrganizationPermissionCatalogueResponse['data']> {
    const present = new Set(this.deps.catalogue.presentCodes());
    const groups = new Map<string, OrganizationPermissionCatalogueResponse['data']['groups'][number]>();
    for (const entry of this.deps.catalogue.declarations()) {
      if (!present.has(entry.code)) continue;
      let group = groups.get(entry.moduleId);
      if (!group) {
        group = {
          moduleId: entry.moduleId,
          moduleLabel: await this.moduleText(entry.moduleId, 'module.name', entry.moduleName, language),
          permissions: [],
        };
        groups.set(entry.moduleId, group);
      }
      group.permissions.push({
        code: entry.code,
        label: await this.permissionLabel(entry.code, language),
        description: await this.permissionDescription(entry.code, language),
        memberDefault: entry.memberDefault,
      });
    }
    return { groups: [...groups.values()] };
  }

  /** The member's own role and what it allows, translated (FR-058). */
  async ownRole(
    subject: OrganizationPermissionSubject,
    language: SupportedLanguage,
  ): Promise<OrganizationOwnRoleResponse['data']> {
    const effective = await this.deps.permissions.effective(subject);
    const em = this.deps.emFactory();
    const role = effective.role.id
      ? await em.findOne(OrganizationRole, { id: effective.role.id, organizationId: subject.organizationId })
      : null;
    if (!role) throw roleNotFound();
    return {
      role: await this.ref(role, language),
      permissions: await Promise.all(
        effective.permissions.map(async (code) => ({
          code,
          label: await this.permissionLabel(code, language),
          description: await this.permissionDescription(code, language),
        })),
      ),
    };
  }

  /** A role as every response names it (FR-008): translated when predefined, stored when custom. */
  async ref(role: Pick<OrganizationRoleRow, 'id' | 'kind' | 'name'>, language: SupportedLanguage): Promise<OrganizationRoleRef> {
    return { id: role.id, kind: role.kind, name: await this.roleName(role, language) };
  }

  /** The translated label of a declared code, the manifest's English when the bundle has none. */
  permissionLabel(code: string, language: SupportedLanguage): Promise<string> {
    return translatePermissionText(this.deps.translate, this.deps.catalogue, code, 'label', language);
  }

  private permissionDescription(code: string, language: SupportedLanguage): Promise<string> {
    return translatePermissionText(this.deps.translate, this.deps.catalogue, code, 'description', language);
  }

  private async roleName(role: Pick<OrganizationRoleRow, 'kind' | 'name'>, language: SupportedLanguage): Promise<string> {
    if (role.kind === 'custom') return role.name ?? '';
    return this.moduleText(
      'organizations',
      `organizationRoles.${role.kind}.name`,
      PREDEFINED_FALLBACK_NAMES[role.kind],
      language,
    );
  }

  private moduleText(moduleId: string, key: string, fallback: string, language: SupportedLanguage): Promise<string> {
    return translatedOr(this.deps.translate, moduleId, key, fallback, language);
  }

  /** The predefined labels in every shipped language — names a custom role may not take (R-29). */
  private async reservedNames(): Promise<string[]> {
    const names = new Set<string>(Object.values(PREDEFINED_FALLBACK_NAMES));
    for (const language of SUPPORTED_LANGUAGES) {
      for (const kind of ['administrator', 'member'] as const) {
        names.add(await this.roleName({ kind, name: null }, language));
      }
    }
    return [...names];
  }

  private async commandDeps() {
    return {
      catalogue: this.deps.catalogue,
      store: entityManagerRoleStore,
      reservedNames: await this.reservedNames(),
    };
  }

  private async requireCompanyOrganization(em: EntityManager, organizationId: string): Promise<Organization> {
    const organization = await em.findOne(Organization, { id: organizationId, deletedAt: null });
    if (!organization || organization.isPersonal) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }
    return organization;
  }

  private async counts(
    em: EntityManager,
    organization: Organization,
  ): Promise<{ members: Map<string, number>; pendingInvitations: Map<string, number> }> {
    const members = new Map<string, number>();
    // The assignment itself (WP-02b): every live account holds exactly one role.
    for (const account of await this.deps.customerAccountRead.listByOrganization(organization.id, { activeOnly: true })) {
      members.set(account.organizationRoleId, (members.get(account.organizationRoleId) ?? 0) + 1);
    }
    // FR-010a, PR-7 — pending means not accepted, not revoked and not expired.
    const pending = await em.find(
      OrganizationInvitation,
      { organizationId: organization.id, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
    );
    const pendingInvitations = new Map<string, number>();
    for (const invitation of pending) {
      pendingInvitations.set(invitation.organizationRoleId, (pendingInvitations.get(invitation.organizationRoleId) ?? 0) + 1);
    }
    return { members, pendingInvitations };
  }

  private async view(
    role: OrganizationRole,
    counts: { members: Map<string, number>; pendingInvitations: Map<string, number> },
    language: SupportedLanguage,
  ): Promise<OrganizationRoleView> {
    return {
      id: role.id,
      kind: role.kind,
      name: await this.roleName(role, language),
      description: role.description ?? null,
      permissions: effectiveCodes(role, this.deps.catalogue),
      memberCount: counts.members.get(role.id) ?? 0,
      pendingInvitationCount: counts.pendingInvitations.get(role.id) ?? 0,
      version: role.version,
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}

/** A module's sentence for `key`, or `fallback` when its bundle has none. */
async function translatedOr(
  translate: ModuleTranslate,
  moduleId: string,
  key: string,
  fallback: string,
  language: SupportedLanguage,
): Promise<string> {
  const text = await translate(moduleId, key, language);
  return text === `${moduleId}.${key}` || text === key ? fallback : text;
}

/**
 * A declared code's label or description in `language`, from the declaring
 * module's bundle (`organizationPermissions.<code>.label` / `.description`),
 * the manifest's English when the bundle has none (R-31). An undeclared code
 * answers itself.
 */
export function translatePermissionText(
  translate: ModuleTranslate,
  catalogue: OrganizationRoleCatalogue,
  code: string,
  field: 'label' | 'description',
  language: SupportedLanguage,
): Promise<string> {
  const entry = catalogue.declarationOf(code);
  if (!entry) return Promise.resolve(code);
  return translatedOr(translate, entry.moduleId, `organizationPermissions.${code}.${field}`, entry[field], language);
}

/**
 * A predefined role's name in `language` (FR-008), from this module's bundle,
 * the English one when it has none — the label every response and e-mail
 * names the role by (`specs/170-organization-roles/` WP-03).
 */
export function predefinedRoleName(
  translate: ModuleTranslate,
  kind: 'administrator' | 'member',
  language: SupportedLanguage,
): Promise<string> {
  return translatedOr(translate, 'organizations', `organizationRoles.${kind}.name`, PREDEFINED_FALLBACK_NAMES[kind], language);
}
