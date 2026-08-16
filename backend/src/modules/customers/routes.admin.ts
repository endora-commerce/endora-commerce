import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  blockCustomerRequestSchema,
  startImpersonationRequestSchema,
  assignOrganizationRequestSchema,
  assignCustomerGroupRequestSchema,
  customerAddressInputSchema,
  customFieldValuesSchema,
  validateCustomerVatRequestSchema,
  ERROR_CODES,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { Command, CommandBus } from '../../commands/index.js';
import {
  CustomFieldValidationError,
  type CustomFieldValueService,
} from '../custom_fields/services/custom-field-value.service.js';
import { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { CustomerModerationService } from './services/customer-moderation-service.js';
import type { CustomerAdminQueryService } from './services/customer-admin-query-service.js';
import type { CustomerOrgAssignmentService } from './services/customer-org-assignment-service.js';
import type { CustomerDeletionService } from './services/customer-deletion-service.js';
import type { CustomerPresenceService } from './services/customer-presence-service.js';
import type { CustomerAddressService } from './services/customer-address-service.js';
import type { PasswordResetService } from '../customer_accounts/services/password-reset-service.js';
import type { Mailer } from '../email/services/mailer.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import {
  serializeCustomerAddress,
  serializeOrganizationAddress,
} from './serializers.js';
import type { ImpersonationService } from '../admin_users/services/impersonation-service.js';
import type { CartQueryService } from '../carts/services/cart-query-service.js';
import type { OrderListService } from '../orders/services/order-list-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import type { VatValidator } from '../organizations/services/vat-validator-port.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';

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
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  moderationService: CustomerModerationService;
  queryService: CustomerAdminQueryService;
  orgAssignmentService: CustomerOrgAssignmentService;
  addressService: CustomerAddressService;
  cartQueryService: CartQueryService;
  /** Narrowed to the one method this surface calls — see `plugin.ts` (D-44). */
  getOrderListService: () => Pick<OrderListService, 'list'>;
  rfqService: RfqService;
  vatValidator: VatValidator;
  impersonationService: ImpersonationService;
  deletionService: CustomerDeletionService;
  presenceService: CustomerPresenceService;
  passwordResetService: PasswordResetService;
  mailer: Mailer;
  auditLogService: AuditLogService;
  storefrontBaseUrl: string;
  /** Feature 055 — validates + persists Customer custom-field values (via the Command Bus). */
  customFieldValues?: CustomFieldValueService;
  /** Feature 055 — audits the custom-field write co-transactionally when provided. */
  commandBus?: CommandBus;
}

