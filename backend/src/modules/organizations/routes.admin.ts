import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  adminPatchOrganizationRequestSchema,
  adminRecoverOrgAccessRequestSchema,
  adminDirectMemberRequestSchema,
  adminPatchMemberRoleRequestSchema,
  adminPatchMemberProfileRequestSchema,
  adminSetMemberRollupRequestSchema,
  assignOrganizationParentRequestSchema,
  setCreditInheritanceModeRequestSchema,
  inviteMemberRequestSchema,
  isCustomFieldValidationFailure,
  type AddressServicePort,
  type CustomFieldValuePort,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerRolePort,
} from '@b2b/contracts';
import type { CommandBus } from '../../commands/index.js';
import { HttpError } from '../../http/error-envelope.js';
import { getTenantContext } from '../../tenancy/tenant-context.js';
import type { OrganizationTreeService } from './services/organization-tree-service.js';
import { makeSetParentCommand } from './commands/set-parent.command.js';
import { makeMoveCommand } from './commands/move.command.js';
import { makeSetCreditModeCommand } from './commands/set-credit-mode.command.js';
import { Organization } from './entities/organization.entity.js';
import type { RequireAdminAnyFactory } from '../../kernel/ports/require-admin.js';
import type { InvitationService } from './services/invitation-service.js';
import {
  emitCustomerAccountCreated,
  type OrganizationEventBus,
} from './services/registration-service.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type {
  OrganizationModerationService} from './services/organization-moderation-service.js';
import {
  OrganizationNotFoundError,
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from './services/organization-moderation-service.js';
import type {
  OrganizationRestrictionService} from './services/organization-restriction-service.js';
import {
  OrganizationVersionMismatchError as RestrictionVersionMismatchError,
} from './services/organization-restriction-service.js';
import type { OrganizationEffectivePriceListsService } from './services/organization-effective-pricelists-service.js';
import type { OrganizationTaxIdValidationService } from './services/organization-tax-id-validation-service.js';
import {
  approveOrganizationSchema,
  rejectOrganizationSchema,
  blockOrganizationSchema,
  unblockOrganizationSchema,
  replaceOrgRestrictionsSchema,
  patchOrgRestrictionsSchema,
  triggerVatValidationSchema,
} from './schemas/organization.js';
import { normalizeOrganizationName } from './services/normalize-name.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin /admin/organizations — platform staff operations (003).
 */

const listQuerySchema = z.object({
  'filter[status]': z.enum(['pending_verification', 'active', 'blocked', 'rejected']).optional(),
  'filter[vatStatus]': z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  // Feature 051 — personal (B2C) orgs are excluded by default; pass
  // `includePersonal=true` to see them (string compare — z.coerce.boolean would
  // treat the string "false" as true).
  includePersonal: z.string().optional(),
});

export interface AdminOrgsDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  requireAdminAny: RequireAdminAnyFactory;
  invitationService: InvitationService;
  roleService: CustomerRolePort;
  /**
   * `customer_accounts`' published read and member write (feature 075, Phase
   * C). Every member endpoint below used to load, create and mutate that
   * module's entity directly; the writes moved to its side of the port and the
   * audit row stayed here, because the operation being audited is an admin
   * edit on *this* module's member panel.
   *
   * With `customer_accounts` off the member endpoints fail closed. The module
   * is non-deactivatable, so that is a statement about direction rather than a
   * reachable state.
   */
  customerAccountRead: CustomerAccountReadPort;
  customerAccountWrite: CustomerAccountMemberWritePort;
  auditLogService: AuditLogService;
  /**
   * Optional — when provided, the admin direct-member-create endpoint emits
   * `customer_account.created.v1` so downstream modules (shopping_lists) can
   * provision per-customer defaults.
   */
  eventBus?: OrganizationEventBus;
  /** Optional — when provided, mounts the approve / reject / block / unblock endpoints. */
  moderationService?: OrganizationModerationService;
  /** Optional — when provided, mounts the restrictions admin endpoints (US4). */
  restrictionService?: OrganizationRestrictionService;
  /** Optional — when provided, mounts the applicable-price-lists endpoint (US5). */
  effectivePriceListsService?: OrganizationEffectivePriceListsService;
  /** Optional — when provided, mounts the VAT-validation endpoints (US7). */
  taxIdValidationService?: OrganizationTaxIdValidationService;
  /** Optional — when provided, mounts the org-addresses read endpoint used by the default-preferences panel. */
  addressService?: AddressServicePort;
  /**
   * Feature 055 — validates + merges custom-field values on org edit and exposes
   * them on read. The org module owns the write/audit; the value service only
   * validates (Principle XIV).
   */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 056 — when both are provided, mounts the org-hierarchy endpoints
   * (assign/move parent, subtree/ancestors read, delete-with-children guard).
   * Tree mutations run through the Command Bus (Principle XIII).
   */
  treeService?: OrganizationTreeService;
  commandBus?: CommandBus;
}

