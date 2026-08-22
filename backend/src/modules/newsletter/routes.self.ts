import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  selfSubscribeRequestSchema,
  selfUnsubscribeRequestSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { NewsletterSelfService } from './services/self.service.js';

export interface NewsletterSelfDeps {
  self: NewsletterSelfService;
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  /** Resolve the signed-in customer's email (cross-module lookup, injected). */
  loadCustomerEmail: (customerAccountId: string) => Promise<string | null>;
}

/**
 * Authenticated customer newsletter routes (feature 048, US9). Each endpoint is
 * scoped to the signed-in customer's own subscription.
 */
export async function registerNewsletterSelfRoutes(
  app: FastifyInstance,
  deps: NewsletterSelfDeps,
): Promise<void> {
  const guard = { preHandler: deps.requireCustomer };

  const emailOf = async (req: FastifyRequest): Promise<string> => {
    const email = await deps.loadCustomerEmail(deps.resolveCustomerAccountId(req));
    if (!email) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer not found.');
    return email;
  };

  app.get('/api/v1/me/newsletter', guard, async (req, reply) =>
    reply.send({ data: await deps.self.getStatus(await emailOf(req)) }),
  );

  app.post('/api/v1/me/newsletter/subscribe', guard, async (req, reply) => {
    const body = selfSubscribeRequestSchema.parse(req.body ?? {});
    const accountId = deps.resolveCustomerAccountId(req);
    const email = await emailOf(req);
    const result = await deps.self.subscribe(email, accountId, body.tags, body.customFields);
    return reply.send({ data: result });
  });

  app.post('/api/v1/me/newsletter/unsubscribe', guard, async (req, reply) => {
    const body = selfUnsubscribeRequestSchema.parse(req.body ?? {});
    return reply.send({ data: await deps.self.unsubscribe(await emailOf(req), body.reason) });
  });
}
