import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  CustomerAccountReadPort,
  CustomerAuthPort,
  OrderListPort,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import {
  changePasswordRequestSchema,
  customerAddressInputSchema,
  updateCustomerDefaultsRequestSchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { CustomerAddressService } from './services/customer-address-service.js';
import type { CustomerDefaultsService } from './services/customer-defaults-service.js';
import {
  serializeCustomerAddress,
  serializeOrganizationAddress,
} from './serializers.js';

/**
 * Customer self-service routes (feature 040, US1). Each endpoint is scoped to
 * the authenticated customer's own data (FR-011); org-only capabilities are
 * simply absent for org-less customers (FR-003).
 */
export type RequireCustomerGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CustomerActorView {
  customerAccountId: string;
  organizationId: string | null;
}

/**
 * Resolves the authenticated customer WITHOUT requiring an Organization —
 * org-less customers are first-class here (FR-003). Injected by the host so
 * the actor source (production `request.actor` vs test `request.testActor`)
 * stays out of the route logic.
 */
export type ResolveCustomerActor = (
  request: FastifyRequest,
) => CustomerActorView;

export interface CustomersSelfDeps {
  /**
   * Feature 075 — `customer_accounts`' published read. The own-profile
   * endpoint used to load that module's entity through an `EntityManager` this
   * route file no longer needs at all.
   */
  accounts: CustomerAccountReadPort;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerActor: ResolveCustomerActor;
  customerAuthService: CustomerAuthPort;
  /**
   * `orders`' published list (feature 075). It used to be a lazy getter over
   * `Pick<OrderListService, 'list'>` — a type operator in front of a
   * cross-module import of the class. The port keeps the getter's timing: the
   * service is built inside the `orders` plugin body, so a call made before
   * route registration answers 503 rather than a `null` this file would have
   * to remember to check.
   */
  orderList: OrderListPort;
  rfqService: RfqCustomerPort;
  customerAddressService: CustomerAddressService;
  customerDefaultsService: CustomerDefaultsService;
}

export async function registerCustomersSelfRoutes(
  app: FastifyInstance,
  deps: CustomersSelfDeps,
): Promise<void> {
  const { accounts, requireCustomer, customerAuthService, resolveCustomerActor } = deps;
  const { orderList, rfqService } = deps;
  const { customerAddressService, customerDefaultsService } = deps;

  // GET /api/v1/me/customer — own profile
  app.get(
    '/api/v1/me/customer',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const customer = await accounts.findById(actor.customerAccountId);
      if (!customer) {
        throw new HttpError(
          404,
          ERROR_CODES.CUSTOMER_NOT_FOUND,
          'Customer not found.',
        );
      }
      return {
        data: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          organizationId: customer.organizationId ?? null,
          customerGroupId: customer.customerGroupId ?? null,
          twoFactorEnabled: customer.twoFactorEnabled,
        },
      };
    },
  );

  // POST /api/v1/me/customer/change-password
  app.post(
    '/api/v1/me/customer/change-password',
    { preHandler: requireCustomer, schema: { body: changePasswordRequestSchema } },
    async (request, reply) => {
      const actor = resolveCustomerActor(request);
      const body = changePasswordRequestSchema.parse(request.body);
      await customerAuthService.changePassword(
        actor.customerAccountId,
        body.currentPassword,
        body.newPassword,
      );
      reply.code(204);
      return null;
    },
  );

  // GET /api/v1/me/customer/orders — own orders, aggregated across channels
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/v1/me/customer/orders',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number.parseInt(request.query.pageSize ?? '20', 10) || 20),
      );
      const result = await orderList.list({
        placedByCustomerAccountId: actor.customerAccountId,
        page,
        pageSize,
      });
      return {
        data: result.rows,
        meta: { page, pageSize, total: result.total },
      };
    },
  );

  // GET /api/v1/me/customer/quote-requests — own RFQs
  app.get(
    '/api/v1/me/customer/quote-requests',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      // Org-less customers cannot have RFQs (submission requires an Org).
      if (actor.organizationId === null) {
        return { data: [] };
      }
      const data = await rfqService.listForCustomer({
        customerAccountId: actor.customerAccountId,
        organizationId: actor.organizationId,
        isOrgAdmin: false,
      });
      return { data };
    },
  );

  // ── Address book (US2) ──────────────────────────────────────────────────

  // GET /api/v1/me/customer/addresses — personal + org-shared
  app.get(
    '/api/v1/me/customer/addresses',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const personal = await customerAddressService.listPersonal(actor.customerAccountId);
      const organization =
        actor.organizationId === null
          ? []
          : await customerAddressService.listOrganizationAddresses(actor.organizationId);
      return {
        data: {
          personal: personal.map(serializeCustomerAddress),
          organization: organization.map(serializeOrganizationAddress),
        },
      };
    },
  );

  // POST /api/v1/me/customer/addresses
  app.post(
    '/api/v1/me/customer/addresses',
    { preHandler: requireCustomer, schema: { body: customerAddressInputSchema } },
    async (request, reply) => {
      const actor = resolveCustomerActor(request);
      const body = customerAddressInputSchema.parse(request.body);
      const created = await customerAddressService.create(actor.customerAccountId, {
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

  // PATCH /api/v1/me/customer/addresses/:addressId
  app.patch<{ Params: { addressId: string } }>(
    '/api/v1/me/customer/addresses/:addressId',
    { preHandler: requireCustomer, schema: { body: customerAddressInputSchema.partial() } },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const body = customerAddressInputSchema.partial().parse(request.body);
      const updated = await customerAddressService.update(
        actor.customerAccountId,
        request.params.addressId,
        body,
      );
      return { data: serializeCustomerAddress(updated) };
    },
  );

  // PUT /api/v1/me/customer/addresses/:addressId/default
  app.put<{ Params: { addressId: string } }>(
    '/api/v1/me/customer/addresses/:addressId/default',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const updated = await customerAddressService.setDefault(
        actor.customerAccountId,
        request.params.addressId,
      );
      return { data: serializeCustomerAddress(updated) };
    },
  );

  // DELETE /api/v1/me/customer/addresses/:addressId
  app.delete<{ Params: { addressId: string } }>(
    '/api/v1/me/customer/addresses/:addressId',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const actor = resolveCustomerActor(request);
      await customerAddressService.delete(actor.customerAccountId, request.params.addressId);
      reply.code(204);
      return null;
    },
  );

  // ── Default payment / delivery method + addresses (US2) ──────────────────

  // GET /api/v1/me/customer/defaults
  app.get(
    '/api/v1/me/customer/defaults',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      return { data: await customerDefaultsService.getForCustomer(actor.customerAccountId) };
    },
  );

  // PUT /api/v1/me/customer/defaults
  app.put(
    '/api/v1/me/customer/defaults',
    { preHandler: requireCustomer, schema: { body: updateCustomerDefaultsRequestSchema } },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const body = updateCustomerDefaultsRequestSchema.parse(request.body);
      const updated = await customerDefaultsService.setForCustomer(
        actor.customerAccountId,
        {
          paymentMethodId: body.paymentMethodId,
          deliveryMethodId: body.deliveryMethodId,
          billingAddressId: body.billingAddressId,
          shippingAddressId: body.shippingAddressId,
        },
        {
          customerAccountId: actor.customerAccountId,
          ...(typeof request.headers['user-agent'] === 'string'
            ? { userAgent: request.headers['user-agent'] }
            : {}),
          ipAddress: request.ip,
        },
      );
      return { data: updated };
    },
  );
}
