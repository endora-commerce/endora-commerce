// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  blockCustomerRequestSchema,
  startImpersonationRequestSchema,
  assignOrganizationRequestSchema,
  assignCustomerGroupRequestSchema,
  customFieldValuesSchema,
  validateCustomerVatRequestSchema,
  ERROR_CODES,
  isCustomFieldValidationFailure,
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  type AddressReadPort,
  type CartQueryPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomFieldValuePort,
  type EmailMailerPort,
  type ImpersonationPort,
  type OrderListPort,
  type OrganizationRoleReadPort,
  type RfqCustomerPort,
  type VatValidator,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { CustomerModerationService } from './services/customer-moderation-service.js';
import type { CustomerAdminQueryService } from './services/customer-admin-query-service.js';
import type { CustomerOrgAssignmentService } from './services/customer-org-assignment-service.js';
import type { CustomerDeletionService } from './services/customer-deletion-service.js';
import type { CustomerPresenceService } from './services/customer-presence-service.js';
import type { AddressBookRetirementService } from './services/address-book-retirement-service.js';
import type { ChannelUrlFacts, CustomerPasswordResetPort } from '@endora-commerce/contracts';
import { storefrontPagePathFor } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import {
  serializeCustomerAddress,
  serializeOrganizationAddress,
} from './serializers.js';
import { addressBookRetired } from './address-book-retired.js';

const ADMIN_SHADOW_COOKIE = 'admin_shadow_session';

function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}

/**
 * Admin customer-management routes (feature 040). Block/unblock land here in
 * US3; later user stories extend this file (impersonate, detail, group,
 * delete/restore, presence). Every route is gated by `requireAdmin`.
 */
