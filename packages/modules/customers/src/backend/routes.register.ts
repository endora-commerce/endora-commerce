// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  customerRegisterRequestSchema,
  type CustomerRegistrationOptionsResponse,
} from '@endora-commerce/contracts';
import type { CustomerRegistrationService } from './services/customer-registration-service.js';

/**
 * Public standalone-registration routes (feature 040, US1 / FR-002): the
 * registration itself, gated inside the service by the
 * `customers.allow_registration_without_organization` setting, and the read
 * of that gate the storefront renders from (issue #756).
 */
export interface CustomersRegisterDeps {
  registrationService: CustomerRegistrationService;
}

function setSessionCookie(
  reply: FastifyReply,
  value: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}

export async function registerCustomersRegisterRoutes(
  app: FastifyInstance,
  deps: CustomersRegisterDeps,
): Promise<void> {
  /**
   * Issue #756 — whether the storefront may offer individual registration,
   * read before `/register-customer` renders its form. Public, like the
   * registration it describes, and the same answer that route applies. Not
   * cached: an operator switching the setting off should not leave the form
   * on offer for another minute only to refuse it on submit.
   */
  app.get('/api/v1/storefront/settings/customer-registration', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const body: CustomerRegistrationOptionsResponse = {
      data: {
        allowRegistrationWithoutOrganization: await deps.registrationService.allowsStandalone(),
      },
    };
    return body;
  });

  app.post(
    '/api/v1/customers/register',
    { schema: { body: customerRegisterRequestSchema } },
    async (request, reply) => {
      const body = customerRegisterRequestSchema.parse(request.body);
      const result = await deps.registrationService.registerStandalone({
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        ip: request.ip,
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
      });
      setSessionCookie(reply, result.sessionCookieValue, result.sessionExpiresAt);
      reply.code(201);
      return {
        data: {
          customerAccount: {
            id: result.customerAccount.id,
            email: result.customerAccount.email,
            firstName: result.customerAccount.firstName,
            lastName: result.customerAccount.lastName,
            organizationId: result.customerAccount.organizationId ?? null,
          },
        },
      };
    },
  );
}
