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
import type { InvitationService } from './services/invitation-service.js';
import type { RoleService } from '../customer_accounts/services/role-service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { hashPassword } from '../auth/services/password-hasher.js';

/**
 * Admin /admin/organizations — platform staff operations (003).
 */

const listQuerySchema = z.object({
  'filter[status]': z.enum(['pending_verification', 'active', 'suspended']).optional(),
  'filter[vatStatus]': z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export interface AdminOrgsDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  invitationService: InvitationService;
  roleService: RoleService;
  auditLogService: AuditLogService;
}

export async function registerOrganizationsAdminRoutes(
  app: FastifyInstance,
  deps: AdminOrgsDeps,
): Promise<void> {
  const { requireAdmin, emFactory, invitationService, roleService, auditLogService } = deps;

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
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const em = emFactory();
      const where: Record<string, unknown> = { deletedAt: null };
      if (query['filter[status]']) where['status'] = query['filter[status]'];
      if (query['filter[vatStatus]']) where['vatStatus'] = query['filter[vatStatus]'];
      if (query.q) {
        where['$or'] = [
          { name: { $ilike: `%${query.q}%` } },
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
    { preHandler: requireAdmin('customers:manage') },
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
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    registeredAddress: o.registeredAddress,
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

void (null as FastifyRequest | null);