export async function registerOrganizationsAdminRoutes(
  app: FastifyInstance,
  deps: AdminOrgsDeps,
): Promise<void> {
  const {
    requireAdmin,
    requireAdminAny,
    emFactory,
    invitationService,
    roleService,
    auditLogService,
  } = deps;
  const moderationService = deps.moderationService;
  const restrictionService = deps.restrictionService;
  const effectivePriceListsService = deps.effectivePriceListsService;
  const taxIdValidationService = deps.taxIdValidationService;
  const customFieldValues = deps.customFieldValues;

  const customersRead = requireAdminAny(['customers:read', 'customers:manage']);

  const audit = async (
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): Promise<void> => {
    if (request.actor.kind !== 'admin') return;
    const rid = request.headers['x-request-id'];
    await auditLogService.record({
      actorAdminUserId: request.actor.adminUserId,
      action,
      objectType,
      objectId,
      stateBefore,
      stateAfter,
      requestId: typeof rid === 'string' ? rid : null,
    });
  };

  const assertVersion = (current: Date, expectedIso?: string): void => {
    if (!expectedIso) return;
    const expected = new Date(expectedIso);
    if (Number.isNaN(expected.getTime()) || current.getTime() !== expected.getTime()) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Record was modified by another request. Refresh and retry.',
      );
    }
  };

  app.get(
    '/api/v1/admin/organizations',
    { preHandler: customersRead },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const em = emFactory();
      const where: Record<string, unknown> = { deletedAt: null };
      // Feature 051 — exclude personal (B2C) orgs from the B2B admin list by default.
      if (query.includePersonal !== 'true') where['isPersonal'] = false;
      if (query['filter[status]']) where['status'] = query['filter[status]'];
      if (query['filter[vatStatus]']) where['vatStatus'] = query['filter[vatStatus]'];
      if (query.q) {
        // Feature 026 US8 — diacritic-insensitive search via the
        // denormalized `nameSearch` column populated by the
        // @BeforeCreate / @BeforeUpdate hooks on the Organization
        // entity. Falls back to taxId ILIKE so admins can also paste a
        // tax-id fragment.
        const normalized = normalizeOrganizationName(query.q);
        where['$or'] = [
          { nameSearch: { $ilike: `%${normalized}%` } },
          { taxId: { $ilike: `%${query.q}%` } },
        ];
      }
      const orgs = await em.find(Organization, where, {
        limit: query.limit,
        orderBy: { createdAt: 'desc' },
      });
      return {
        data: orgs.map(serializeOrg),
        pagination: { cursor: null, hasMore: false, limit: query.limit },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id',
    { preHandler: customersRead },
    async (request) => {
      const em = emFactory();
      const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const members = await deps.customerAccountRead.listByOrganization(org.id, {
        activeOnly: true,
      });
      return {
        data: {
          ...serializeOrg(org),
          members: members.map(serializeMemberDetail),
        },
      };
    },
  );

  // Org-owned addresses (with ids) — feeds the default-preferences panel's
  // billing/shipping address pickers on the Organization edit page.
  if (deps.addressService) {
    const addressService = deps.addressService;
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/addresses',
      { preHandler: customersRead },
      async (request) => {
        const rows = await addressService.list(request.params.id);
        return {
          data: rows.map((a) => ({
            id: a.id,
            organizationId: a.organizationId,
            kind: a.kind,
            recipientName: a.recipientName,
            street: a.street,
            city: a.city,
            postalCode: a.postalCode,
            country: a.country,
            phone: a.phone ?? null,
            isDefault: a.isDefault,
          })),
        };
      },
    );
  }

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminPatchOrganizationRequestSchema },
    },
    async (request) => {
      const em = emFactory();
      const body = adminPatchOrganizationRequestSchema.parse(request.body);
      const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      assertVersion(org.updatedAt, body.expectedUpdatedAt);
      const before = serializeOrg(org);
      if (body.name !== undefined) org.name = body.name;
      if (body.vatStatus !== undefined) org.vatStatus = body.vatStatus;
      if (body.status !== undefined) org.status = body.status;
      if (body.orderConfirmationEmails !== undefined) org.orderConfirmationEmails = body.orderConfirmationEmails;
      if (body.fulfilmentStrategy !== undefined) org.fulfilmentStrategy = body.fulfilmentStrategy;
      if (body.fulfilmentStrategyWarehouseOrder !== undefined) {
        org.fulfilmentStrategyWarehouseOrder = body.fulfilmentStrategyWarehouseOrder;
      }
      // Feature 055 — validate + merge custom-field values; the org module owns
      // the write, the value service only validates (Principle XIV).
      if (body.customFieldValues !== undefined && customFieldValues) {
        try {
          org.customFieldValues = await customFieldValues.validateAndMerge(
            'organization',
            org.customFieldValues ?? {},
            body.customFieldValues,
          );
        } catch (err) {
          // Narrowed structurally rather than by `instanceof`: the constructor
          // is a file in `custom_fields`' directory, and the guard is what
          // `@b2b/contracts` publishes in its place. `customFieldValueService`
          // is a gated port, so this re-throws anything that is not the
          // validation failure — a `ModuleDisabledError` included.
          if (isCustomFieldValidationFailure(err)) {
            throw new HttpError(
              422,
              ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
              'One or more custom fields are invalid.',
              err.errors.map((e) => ({ path: e.field, issue: e.message })),
            );
          }
          throw err;
        }
      }
      await em.flush();
      await audit(
        request,
        'organization.admin_patch',
        'organization',
        org.id,
        before,
        serializeOrg(org) as Record<string, unknown>,
      );
      return { data: serializeOrg(org) };
    },
  );

  // ── Moderation lifecycle (feature 026) ─────────────────────────────────
  // Approve / Reject / Block / Unblock. Mounted only when the moderation
  // service was wired (composition root passes it in).

  if (moderationService) {
    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/approve',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: approveOrganizationSchema },
      },
      async (request) => {
        const body = approveOrganizationSchema.parse(request.body);
        const rid = request.headers['x-request-id'];
        try {
          const org = await moderationService.approve(request.params.id, {
            expectedVersion: body.expectedVersion,
            actorAdminUserId: resolveAdminUserId(request),
            requestId: typeof rid === 'string' ? rid : null,
          });
          return { data: serializeOrg(org) };
        } catch (err) {
          throw mapModerationError(err);
        }
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/reject',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: rejectOrganizationSchema },
      },
      async (request) => {
        const body = rejectOrganizationSchema.parse(request.body);
        const rid = request.headers['x-request-id'];
        try {
          const org = await moderationService.reject(request.params.id, {
            expectedVersion: body.expectedVersion,
            reason: body.reason,
            notifyCustomerEmail: body.notifyCustomerEmail,
            actorAdminUserId: resolveAdminUserId(request),
            requestId: typeof rid === 'string' ? rid : null,
          });
          return { data: serializeOrg(org) };
        } catch (err) {
          throw mapModerationError(err);
        }
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/block',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: blockOrganizationSchema },
      },
      async (request) => {
        const body = blockOrganizationSchema.parse(request.body);
        const rid = request.headers['x-request-id'];
        try {
          const org = await moderationService.block(request.params.id, {
            expectedVersion: body.expectedVersion,
            reason: body.reason ?? null,
            actorAdminUserId: resolveAdminUserId(request),
            requestId: typeof rid === 'string' ? rid : null,
          });
          return { data: serializeOrg(org) };
        } catch (err) {
          throw mapModerationError(err);
        }
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/unblock',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: unblockOrganizationSchema },
      },
      async (request) => {
        const body = unblockOrganizationSchema.parse(request.body);
        const rid = request.headers['x-request-id'];
        try {
          const org = await moderationService.unblock(request.params.id, {
            expectedVersion: body.expectedVersion,
            actorAdminUserId: resolveAdminUserId(request),
            requestId: typeof rid === 'string' ? rid : null,
          });
          return { data: serializeOrg(org) };
        } catch (err) {
          throw mapModerationError(err);
        }
      },
    );
  }

  // ── Restrictions (feature 026 US4) ─────────────────────────────────────
  // Per-Organization allow-lists for payment methods, delivery methods, and
  // assigned warehouses. Empty allow-list ⇒ platform defaults apply.
  if (restrictionService) {
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/restrictions',
      { preHandler: requireAdmin('customers:manage') },
      async (request) => {
        const data = await restrictionService.readAllowLists(request.params.id);
        return { data };
      },
    );

    app.put<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/restrictions',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: replaceOrgRestrictionsSchema },
      },
      async (request) => {
        const body = replaceOrgRestrictionsSchema.parse(request.body);
        try {
          const data = await restrictionService.replaceAllowLists(request.params.id, body);
          return { data };
        } catch (err) {
          throw mapRestrictionError(err);
        }
      },
    );

    const patchRoute = (
      url: string,
      kind: 'payment_method' | 'delivery_method' | 'warehouse',
    ): void => {
      app.patch<{ Params: { id: string } }>(
        url,
        {
          preHandler: requireAdmin('customers:manage'),
          schema: { body: patchOrgRestrictionsSchema },
        },
        async (request) => {
          const body = patchOrgRestrictionsSchema.parse(request.body);
          try {
            const data = await restrictionService.patchAllowList(request.params.id, kind, body);
            return { data };
          } catch (err) {
            throw mapRestrictionError(err);
          }
        },
      );
    };

    patchRoute('/api/v1/admin/organizations/:id/restrictions/payment-methods', 'payment_method');
    patchRoute('/api/v1/admin/organizations/:id/restrictions/delivery-methods', 'delivery_method');
    patchRoute('/api/v1/admin/organizations/:id/restrictions/warehouses', 'warehouse');
  }

  // ── Applicable Price Lists (feature 026 US5) ────────────────────────────
  // Read-only panel showing every Price List currently applicable to the
  // Organization, each tagged with the reasons it applies.
  if (effectivePriceListsService) {
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/applicable-price-lists',
      { preHandler: requireAdmin('customers:manage') },
      async (request) => {
        const items = await effectivePriceListsService.listApplicable(request.params.id);
        return { items };
      },
    );
  }

  // ── VAT validation (feature 026 US7) ────────────────────────────────────
  // History list + trigger-now endpoints. Provider outage always degrades
  // to `outcome: 'deferred'` rather than HTTP 5xx — the org save never
  // fails because of a third-party hiccup.
  if (taxIdValidationService) {
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/vat-validations',
      { preHandler: requireAdmin('customers:manage') },
      async (request) => {
        const items = await taxIdValidationService.listForOrganization(request.params.id);
        return {
          items: items.map((r) => ({
            id: r.id,
            provider: r.provider,
            outcome: r.outcome,
            taxIdValue: r.taxIdValue,
            legalNameReturned: r.legalNameReturned ?? null,
            addressReturned: r.addressReturned ?? null,
            errorKind: r.errorKind ?? null,
            requestedByAdminUserId: r.requestedByAdminUserId ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/vat-validations',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: triggerVatValidationSchema },
      },
      async (request) => {
        const body = triggerVatValidationSchema.parse(request.body ?? {});
        const result = await taxIdValidationService.trigger(request.params.id, {
          providerHint: body.providerHint,
          applyAutoFill: body.applyAutoFill,
          actorAdminUserId: resolveAdminUserId(request),
        });
        return {
          id: result.record.id,
          provider: result.record.provider,
          outcome: result.record.outcome,
          taxIdValue: result.record.taxIdValue,
          legalNameReturned: result.record.legalNameReturned ?? null,
          addressReturned: result.record.addressReturned ?? null,
          errorKind: result.record.errorKind ?? null,
          requestedByAdminUserId: result.record.requestedByAdminUserId ?? null,
          createdAt: result.record.createdAt.toISOString(),
          organization: result.organization,
        };
      },
    );
  }

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/members/invite',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: inviteMemberRequestSchema },
    },
    async (request, reply) => {
      const body = inviteMemberRequestSchema.parse(request.body);
      const result = await invitationService.invite(
        { organizationId: request.params.id, customerAccountId: null },
        { email: body.email, ...(body.role ? { role: body.role } : {}) },
      );
      await audit(
        request,
        'organization.invite_sent',
        'organization_invitation',
        result.invitation.id,
        null,
        { invitationId: result.invitation.id, email: result.invitation.email },
      );
      reply.status(201);
      return {
        data: {
          invitationId: result.invitation.id,
          expiresAt: result.invitation.expiresAt.toISOString(),
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/members',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminDirectMemberRequestSchema },
    },
    async (request, reply) => {
      const em = emFactory();
      const body = adminDirectMemberRequestSchema.parse(request.body);
      const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      // Feature 051 — a personal (B2C) org is single-member; no direct add.
      if (org.isPersonal) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'A personal (individual) organization cannot have additional members.',
        );
      }
      const email = body.email.toLowerCase();
      const role = body.role ?? 'regular_user';
      // The duplicate check and the argon2 hash both moved to the owner's side
      // of the port with the write; `create` raises the same 409
      // `EMAIL_ALREADY_REGISTERED`.
      const customer = await deps.customerAccountWrite.create({
        organizationId: org.id,
        email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        role,
      });
      if (deps.eventBus) {
        emitCustomerAccountCreated(deps.eventBus, customer.id, org.id);
      }
      await audit(
        request,
        'customer_account.admin_create',
        'customer_account',
        customer.id,
        null,
        { organizationId: org.id, email: customer.email, role: customer.role },
      );
      reply.status(201);
      return { data: serializeMemberDetail(customer) };
    },
  );

  app.patch<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId/role',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminPatchMemberRoleRequestSchema },
    },
    async (request) => {
      const body = adminPatchMemberRoleRequestSchema.parse(request.body);
      const member = await deps.customerAccountRead.findInOrganization(
        request.params.customerAccountId,
        request.params.id,
        { activeOnly: true },
      );
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      assertVersion(member.updatedAt, body.expectedUpdatedAt);
      const before = serializeMemberDetail(member);
      const updated = await roleService.changeRole(request.params.id, member.id, body.role);
      await audit(
        request,
        'customer_account.admin_role_change',
        'customer_account',
        updated.id,
        before as Record<string, unknown>,
        serializeMemberDetail(updated) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(updated) };
    },
  );

  // Feature 056 (T032) — toggle the customer-side roll-up capability. When
  // enabled, this member's login sees/acts across its organization's subtree.
  app.patch<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId/rollup',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminSetMemberRollupRequestSchema },
    },
    async (request) => {
      const body = adminSetMemberRollupRequestSchema.parse(request.body);
      const member = await deps.customerAccountRead.findInOrganization(
        request.params.customerAccountId,
        request.params.id,
        { activeOnly: true },
      );
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      assertVersion(member.updatedAt, body.expectedUpdatedAt);
      const before = serializeMemberDetail(member);
      const updated = await deps.customerAccountWrite.setSubtreeRollup(
        member.id,
        body.subtreeRollupEnabled,
      );
      await audit(
        request,
        'customer_account.admin_rollup_change',
        'customer_account',
        updated.id,
        before as Record<string, unknown>,
        serializeMemberDetail(updated) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(updated) };
    },
  );

  app.patch<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminPatchMemberProfileRequestSchema },
    },
    async (request) => {
      const body = adminPatchMemberProfileRequestSchema.parse(request.body);
      const member = await deps.customerAccountRead.findInOrganization(
        request.params.customerAccountId,
        request.params.id,
        { activeOnly: true },
      );
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      assertVersion(member.updatedAt, body.expectedUpdatedAt);
      const before = serializeMemberDetail(member);
      // The uniqueness check, the lower-casing and the "a changed address is
      // no longer verified" rule all went with the write: they are properties
      // of the column, not of this screen.
      const updated = await deps.customerAccountWrite.updateProfile(member.id, {
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      });
      await audit(
        request,
        'customer_account.admin_profile_update',
        'customer_account',
        updated.id,
        before as Record<string, unknown>,
        serializeMemberDetail(updated) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(updated) };
    },
  );

  app.delete<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId',
    { preHandler: requireAdmin('customers:manage') },
    async (request, reply) => {
      const member = await deps.customerAccountRead.findInOrganization(
        request.params.customerAccountId,
        request.params.id,
        { activeOnly: true },
      );
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      const before = serializeMemberDetail(member);
      await roleService.removeMember(request.params.id, member.id);
      await audit(
        request,
        'customer_account.admin_remove',
        'customer_account',
        member.id,
        before as Record<string, unknown>,
        null,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/recover-admin-access',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminRecoverOrgAccessRequestSchema },
    },
    async (request) => {
      const body = adminRecoverOrgAccessRequestSchema.parse(request.body);
      const member = await deps.customerAccountRead.findInOrganization(
        body.promoteCustomerAccountId,
        request.params.id,
        { activeOnly: true },
      );
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      const before = serializeMemberDetail(member);
      // Deliberately not `roleService.changeRole`: this is the break-glass
      // path an operator reaches *because* the organisation has no admin left,
      // and that method writes its own `customer_account.change_role` audit
      // row, which would double-count the one below.
      const updated = await deps.customerAccountWrite.promoteToOrganizationAdmin(member.id);
      await audit(
        request,
        'organization.break_glass_admin_promoted',
        'customer_account',
        updated.id,
        before as Record<string, unknown>,
        serializeMemberDetail(updated) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(updated) };
    },
  );

  // ── Hierarchy (feature 056 US1) ─────────────────────────────────────────
  // Assign/move parent (Command Bus), read subtree/ancestors, and the
  // delete-with-children guard. Mounted only when the tree service + command
  // bus are wired.
  if (deps.treeService && deps.commandBus) {
    const treeService = deps.treeService;
    const commandBus = deps.commandBus;

    // Assign / move / detach parent. `parentId = null` detaches to a root.
    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/parent',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: assignOrganizationParentRequestSchema },
      },
      async (request) => {
        const body = assignOrganizationParentRequestSchema.parse(request.body);
        const em = emFactory();
        const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
        if (!org) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        }
        // A distinct command action for a clean audit label: first-assign /
        // detach ⇒ set_parent; re-parent of an existing child ⇒ move.
        const input = { organizationId: request.params.id, parentId: body.parentId };
        const wasChild = (org.parentId ?? null) !== null;
        const command =
          wasChild && body.parentId !== null
            ? makeMoveCommand({ tree: treeService }, input)
            : makeSetParentCommand({ tree: treeService }, input);
        const updated = await commandBus.run(command);
        return { data: serializeOrg(updated) };
      },
    );

    // Read the subtree (descendants incl. self), pre-order.
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/subtree',
      { preHandler: customersRead },
      async (request) => {
        const em = emFactory();
        const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
        if (!org) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        }
        const items = await treeService.subtreeNodes(request.params.id);
        return { items };
      },
    );

    // Read the ancestor chain, nearest-first.
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/ancestors',
      { preHandler: customersRead },
      async (request) => {
        const em = emFactory();
        const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
        if (!org) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        }
        const items = await treeService.ancestorNodes(request.params.id);
        return { items };
      },
    );

    // Set the per-org credit-inheritance mode (US3). Platform-admin only — a
    // scoped / roll-up actor is rejected 403 (money-behavior switch, R6).
    app.put<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id/credit-inheritance-mode',
      {
        preHandler: requireAdmin('customers:manage'),
        schema: { body: setCreditInheritanceModeRequestSchema },
      },
      async (request) => {
        const ctx = getTenantContext();
        if (!ctx || ctx.mode !== 'all') {
          // Only a platform admin (unrestricted scope) may change credit behavior.
          throw new HttpError(
            403,
            ERROR_CODES.FORBIDDEN,
            'Only a platform administrator can change an organization credit-inheritance mode.',
          );
        }
        const body = setCreditInheritanceModeRequestSchema.parse(request.body);
        const em = emFactory();
        const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
        if (!org) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        }
        const updated = await commandBus.run(
          makeSetCreditModeCommand({ organizationId: request.params.id, mode: body.mode }),
        );
        return { data: serializeOrg(updated) };
      },
    );

    // Delete an organization — blocked (409 has_children) while any child
    // exists (FR-010). Backed by the DB `parent_id ON DELETE RESTRICT`.
    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/organizations/:id',
      { preHandler: requireAdmin('customers:manage') },
      async (request, reply) => {
        const em = emFactory();
        const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
        if (!org) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        }
        const childCount = await em.count(Organization, {
          parentId: request.params.id,
          deletedAt: null,
        });
        if (childCount > 0) {
          throw new HttpError(
            409,
            ERROR_CODES.ORGANIZATION_HAS_CHILDREN,
            'This organization has sub-organizations. Reassign or remove the children first.',
            { code: 'has_children' },
          );
        }
        const before = serializeOrg(org);
        org.deletedAt = new Date();
        await em.flush();
        await audit(request, 'organization.delete', 'organization', org.id, before, null);
        return reply.status(204).send();
      },
    );
  }
}