export type RequireAdminGuard = (
  permission?: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Resolves the acting admin's id, whether they are a Platform Administrator,
 * and (for a scoped Salesperson) the Organizations they may act on.
 */
export type ResolveModerationActor = (
  request: FastifyRequest,
) => Promise<{
  adminUserId: string;
  isPlatformAdmin: boolean;
  allowedOrganizationIds: string[];
}>;

export interface CustomersAdminDeps {
  /**
   * Feature 075 — `customer_accounts`' published read and lifecycle write,
   * where this file used to load and patch that module's entity through an
   * `EntityManager` it no longer needs at all.
   */
  accounts: CustomerAccountReadPort;
  accountWrites: CustomerAccountLifecycleWritePort;
  /**
   * `specs/170-organization-roles/` WP-03 — the impersonated member's role on
   * the impersonation answer (FR-062, spec *Impersonation*).
   */
  organizationRoles: Pick<OrganizationRoleReadPort, 'roleRef'>;
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  moderationService: CustomerModerationService;
  queryService: CustomerAdminQueryService;
  orgAssignmentService: CustomerOrgAssignmentService;
  /**
   * `addresses`' read — the customer's Organization book, which is every
   * customer's one book (`specs/173-b2c-address-book-merge/` OD-1).
   */
  organizationAddresses: Pick<AddressReadPort, 'listForOrganization'>;
  /** The personal-book rows the release-1 retirement job refused (OD-6). */
  addressBookRetirement: Pick<AddressBookRetirementService, 'listRefused'>;
  cartQueryService: CartQueryPort;
  /**
   * `orders`' published list (feature 075), where this surface used to hold
   * `Pick<OrderListService, 'list'>` — a type operator in front of a
   * cross-module import of the class.
   */
  orderList: OrderListPort;
  rfqService: RfqCustomerPort;
  vatValidator: VatValidator;
  /**
   * `admin_users`' published impersonation seam. The "view as this customer"
   * control lives on this screen and the machinery lives in that module by
   * design, so the surface holds the port rather than a second instance of the
   * service (feature 075).
   */
  impersonationService: ImpersonationPort;
  deletionService: CustomerDeletionService;
  presenceService: CustomerPresenceService;
  passwordResetService: CustomerPasswordResetPort;
  mailer: EmailMailerPort;
  auditLogService: AuditPort;
  storefrontBaseUrl: string;
  /**
   * Feature 167 (FR-034) — the channel an admin-sent storefront link is composed for:
   * a customer belongs to no channel, so the system-default one. Absent: no prefix.
   */
  linkChannel?: () => Promise<ChannelUrlFacts | null>;
  /**
   * Feature 055 — validates Customer custom-field values. It no longer
   * persists them: `customer_accounts` owns the row, so its lifecycle port
   * runs the Command and this validator is the merge that port is handed.
   */
  customFieldValues?: CustomFieldValuePort;
}

export async function registerCustomersAdminRoutes(
  app: FastifyInstance,
  deps: CustomersAdminDeps,
): Promise<void> {
  const { requireAdmin, resolveModerationActor, moderationService } = deps;
  const { impersonationService, queryService, accounts, accountWrites } = deps;
  const customFieldValues = deps.customFieldValues;

  /**
   * The guard chain of every `/api/v1/admin/customers/:id…` route: the
   * permission first, so an anonymous caller still gets 401 and a caller
   * without the code still gets 403 whether or not the customer exists, then
   * the shape of the id. An id that is not a UUID names no customer and answers
   * `404 CUSTOMER_NOT_FOUND` before any read — unchecked, it reached PostgreSQL
   * and came back as a 500 (`invalid input syntax for type uuid`).
   */
  const requireCustomerId = async (request: FastifyRequest): Promise<void> => {
    const { id } = request.params as { id: string };
    if (!isUuidShape(id)) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
  };
  /**
   * The sub-resources (`custom-fields`, `impersonate`, both `addresses` verbs,
   * `orders`, `quote-requests`, `carts`) also check that the customer exists, after the
   * permission and the shape, so an unknown customer answers
   * `404 CUSTOMER_NOT_FOUND` as the customer itself does — not a sub-resource's
   * own code, nor an empty list that reads as "this customer has nothing"
   * (issue #794). Through `customer_accounts`' `@OrgScoped` read: a customer an
   * operator may not see reads as absent. A soft-deleted one exists here; what
   * each sub-resource does with it is its own answer.
   */
  const requireCustomerExists = async (request: FastifyRequest): Promise<void> => {
    const { id } = request.params as { id: string };
    if ((await accounts.findById(id)) === null) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
  };
  const forCustomer = (permission: string) => [requireAdmin(permission), requireCustomerId];
  const forCustomerSubResource = (permission: string) => [
    requireAdmin(permission),
    requireCustomerId,
    requireCustomerExists,
  ];

  // PATCH /api/v1/admin/customers/:id/custom-fields (feature 055).
  //
  // Feature 075 — the row is `customer_accounts`', so the Command that writes
  // it and the audit row it carries are on that side of the port. What stays
  // here is the merge: this surface owns the screen and resolves
  // `custom_fields`' validator, and the merge has to run between the owner's
  // load and its write or a concurrent patch is lost. Hence the callback.
  if (customFieldValues) {
    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/customers/:id/custom-fields',
      { preHandler: forCustomerSubResource('customers:manage'), schema: { body: customFieldValuesSchema } },
      async (request) => {
        const patch = customFieldValuesSchema.parse(request.body);
        const id = request.params.id;
        try {
          await accountWrites.setCustomFieldValues(id, (current) =>
            customFieldValues.validateAndMerge('customer', current, patch),
          );
          const detail = await queryService.getDetail(id);
          if (!detail) throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
          return { data: detail };
        } catch (err) {
          // The tolerance is narrow and one-shot: a rejected custom-field patch
          // is a 422 and nothing else here is. `rethrowIfModuleDisabled` comes
          // first so a switched-off owner keeps failing closed instead of being
          // laundered into a validation error (AGENTS.md composition item 7).
          rethrowIfModuleDisabled(err);
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
      },
    );
  }

  // GET /api/v1/admin/customers — list (authority-scoped)
  app.get<{
    Querystring: {
      q?: string;
      status?: 'active' | 'blocked' | 'deleted';
      organizationId?: string;
      customerGroupId?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    '/api/v1/admin/customers',
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const q = request.query;
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
      const result = await queryService.list(
        {
          ...(q.q !== undefined ? { q: q.q } : {}),
          ...(q.status !== undefined ? { status: q.status } : {}),
          ...(q.organizationId !== undefined ? { organizationId: q.organizationId } : {}),
          ...(q.customerGroupId !== undefined ? { customerGroupId: q.customerGroupId } : {}),
          page,
          pageSize,
        },
        {
          isPlatformAdmin: actor.isPlatformAdmin,
          allowedOrganizationIds: actor.allowedOrganizationIds,
        },
      );
      return { data: result.rows, meta: { page, pageSize, total: result.total } };
    },
  );

  // GET /api/v1/admin/customers/:id — detail
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id',
    { preHandler: forCustomer('customers:read') },
    async (request, reply) => {
      await resolveModerationActor(request);
      const detail = await queryService.getDetail(request.params.id);
      if (!detail) {
        reply.code(404);
        return { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' } };
      }
      return { data: detail };
    },
  );

  // POST /api/v1/admin/customers/:id/block
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/block',
    { preHandler: forCustomer('customers:manage'), schema: { body: blockCustomerRequestSchema } },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const body = blockCustomerRequestSchema.parse(request.body ?? {});
      const customer = await moderationService.block({
        targetCustomerAccountId: request.params.id,
        actor,
        reason: body.reason ?? null,
        audit: {
          ipAddress: request.ip,
          ...(typeof request.headers['user-agent'] === 'string'
            ? { userAgent: request.headers['user-agent'] }
            : {}),
        },
      });
      return { data: { id: customer.id, blocked: customer.blockedAt != null } };
    },
  );

  // POST /api/v1/admin/customers/:id/unblock
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/unblock',
    { preHandler: forCustomer('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await moderationService.unblock({
        targetCustomerAccountId: request.params.id,
        actor,
        audit: {
          ipAddress: request.ip,
          ...(typeof request.headers['user-agent'] === 'string'
            ? { userAgent: request.headers['user-agent'] }
            : {}),
        },
      });
      return { data: { id: customer.id, blocked: customer.blockedAt != null } };
    },
  );

  // POST /api/v1/admin/customers/:id/impersonate (US4) — works for org-less
  // customers (organizationId omitted → target resolved by id alone, R10).
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/impersonate',
    {
      preHandler: forCustomerSubResource('customers:impersonate'),
      schema: { body: startImpersonationRequestSchema },
    },
    async (request, reply) => {
      const actor = await resolveModerationActor(request);
      const body = startImpersonationRequestSchema.parse(request.body ?? {});
      const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
      // Admin session lives in the dedicated admin cookie; fall back to the
      // legacy customer-cookie name so older sessions / test stubs still work.
      const adminCookie =
        cookies?.[ADMIN_SESSION_COOKIE_NAME] ?? cookies?.[SESSION_COOKIE_NAME] ?? '';

      const result = await impersonationService.start({
        adminUserId: actor.adminUserId,
        adminSessionCookieValue: adminCookie,
        customerAccountId: request.params.id,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
        requestId: request.id,
      });

      setSessionCookie(reply, result.impersonationCookieValue, result.impersonationExpiresAt);
      reply.setCookie(ADMIN_SHADOW_COOKIE, result.adminShadowSessionCookieValue, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        expires: result.impersonationExpiresAt,
        signed: false,
      });

      // The role whose permissions the impersonation acts under — exactly the
      // member's (spec *Impersonation*); the member route guards judge it.
      const impersonated = await accounts.findById(result.impersonatedCustomerAccount.id);
      const organizationRole = impersonated
        ? await deps.organizationRoles.roleRef(
            impersonated.organizationId,
            impersonated.organizationRoleId,
            await request.responseLanguage(),
          )
        : null;
      if (!organizationRole) {
        // Required on the answer (`specs/170-organization-roles/` WP-12); the
        // account was just impersonated and its role is held by a foreign key,
        // so this is unreachable — refuse rather than name no role.
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization role not found.');
      }
      return {
        data: {
          impersonationSessionId: result.impersonationSessionId,
          impersonatedCustomerAccount: {
            id: result.impersonatedCustomerAccount.id,
            email: result.impersonatedCustomerAccount.email,
            firstName: result.impersonatedCustomerAccount.firstName,
            lastName: result.impersonatedCustomerAccount.lastName,
            organizationRole,
          },
        },
      };
    },
  );

  // ── Organization assignment (US5) ───────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/organization',
    { preHandler: forCustomer('customers:manage'), schema: { body: assignOrganizationRequestSchema } },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const body = assignOrganizationRequestSchema.parse(request.body);
      const customer = await deps.orgAssignmentService.assign(
        request.params.id,
        body.organizationId,
        actor,
      );
      return { data: { id: customer.id, organizationId: customer.organizationId } };
    },
  );

  /**
   * Detach a customer from the company they belong to.
   *
   * The verb is still `DELETE` and the response still carries the customer's
   * organisation, but since D-178 the organisation it carries is the customer's
   * **own** personal one rather than `null`. An account with no organisation
   * cannot transact and cannot be scoped, and the column refuses one.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/organization',
    { preHandler: forCustomer('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.orgAssignmentService.unassign(request.params.id, actor);
      return { data: { id: customer.id, organizationId: customer.organizationId } };
    },
  );

  // ── Customer group (US6) ────────────────────────────────────────────────

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/customer-group',
    { preHandler: forCustomer('customers:manage'), schema: { body: assignCustomerGroupRequestSchema } },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const body = assignCustomerGroupRequestSchema.parse(request.body);
      const customer = await deps.orgAssignmentService.setCustomerGroup(
        request.params.id,
        body.customerGroupId,
        actor,
      );
      return { data: { id: customer.id, customerGroupId: customer.customerGroupId ?? null } };
    },
  );

  // ── Addresses (US5) ─────────────────────────────────────────────────────
  //
  // `specs/173-b2c-address-book-merge/` release 1 (OD-6): the card is
  // read-only. It lists the customer's Organization book — the one book they
  // order from — and, under `personal`, only the personal-book rows the
  // retirement job refused, each with its reason. Adding a personal address is
  // retired (OD-5, OD-8). Admin editing of Organization addresses is a separate
  // follow-up.

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/addresses',
    { preHandler: forCustomerSubResource('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      // `@OrgScoped` through `customer_accounts`' read: an out-of-scope
      // customer reads as absent, which the guard has already answered
      // `404 CUSTOMER_NOT_FOUND` (issue #794); this arm is a customer deleted
      // between the guard and the read.
      const customer = await accounts.findById(request.params.id);
      if (customer === null) {
        throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
      }
      const [organization, refused] = await Promise.all([
        deps.organizationAddresses.listForOrganization(customer.organizationId),
        deps.addressBookRetirement.listRefused(customer.id),
      ]);
      return {
        data: {
          personal: refused.map(serializeCustomerAddress),
          organization: organization.map(serializeOrganizationAddress),
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/addresses',
    // The existence check too: an unknown customer is `404 CUSTOMER_NOT_FOUND`,
    // as a malformed id is, and only a customer that exists is told the
    // personal book is retired (issue #794).
    { preHandler: forCustomerSubResource('customers:manage') },
    async (request) => {
      await resolveModerationActor(request);
      return addressBookRetired();
    },
  );

  // ── NIP / VAT validation (US5) ──────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/vat-validate',
    { preHandler: requireAdmin('customers:manage'), schema: { body: validateCustomerVatRequestSchema } },
    async (request) => {
      await resolveModerationActor(request);
      const body = validateCustomerVatRequestSchema.parse(request.body);
      const result = await deps.vatValidator.validate({
        taxId: body.taxId,
        ...(body.countryCode !== undefined ? { countryCode: body.countryCode } : {}),
      });
      return {
        data: {
          outcome: result.outcome,
          legalName: result.legalName,
          address: result.address,
        },
      };
    },
  );

  // ── Read-only history panels (US5) ──────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    '/api/v1/admin/customers/:id/orders',
    { preHandler: forCustomerSubResource('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize ?? '20', 10) || 20));
      const result = await deps.orderList.list({
        placedByCustomerAccountId: request.params.id,
        page,
        pageSize,
      });
      return { data: result.rows, meta: { page, pageSize, total: result.total } };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/quote-requests',
    { preHandler: forCustomerSubResource('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      const customer = await accounts.findById(request.params.id);
      if (customer === null) {
        throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
      }
      // The customer's own quote requests only — never their Organization's.
      const data = await deps.rfqService.listForCustomer({
        customerAccountId: request.params.id,
        organizationId: customer.organizationId,
      });
      return { data };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/carts',
    { preHandler: forCustomerSubResource('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      return { data: await deps.cartQueryService.listForCustomer(request.params.id) };
    },
  );

  // ── Online customers (US7) ──────────────────────────────────────────────

  app.get(
    '/api/v1/admin/customers/online',
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      return { data: await deps.presenceService.listOnline() };
    },
  );

  // ── Password reset (US7) ────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/password-reset',
    { preHandler: forCustomer('customers:manage') },
    async (request, reply) => {
      const actor = await resolveModerationActor(request);
      const customer = await accounts.findById(request.params.id, { activeOnly: true });
      if (!customer) {
        reply.code(404);
        return { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' } };
      }
      const { rawToken } = await deps.passwordResetService.requestReset(customer.email);
      if (rawToken) {
        // Feature 167 — the storefront's real reset page (`/password-reset/confirm`;
        // `/reset-password` was served by nothing), under the default language's
        // prefix: the e-mail is written in no particular language.
        const path = storefrontPagePathFor({
          path: `/password-reset/confirm?token=${encodeURIComponent(rawToken)}`,
          channel: deps.linkChannel ? await deps.linkChannel() : null,
        });
        const link = `${deps.storefrontBaseUrl.replace(/\/+$/, '')}${path}`;
        const outcome = await deps.mailer.send({
          messageId: `admin-pwd-reset.${customer.id}.${rawToken.slice(0, 8)}`,
          to: customer.email,
          subject: 'Set a new password',
          text: `An administrator started a password reset for your account. Set a new password here: ${link}`,
          kind: 'admin_password_reset',
        });
        // Only the transport's refusal is named here. `logged` (issue #186) is the
        // console driver saying no mail server is configured: it has already
        // written the message to the log itself, and the delivery record says so.
        if (outcome.status === 'suppressed') {
          // The reset token is minted either way, and the audit row below
          // records the request rather than the delivery — so the message's own
          // fate is named here and kept by D-59's record.
          request.log.warn(
            { customerId: customer.id, reason: outcome.reason },
            '[customers] the password-reset e-mail was not sent',
          );
        }
      }
      await deps.auditLogService.record({
        actorAdminUserId: actor.adminUserId,
        action: 'customer_account.password_reset_requested',
        objectType: 'customer_account',
        objectId: customer.id,
        stateBefore: null,
        stateAfter: null,
      });
      return { data: { ok: true } };
    },
  );

  // ── Soft-delete + restore (US7) ─────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id',
    { preHandler: forCustomer('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.deletionService.softDelete(request.params.id, actor);
      return { data: { id: customer.id, deleted: customer.deletedAt != null } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/restore',
    { preHandler: forCustomer('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.deletionService.restore(request.params.id, actor);
      return { data: { id: customer.id, deleted: customer.deletedAt != null } };
    },
  );
}
