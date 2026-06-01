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
  inviteMemberRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { Organization } from './entities/organization.entity.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { RequireAdminAnyFactory } from '../../http/require-admin-any.js';
import type { InvitationService } from './services/invitation-service.js';
import type { RoleService } from '../customer_accounts/services/role-service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
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
import { hashPassword } from '../auth/services/password-hasher.js';
import { normalizeOrganizationName } from './services/normalize-name.js';

/**
 * Admin /admin/organizations — platform staff operations (003).
 */

const listQuerySchema = z.object({
  'filter[status]': z.enum(['pending_verification', 'active', 'blocked', 'rejected']).optional(),
  'filter[vatStatus]': z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export interface AdminOrgsDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  requireAdminAny: RequireAdminAnyFactory;
  invitationService: InvitationService;
  roleService: RoleService;
  auditLogService: AuditLogService;
  /** Optional — when provided, mounts the approve / reject / block / unblock endpoints. */
  moderationService?: OrganizationModerationService;
  /** Optional — when provided, mounts the restrictions admin endpoints (US4). */
  restrictionService?: OrganizationRestrictionService;
  /** Optional — when provided, mounts the applicable-price-lists endpoint (US5). */
  effectivePriceListsService?: OrganizationEffectivePriceListsService;
  /** Optional — when provided, mounts the VAT-validation endpoints (US7). */
  taxIdValidationService?: OrganizationTaxIdValidationService;
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
      const members = await em.find(CustomerAccount, {
        organizationId: org.id,
        deletedAt: null,
      });
      return {
        data: {
          ...serializeOrg(org),
          members: members.map(serializeMemberDetail),
        },
      };
    },
  );

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
      const email = body.email.toLowerCase();
      const dup = await em.findOne(CustomerAccount, { email });
      if (dup) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_REGISTERED,
          'An account with this email already exists.',
        );
      }
      const passwordHash = await hashPassword(body.password);
      const role = body.role ?? 'regular_user';
      const customer = em.create(CustomerAccount, {
        organizationId: org.id,
        email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        role,
      });
      await em.persistAndFlush(customer);
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
      const em = emFactory();
      const member = await em.findOne(CustomerAccount, {
        id: request.params.customerAccountId,
        organizationId: request.params.id,
        deletedAt: null,
      });
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

  app.patch<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: adminPatchMemberProfileRequestSchema },
    },
    async (request) => {
      const body = adminPatchMemberProfileRequestSchema.parse(request.body);
      const em = emFactory();
      const member = await em.findOne(CustomerAccount, {
        id: request.params.customerAccountId,
        organizationId: request.params.id,
        deletedAt: null,
      });
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      assertVersion(member.updatedAt, body.expectedUpdatedAt);
      const before = serializeMemberDetail(member);
      if (body.email !== undefined) {
        const nextEmail = body.email.toLowerCase();
        if (nextEmail !== member.email) {
          const taken = await em.findOne(CustomerAccount, {
            email: nextEmail,
            deletedAt: null,
          });
          if (taken && taken.id !== member.id) {
            throw new HttpError(
              409,
              ERROR_CODES.EMAIL_ALREADY_REGISTERED,
              'That email is already used by another account.',
            );
          }
          member.email = nextEmail;
          member.emailVerifiedAt = null;
        }
      }
      if (body.firstName !== undefined) member.firstName = body.firstName;
      if (body.lastName !== undefined) member.lastName = body.lastName;
      await em.flush();
      await audit(
        request,
        'customer_account.admin_profile_update',
        'customer_account',
        member.id,
        before as Record<string, unknown>,
        serializeMemberDetail(member) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(member) };
    },
  );

  app.delete<{ Params: { id: string; customerAccountId: string } }>(
    '/api/v1/admin/organizations/:id/members/:customerAccountId',
    { preHandler: requireAdmin('customers:manage') },
    async (request, reply) => {
      const em = emFactory();
      const member = await em.findOne(CustomerAccount, {
        id: request.params.customerAccountId,
        organizationId: request.params.id,
        deletedAt: null,
      });
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
      reply.status(204).send();
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
      const em = emFactory();
      const member = await em.findOne(CustomerAccount, {
        id: body.promoteCustomerAccountId,
        organizationId: request.params.id,
        deletedAt: null,
      });
      if (!member) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      }
      const before = serializeMemberDetail(member);
      member.role = 'organization_admin';
      await em.flush();
      await audit(
        request,
        'organization.break_glass_admin_promoted',
        'customer_account',
        member.id,
        before as Record<string, unknown>,
        serializeMemberDetail(member) as Record<string, unknown>,
      );
      return { data: serializeMemberDetail(member) };
    },
  );
}

function serializeOrg(o: Organization): Record<string, unknown> {
  return {
    id: o.id,
    name: o.name,
    legalName: o.legalName ?? null,
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    registeredAddress: o.registeredAddress,
    orderConfirmationEmails: o.orderConfirmationEmails ?? [],
    fulfilmentStrategy: o.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: o.fulfilmentStrategyWarehouseOrder ?? null,
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
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function serializeMemberDetail(m: CustomerAccount): Record<string, unknown> {
  return {
    id: m.id,
    email: m.email,
    firstName: m.firstName,
    lastName: m.lastName,
    role: m.role,
    emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null,
    twoFactorEnabled: !!m.twoFactorConfirmedAt,
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
