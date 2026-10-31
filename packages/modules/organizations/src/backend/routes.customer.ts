import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  changePasswordRequestSchema,
  createAddressRequestSchema,
  updateAddressRequestSchema,
  ERROR_CODES,
  type AddressServicePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerAuthPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from './entities/organization.entity.js';
import { describeModerationStatus } from './services/moderation-message.js';
import type { OrganizationsTranslate } from './services/organizations-prose.js';

export interface OrganizationsCustomerDeps {
  customerAuthService: CustomerAuthPort;
  addressService: AddressServicePort;
  /**
   * `customer_accounts`' own read, where `GET /api/v1/me` used to load that
   * module's entity (feature 075, Phase C). With it off the endpoint fails
   * closed — a profile page that cannot identify its caller must refuse, not
   * render an empty one.
   */
  customerAccountRead: CustomerAccountReadPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /**
   * Feature 040 — org-OPTIONAL resolver for GET /me, so standalone (org-less)
   * customers can load their profile (organizationId null) instead of 422.
   */
  resolveCustomerActorOptionalOrg: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string | null;
    impersonatorAdminUserId?: string | null;
  };
  /** Read-only EntityManager factory for the GET /me endpoint. */
  emFactory: () => EntityManager;
  /**
   * This module's bundle, for `moderationMessage` in the language the response
   * is answered in (issue #95). Absent, English.
   */
  translate?: OrganizationsTranslate;
}

export async function registerOrganizationsCustomerRoutes(
  app: FastifyInstance,
  deps: OrganizationsCustomerDeps,
): Promise<void> {
  const {
    customerAuthService,
    addressService,
    requireCustomer,
    resolveCustomerContext,
  } = deps;

  app.get(
    '/api/v1/me',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = deps.resolveCustomerActorOptionalOrg(request);
      const em = deps.emFactory();
      const customer = await deps.customerAccountRead.findById(ctx.customerAccountId);
      if (!customer) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      // Feature 040 — org-less customers resolve to organization: null.
      const organization = ctx.organizationId
        ? await em.findOne(Organization, { id: ctx.organizationId })
        : null;
      const impersonatorAdminUserId = ctx.impersonatorAdminUserId ?? null;
      return {
        data: {
          customerAccount: serializeCustomer(customer),
          organization: organization
            ? serializeOrganization(
                organization,
                await describeModerationStatus(
                  deps.translate,
                  organization.status,
                  await request.responseLanguage(),
                ),
              )
            : null,
          impersonation: impersonatorAdminUserId
            ? { impersonatorAdminUserId }
            : null,
        },
      };
    },
  );

  app.post(
    '/api/v1/me/password',
    { preHandler: requireCustomer, schema: { body: changePasswordRequestSchema } },
    async (request, reply) => {
      const body = changePasswordRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      await customerAuthService.changePassword(
        ctx.customerAccountId,
        body.currentPassword,
        body.newPassword,
        // The session this request was made from is the one the change keeps.
        {
          sessionCookieValue: (request as { cookies?: Record<string, string | undefined> })
            .cookies?.[SESSION_COOKIE_NAME],
        },
      );
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { kind?: 'delivery' | 'billing' } }>(
    '/api/v1/organizations/mine/addresses',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const list = await addressService.list(ctx.organizationId, request.query.kind);
      return { data: list.map(serializeAddress) };
    },
  );

  app.post(
    '/api/v1/organizations/mine/addresses',
    { preHandler: requireCustomer, schema: { body: createAddressRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = createAddressRequestSchema.parse(request.body);
      const address = await addressService.createAddress(ctx.organizationId, {
        kind: body.kind,
        recipientName: body.recipientName,
        street: body.street,
        city: body.city,
        postalCode: body.postalCode,
        country: body.country,
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      });
      reply.status(201);
      return { data: serializeAddress(address) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/addresses/:id',
    { preHandler: requireCustomer, schema: { body: updateAddressRequestSchema } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = updateAddressRequestSchema.parse(request.body);
      const address = await addressService.updateAddress(ctx.organizationId, request.params.id, {
        ...(body.recipientName !== undefined ? { recipientName: body.recipientName } : {}),
        ...(body.street !== undefined ? { street: body.street } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      });
      return { data: serializeAddress(address) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/addresses/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await addressService.deleteAddress(ctx.organizationId, request.params.id);
      return reply.status(204).send();
    },
  );
}

function serializeAddress(a: {
  id: string;
  organizationId: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  isDefault: boolean;
}) {
  return {
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
  };
}

function serializeCustomer(c: CustomerAccountRecord) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    role: c.role,
    emailVerifiedAt: c.emailVerifiedAt?.toISOString() ?? null,
    twoFactorEnabled: c.twoFactorEnabled,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeOrganization(o: Organization, moderationMessage: string | null) {
  return {
    id: o.id,
    name: o.name,
    legalName: o.legalName ?? null,
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    isPersonal: o.isPersonal,
    registeredAddress: o.registeredAddress,
    version: o.version,
    canTransact: o.status === 'active',
    /**
     * Localized, customer-safe explanation of the current Organization status
     * when ordering is unavailable, `null` for `active`. The storefront uses it
     * as the disabled-CTA tooltip / cart-banner body.
     */
    moderationMessage,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
