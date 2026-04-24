import type { FastifyInstance, FastifyRequest } from 'fastify';
import { changePasswordRequestSchema } from '@b2b/contracts';
import type { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import type { AddressService } from '../addresses/services/address-service.js';
import {
  createAddressRequestSchema,
  updateAddressRequestSchema,
} from '@b2b/contracts';

export interface OrganizationsCustomerDeps {
  customerAuthService: CustomerAuthService;
  addressService: AddressService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export async function registerOrganizationsCustomerRoutes(
  app: FastifyInstance,
  deps: OrganizationsCustomerDeps,
): Promise<void> {
  const { customerAuthService, addressService, requireCustomer, resolveCustomerContext } = deps;

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
      );
      reply.status(204).send();
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
      reply.status(204).send();
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