function serializeOrg(o: Organization): Record<string, unknown> {
  return {
    id: o.id,
    name: o.name,
    legalName: o.legalName ?? null,
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    isPersonal: o.isPersonal,
    registeredAddress: o.registeredAddress,
    orderConfirmationEmails: o.orderConfirmationEmails ?? [],
    fulfilmentStrategy: o.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: o.fulfilmentStrategyWarehouseOrder ?? null,
    // Feature 056 — hierarchy.
    parentId: o.parentId ?? null,
    path: o.path,
    creditInheritanceMode: o.creditInheritanceMode ?? null,
    version: o.version,
    blockedReason: o.blockedReason ?? null,
    blockedAt: o.blockedAt?.toISOString() ?? null,
    rejectedReason: o.rejectedReason ?? null,
    rejectedAt: o.rejectedAt?.toISOString() ?? null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    approvedByAdminUserId: o.approvedByAdminUserId ?? null,
    vatValidation: {
      outcome: o.vatValidationOutcome ?? null,
      provider: o.vatValidationProvider ?? null,
      validatedAt: o.vatValidatedAt?.toISOString() ?? null,
    },
    customFieldValues: o.customFieldValues ?? {},
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function serializeMemberDetail(m: CustomerAccountRecord): Record<string, unknown> {
  return {
    id: m.id,
    email: m.email,
    firstName: m.firstName,
    lastName: m.lastName,
    role: m.role,
    subtreeRollupEnabled: m.subtreeRollupEnabled,
    emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null,
    twoFactorEnabled: m.twoFactorEnabled,
    lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Reads the admin user id from whichever actor decoration is available.
 * Production wiring decorates `request.actor` via the auth plugin; the
 * test harness decorates `request.testActor` via `registerTestAuth`.
 * Falls back to `null` when no admin actor is present (e.g., the auth
 * gate already returned 401, or a future surface invokes this for a
 * system actor).
 */
function resolveAdminUserId(request: FastifyRequest): string | null {
  const testActor = (request as FastifyRequest & { testActor?: { kind: string; adminUserId?: string } }).testActor;
  if (testActor && testActor.kind === 'admin' && testActor.adminUserId) {
    return testActor.adminUserId;
  }
  const actor = (request as FastifyRequest & { actor?: { kind: string; adminUserId?: string } }).actor;
  if (actor && actor.kind === 'admin' && actor.adminUserId) {
    return actor.adminUserId;
  }
  return null;
}

/**
 * Maps the domain errors raised by OrganizationModerationService to their
 * HTTP equivalents. 409 for version mismatch (with `currentVersion` in the
 * body), 404 for missing org, 422 for status-guard violations.
 */
/**
 * Maps OrganizationRestrictionService errors to HTTP. Same 409 contract as
 * the moderation endpoints (the body carries `currentVersion`).
 */
function mapRestrictionError(err: unknown): HttpError {
  if (err instanceof RestrictionVersionMismatchError) {
    return new HttpError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'Organization was modified by another request. Refresh and retry.',
      {
        code: 'organization_version_mismatch',
        currentVersion: err.currentVersion,
      },
    );
  }
  if (err instanceof HttpError) return err;
  return new HttpError(
    500,
    ERROR_CODES.INTERNAL,
    err instanceof Error ? err.message : 'Internal error.',
  );
}

function mapModerationError(err: unknown): HttpError {
  if (err instanceof OrganizationVersionMismatchError) {
    return new HttpError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'Organization was modified by another request. Refresh and retry.',
      {
        code: 'organization_version_mismatch',
        currentVersion: err.currentVersion,
      },
    );
  }
  if (err instanceof OrganizationStatusGuardError) {
    return new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      `Organization is in status '${err.currentStatus}', cannot perform an action that requires '${err.requiredStatus}'.`,
      { currentStatus: err.currentStatus, requiredStatus: err.requiredStatus },
    );
  }
  if (err instanceof OrganizationNotFoundError) {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }
  if (err instanceof HttpError) return err;
  return new HttpError(
    500,
    ERROR_CODES.INTERNAL,
    err instanceof Error ? err.message : 'Internal error.',
  );
}

void (null as FastifyRequest | null);
