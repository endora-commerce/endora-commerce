import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  acceptInvitationRequestSchema,
  changeMemberRoleRequestSchema,
  inviteMemberRequestSchema,
  ERROR_CODES,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerRolePort,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { InvitationService } from './services/invitation-service.js';
import type { OrganizationInvitation } from './entities/organization-invitation.entity.js';

export interface MembersDeps {
  invitationService: InvitationService;
  roleService: CustomerRolePort;
  /**
   * `customer_accounts`' own read (feature 075, Phase C). The Org-Admin gate
   * below used to `await import(...)` that module's entity inside the guard —
   * a dynamic specifier, which `check:module-boundary` refuses on the same
   * terms as a static one. With the module off the gate fails closed, which is
   * the only safe direction for a permission check.
   */
  customerAccountRead: CustomerAccountReadPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Test probe — returns the latest unconsumed invitation token. */
  exposeTestProbe?: boolean;
  /**
   * Per-server in-memory cache of the most-recently issued raw invitation
   * token. The contract test reads it via `_test/latest-invitation-token`.
   */
  latestInvitationToken?: { value: string | null };
}

const memberRoleParamSchema = z.object({ id: z.string().uuid() });

export async function registerMembersRoutes(app: FastifyInstance, deps: MembersDeps): Promise<void> {
  const { invitationService, roleService, requireCustomer, resolveCustomerContext } = deps;

  app.get(
    '/api/v1/organizations/mine/members',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      // Org Admin only — Regular User attempting a list peek gets 403.
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      const members = await roleService.listMembers(ctx.organizationId);
      return { data: members.map(serializeMember) };
    },
  );

  app.get(
    '/api/v1/organizations/mine/invitations',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      const rows = await invitationService.listPending({ organizationId: ctx.organizationId });
      return { data: rows.map(serializeInvitation) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/invitations/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      await invitationService.revoke(
        { organizationId: ctx.organizationId },
        request.params.id,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/organizations/mine/invitations',
    { preHandler: requireCustomer, schema: { body: inviteMemberRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      const body = inviteMemberRequestSchema.parse(request.body);
      const result = await invitationService.invite(ctx, {
        email: body.email,
        ...(body.role ? { role: body.role } : {}),
      });
      if (deps.latestInvitationToken) {
        deps.latestInvitationToken.value = result.rawToken;
      }
      reply.status(201);
      return {
        data: {
          invitationId: result.invitation.id,
          expiresAt: result.invitation.expiresAt.toISOString(),
        },
      };
    },
  );

  app.post<{ Params: { token: string } }>(
    '/api/v1/organizations/invitations/:token/accept',
    { schema: { body: acceptInvitationRequestSchema } },
    async (request) => {
      const body = acceptInvitationRequestSchema.parse(request.body);
      const result = await invitationService.acceptByToken(request.params.token, {
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      return { data: { customerAccount: serializeMember(result.customerAccount) } };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/members/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      const params = memberRoleParamSchema.parse(request.params);
      await roleService.removeMember(ctx.organizationId, params.id);
      return reply.status(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/members/:id/role',
    { preHandler: requireCustomer, schema: { body: changeMemberRoleRequestSchema } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      await assertOrganizationAdmin(deps.customerAccountRead, ctx.customerAccountId);
      const params = memberRoleParamSchema.parse(request.params);
      const body = changeMemberRoleRequestSchema.parse(request.body);
      const member = await roleService.changeRole(ctx.organizationId, params.id, body.role);
      return { data: serializeMember(member) };
    },
  );

  if (deps.exposeTestProbe && deps.latestInvitationToken) {
    app.get('/api/v1/_test/latest-invitation-token', async () => {
      return { token: deps.latestInvitationToken!.value ?? null };
    });
  }
}

async function assertOrganizationAdmin(
  accounts: CustomerAccountReadPort,
  customerAccountId: string,
): Promise<void> {
  const me = await accounts.findById(customerAccountId);
  if (!me || me.role !== 'organization_admin') {
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization Admin role required.');
  }
}

function serializeInvitation(i: OrganizationInvitation): Record<string, unknown> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    email: i.email,
    role: i.role,
    invitedByCustomerAccountId: i.invitedByCustomerAccountId ?? null,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

function serializeMember(
  m: CustomerAccountRecord | OrganizationInvitation,
): Record<string, unknown> {
  if ('email' in m && 'firstName' in m) {
    return {
      id: m.id,
      organizationId: m.organizationId,
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      role: m.role,
      emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null,
      twoFactorEnabled: m.twoFactorEnabled,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
  return { id: m.id };
}
