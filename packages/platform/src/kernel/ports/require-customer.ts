import type { FastifyRequest } from 'fastify';

/**
 * Kernel port — the customer guard (issue #43), the customer-side twin of
 * {@link import('./require-admin.js').RequireAdminFactory}.
 *
 * The kernel owns the **type**; the `auth` module owns the **implementation**
 * (`modules/auth/require-customer.ts`), because deciding whether a request
 * carries a customer session means reading the actor its plugin decorates.
 *
 * A guard rather than a factory: there is no permission code to bind, so there
 * is nothing for a factory to close over. Declared over the request alone so it
 * is assignable at every `preHandler` site — Fastify passes a reply the guard
 * has no use for, and a two-parameter type would not be assignable to the
 * one-parameter shapes several modules already declare.
 */
export type RequireCustomerGuard = (req: FastifyRequest) => Promise<void>;