export async function registerCustomersAdminRoutes(
  app: FastifyInstance,
  deps: CustomersAdminDeps,
): Promise<void> {
  const { requireAdmin, resolveModerationActor, moderationService } = deps;
  const { impersonationService, queryService } = deps;
  const customFieldValues = deps.customFieldValues;
  const commandBus = deps.commandBus;

  // PATCH /api/v1/admin/customers/:id/custom-fields (feature 055). Audited via
  // the Command Bus (Principle XIII); validation may reject with a 422.
  if (customFieldValues && commandBus) {
    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/customers/:id/custom-fields',
      { preHandler: requireAdmin('customers:manage'), schema: { body: customFieldValuesSchema } },
      async (request) => {
        const patch = customFieldValuesSchema.parse(request.body);
        const id = request.params.id;
        const command: Command<CustomerAccount> = {
          action: 'customer.custom_fields.update',
          objectType: 'customer_account',
          objectId: id,
          capture: async ({ em }) => {
            const c = await em.findOne(CustomerAccount, { id });
            return c ? { customFieldValues: c.customFieldValues ?? {} } : null;
          },
          run: async ({ em }) => {
            const customer = await em.findOne(CustomerAccount, { id });
            if (!customer) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer not found.');
            customer.customFieldValues = await customFieldValues.validateAndMerge(
              'customer',
              customer.customFieldValues ?? {},
              patch,
            );
            return { result: customer, after: { customFieldValues: customer.customFieldValues } };
          },
        };
        try {
          await commandBus.run(command);
          const detail = await queryService.getDetail(id);
          if (!detail) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer not found.');
          return { data: detail };
        } catch (err) {
          if (err instanceof CustomFieldValidationError) {
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
    { preHandler: requireAdmin('customers:read') },
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
    { preHandler: requireAdmin('customers:manage'), schema: { body: blockCustomerRequestSchema } },
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
    { preHandler: requireAdmin('customers:manage') },
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
      preHandler: requireAdmin('customers:impersonate'),
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

      return {
        data: {
          impersonationSessionId: result.impersonationSessionId,
          impersonatedCustomerAccount: {
            id: result.impersonatedCustomerAccount.id,
            email: result.impersonatedCustomerAccount.email,
            firstName: result.impersonatedCustomerAccount.firstName,
            lastName: result.impersonatedCustomerAccount.lastName,
          },
        },
      };
    },
  );

  // ── Organization assignment (US5) ───────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/organization',
    { preHandler: requireAdmin('customers:manage'), schema: { body: assignOrganizationRequestSchema } },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const body = assignOrganizationRequestSchema.parse(request.body);
      const customer = await deps.orgAssignmentService.assign(
        request.params.id,
        body.organizationId,
        actor,
      );
      return { data: { id: customer.id, organizationId: customer.organizationId ?? null } };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/organization',
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.orgAssignmentService.unassign(request.params.id, actor);
      return { data: { id: customer.id, organizationId: customer.organizationId ?? null } };
    },
  );

  // ── Customer group (US6) ────────────────────────────────────────────────

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/customer-group',
    { preHandler: requireAdmin('customers:manage'), schema: { body: assignCustomerGroupRequestSchema } },
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

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/addresses',
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      const customer = await deps.emFactory().findOne(CustomerAccount, { id: request.params.id });
      const personal = await deps.addressService.listPersonal(request.params.id);
      const organization =
        customer?.organizationId == null
          ? []
          : await deps.addressService.listOrganizationAddresses(customer.organizationId);
      return {
        data: {
          personal: personal.map(serializeCustomerAddress),
          organization: organization.map(serializeOrganizationAddress),
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/addresses',
    { preHandler: requireAdmin('customers:manage'), schema: { body: customerAddressInputSchema } },
    async (request, reply) => {
      await resolveModerationActor(request);
      const body = customerAddressInputSchema.parse(request.body);
      const created = await deps.addressService.create(request.params.id, {
        kind: body.kind,
        recipientName: body.recipientName,
        street: body.street,
        city: body.city,
        postalCode: body.postalCode,
        country: body.country,
        phone: body.phone,
        isDefault: body.isDefault,
      });
      reply.code(201);
      return { data: serializeCustomerAddress(created) };
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
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize ?? '20', 10) || 20));
      const result = await deps.getOrderListService().list({
        placedByCustomerAccountId: request.params.id,
        page,
        pageSize,
      });
      return { data: result.rows, meta: { page, pageSize, total: result.total } };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/quote-requests',
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      await resolveModerationActor(request);
      const customer = await deps.emFactory().findOne(CustomerAccount, { id: request.params.id });
      const data = await deps.rfqService.listForCustomer({
        customerAccountId: request.params.id,
        organizationId: customer?.organizationId ?? '',
        isOrgAdmin: false,
      });
      return { data };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/carts',
    { preHandler: requireAdmin('customers:read') },
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
    { preHandler: requireAdmin('customers:manage') },
    async (request, reply) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps
        .emFactory()
        .findOne(CustomerAccount, { id: request.params.id, deletedAt: null });
      if (!customer) {
        reply.code(404);
        return { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' } };
      }
      const { rawToken } = await deps.passwordResetService.requestReset(customer.email);
      if (rawToken) {
        const link = `${deps.storefrontBaseUrl}/reset-password?token=${rawToken}`;
        await deps.mailer.send({
          messageId: `admin-pwd-reset.${customer.id}.${rawToken.slice(0, 8)}`,
          to: customer.email,
          subject: 'Set a new password',
          text: `An administrator started a password reset for your account. Set a new password here: ${link}`,
        });
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
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.deletionService.softDelete(request.params.id, actor);
      return { data: { id: customer.id, deleted: customer.deletedAt != null } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/restore',
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await deps.deletionService.restore(request.params.id, actor);
      return { data: { id: customer.id, deleted: customer.deletedAt != null } };
    },
  );
}
