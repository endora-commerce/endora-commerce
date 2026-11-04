import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  acceptInvitationRequestSchema,
  assignMemberRoleRequestSchema,
  inviteMemberToRoleRequestSchema,
  ERROR_CODES,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerAccountRoleCommandPort,
  type CustomerRolePort,
  type OrganizationPermissionPort,
  type OrganizationRoleReadPort,
  type OrganizationRoleRef,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { InvitationService } from './services/invitation-service.js';
import type { OrganizationInvitation } from './entities/organization-invitation.entity.js';
import { memberRoleRef, memberSessionRole } from './services/member-role-views.js';
import { subjectOf } from './routes.roles.js';

/**
 * The storefront member and invitation routes (`contracts/storefront-api.md`
 * §3; `specs/170-organization-roles/` WP-03; FR-005, FR-008, FR-010, FR-010a,
 * FR-065, FR-073).
 *
 * Every route but the invitation accept is the administrator's: managing
 * members and invitations is a **reserved capability**, asked of
 * `organizationPermissionPort.isAdministrator` and refused with the existing
 * `403 FORBIDDEN` — never a permission code, so a custom role holding every
 * code is still refused (data-model §6). The gate is a `preHandler` after
 * `requireCustomer`, so a refused caller is answered before the body is
 * validated. A personal Organization's sole member is its administrator (owner
 * rulings PR-3, PR-10): these routes answer it as any administrator.
 *
 * Request bodies are strict (research R-24): a role is named by its id, and a
 * body still sending the legacy `role` is `400`. Responses name the role as
 * `organizationRole` and never as the legacy enum.
 */
export interface MembersDeps {
  invitationService: InvitationService;
  roleService: CustomerRolePort;
  /** `customer_accounts`' own read — the member a role change answers with. */
  customerAccountRead: CustomerAccountReadPort;
  /** The administrator gate and the accepted member's effective permissions; resolved per request. */
  organizationPermissions: () => OrganizationPermissionPort;
  /** The role as a response names it (FR-008). */
  organizationRoles: Pick<OrganizationRoleReadPort, 'roleRef'>;
  /**
   * `customer_account.change_role`, as `customer_accounts` publishes it (a
   * Command factory, research R-22), and the bus that runs it (Principle XIII).
   */
  customerAccountRoles: Pick<CustomerAccountRoleCommandPort, 'changeRole'>;
  commandBus: { run<T>(command: Command<T>): Promise<T> };
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

  const requireOrganizationAdministrator = async (request: FastifyRequest): Promise<void> => {
    if (!(await deps.organizationPermissions().isAdministrator(subjectOf(request, resolveCustomerContext)))) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator required.');
    }
  };
  const administrator = [requireCustomer, requireOrganizationAdministrator];
  const language = (request: FastifyRequest): Promise<string> => request.responseLanguage();

  const memberView = async (member: CustomerAccountRecord, lang: string): Promise<Record<string, unknown>> =>
    serializeMember(member, await memberRoleRef(deps.organizationRoles, member, lang));

  app.get(
    '/api/v1/organizations/mine/members',
    { preHandler: administrator },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const lang = await language(request);
      const members = await roleService.listMembers(ctx.organizationId);
      return { data: await Promise.all(members.map((member) => memberView(member, lang))) };
    },
  );

  app.get(
    '/api/v1/organizations/mine/invitations',
    { preHandler: administrator },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const lang = await language(request);
      const rows = await invitationService.listPending({ organizationId: ctx.organizationId });
      return {
        data: await Promise.all(
          rows.map(async (invitation) =>
            serializeInvitation(invitation, await memberRoleRef(deps.organizationRoles, invitation, lang)),
          ),
        ),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/invitations/:id',
    { preHandler: administrator },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await invitationService.revoke(
        { organizationId: ctx.organizationId },
        request.params.id,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/organizations/mine/invitations',
    { preHandler: administrator, schema: { body: inviteMemberToRoleRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = inviteMemberToRoleRequestSchema.parse(request.body);
      const result = await invitationService.invite(ctx, {
        email: body.email,
        ...(body.roleId ? { roleId: body.roleId } : {}),
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
    // Feature 154 — reachable whatever the sales-channel access rule decides: an
    // invited person joins before they can sign in.
    { schema: { body: acceptInvitationRequestSchema }, config: { salesChannelAccess: 'open' } },
    async (request) => {
      const body = acceptInvitationRequestSchema.parse(request.body);
      const result = await invitationService.acceptByToken(request.params.token, {
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      const account = result.customerAccount;
      return {
        data: {
          customerAccount: {
            ...serializeMemberFields(account),
            ...(await memberSessionRole(
              deps.organizationRoles,
              deps.organizationPermissions(),
              account,
              await language(request),
            )),
          },
        },
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/members/:id',
    { preHandler: administrator },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const params = memberRoleParamSchema.parse(request.params);
      await roleService.removeMember(ctx.organizationId, params.id);
      return reply.status(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/members/:id/role',
    { preHandler: administrator, schema: { body: assignMemberRoleRequestSchema } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const params = memberRoleParamSchema.parse(request.params);
      const body = assignMemberRoleRequestSchema.parse(request.body);
      // `customer_account.change_role` refuses a member or a role the
      // Organization does not have with `404` (FR-005) and the last
      // administrator's demotion with `409 CANNOT_DEMOTE_LAST_ADMIN`.
      await deps.commandBus.run(
        deps.customerAccountRoles.changeRole({
          organizationId: ctx.organizationId,
          customerAccountId: params.id,
          roleId: body.roleId,
        }),
      );
      const member = await deps.customerAccountRead.findInOrganization(params.id, ctx.organizationId, {
        activeOnly: true,
      });
      if (!member) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
      return { data: await memberView(member, await language(request)) };
    },
  );

  if (deps.exposeTestProbe && deps.latestInvitationToken) {
    app.get('/api/v1/_test/latest-invitation-token', async () => {
      return { token: deps.latestInvitationToken!.value ?? null };
    });
  }
}

function serializeInvitation(i: OrganizationInvitation, organizationRole: OrganizationRoleRef): Record<string, unknown> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    email: i.email,
    organizationRole,
    invitedByCustomerAccountId: i.invitedByCustomerAccountId ?? null,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

function serializeMemberFields(m: CustomerAccountRecord): Record<string, unknown> {
  return {
    id: m.id,
    organizationId: m.organizationId,
    email: m.email,
    firstName: m.firstName,
    lastName: m.lastName,
    emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null,
    twoFactorEnabled: m.twoFactorEnabled,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function serializeMember(m: CustomerAccountRecord, organizationRole: OrganizationRoleRef): Record<string, unknown> {
  return { ...serializeMemberFields(m), organizationRole };
}
