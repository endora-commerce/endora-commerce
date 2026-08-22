import type { FastifyInstance } from 'fastify';
import {
  newsletterSubscribeRequestSchema,
  publicUnsubscribeRequestSchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { NewsletterSubscriberService } from './services/subscriber.service.js';
import type { NewsletterOptInService } from './services/opt-in.service.js';
import type { NewsletterTokenHelper } from './services/token.helper.js';
import type { NewsletterTrackingService } from './services/tracking.service.js';

/** 1×1 transparent GIF for open tracking. */
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export interface NewsletterStorefrontDeps {
  subscribers: NewsletterSubscriberService;
  optIn: NewsletterOptInService;
  tokens: NewsletterTokenHelper;
  tracking: NewsletterTrackingService;
  /** Resolve a sales-channel code to its id; null when unknown. */
  resolveChannelIdByCode: (code: string) => Promise<string | null>;
  /** The channel a request with no `?channel=` belongs to; null = none. */
  defaultChannelId: string | null;
  /** Storefront base used for post-confirm/unsubscribe redirects. */
  storefrontBaseUrl: string;
}

/**
 * Public storefront newsletter routes (feature 048, US1/US9). Mutating routes
 * never reveal whether an email already exists (no enumeration). Wrapped by
 * `defineModuleRoutes` in plugin.ts so they 503 when the module is disabled.
 */
export async function registerNewsletterStorefrontRoutes(
  app: FastifyInstance,
  deps: NewsletterStorefrontDeps,
): Promise<void> {
  app.get('/api/v1/newsletter/status', async (request, reply) => {
    const { channel } = request.query as { channel?: string };
    const channelId = channel ? await deps.resolveChannelIdByCode(channel) : null;
    const optInMode = await deps.optIn.resolveMode(channelId ?? deps.defaultChannelId);
    return reply.send({ data: { enabled: true, optInMode } });
  });

  app.post('/api/v1/newsletter/subscribe', async (request, reply) => {
    const body = newsletterSubscribeRequestSchema.parse(request.body);
    const channelId = await deps.resolveChannelIdByCode(body.channelCode);
    if (!channelId) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Unknown sales channel.', {
        code: 'unknown_channel',
      });
    }
    const result = await deps.subscribers.subscribe({
      email: body.email,
      salesChannelId: channelId,
      source: body.source ?? 'storefront',
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    });
    return reply.send({ data: result });
  });

  app.get('/api/v1/newsletter/confirm', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const claims = token ? deps.tokens.verify(token, 'confirm') : null;
    if (claims) await deps.subscribers.confirm(claims.id);
    const status = claims ? 'ok' : 'invalid';
    return reply.redirect(`${deps.storefrontBaseUrl}/newsletter/confirm?status=${status}`);
  });

  app.get('/api/v1/newsletter/unsubscribe', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const valid = token ? deps.tokens.verify(token, 'unsubscribe') !== null : false;
    return reply.redirect(
      `${deps.storefrontBaseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(token ?? '')}&valid=${valid}`,
    );
  });

  app.post('/api/v1/newsletter/unsubscribe', async (request, reply) => {
    const body = publicUnsubscribeRequestSchema.parse(request.body);
    const claims = deps.tokens.verify(body.token, 'unsubscribe');
    if (claims) await deps.subscribers.unsubscribe(claims.id, body.reason);
    // Always neutral — invalid tokens look the same as success.
    return reply.send({ data: { ok: true } });
  });

  // --- Engagement tracking (US6) -----------------------------------------
  app.get('/api/v1/newsletter/o/:token.gif', { config: { streamingResponse: true } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const claims = deps.tokens.verify(token, 'open');
    if (claims) await deps.tracking.recordOpen(claims.id);
    reply.header('content-type', 'image/gif');
    reply.header('cache-control', 'no-store, no-cache, must-revalidate, private');
    return reply.send(TRACKING_PIXEL);
  });

  app.get('/api/v1/newsletter/c/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { u } = request.query as { u?: string };
    const claims = deps.tokens.verify(token, 'click');
    // Only redirect to absolute http(s) destinations (no open-redirect to other schemes).
    const dest = u && /^https?:\/\//i.test(u) ? u : null;
    if (claims && dest) await deps.tracking.recordClick(claims.id, claims.linkId ?? null, dest);
    if (!dest) {
      return reply.status(410).send({ error: { code: 'GONE', message: 'Invalid link.' } });
    }
    return reply.redirect(dest);
  });
}
