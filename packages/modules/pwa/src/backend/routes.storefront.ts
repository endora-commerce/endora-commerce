import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  PushSubscriptionInputSchema,
  PushSubscriptionDeleteSchema,
  type PwaIconPurpose,
} from '@endora-commerce/contracts';
import type { PwaConfigResolver } from './services/pwa-config-resolver.js';
import type { PwaIconService } from './services/pwa-icon-service.js';
import type { PushSubscriptionService } from './services/push-subscription-service.js';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

export interface PwaStorefrontRoutesDeps {
  configResolver: PwaConfigResolver;
  iconService: PwaIconService;
  subscriptionService: PushSubscriptionService;
  /** Resolve the request's channel code (header) to a channel id, with system-default fallback. */
  /** `null` = no channel for this request; the config is read platform-wide. */
  resolveChannelId: (code: string | undefined) => Promise<string | null>;
  /** Resolve a stored asset id to a servable URL (assets_library). */
  resolveAssetUrl: (assetId: string) => Promise<string | null>;
  /** Resolve the logged-in customer account id from the request, or null when anonymous. */
  resolveCustomerAccountId?: (request: FastifyRequest) => Promise<string | null>;
}

export async function registerPwaStorefrontRoutes(
  app: FastifyInstance,
  deps: PwaStorefrontRoutesDeps,
): Promise<void> {
  // GET config — manifest identity + toggles + public VAPID key (FR-001/011).
  app.get('/api/v1/storefront/pwa/config', async (request, reply) => {
    const channelId = getResolvedChannel(request).id;
    const config = await deps.configResolver.getPublicConfig(channelId);
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send(config);
  });

  // GET icon rendition — redirect to the stored asset URL (FR-005).
  app.get<{ Params: { spec: string } }>(
    '/api/v1/storefront/pwa/icons/:spec',
    async (request, reply) => {
      const match = /^(\d+)-(any|maskable)\.png$/.exec(request.params.spec);
      if (!match) return reply.code(404).send();
      const size = Number(match[1]);
      const purpose = match[2] as PwaIconPurpose;
      const channelId = getResolvedChannel(request).id;
      const assetId = await deps.iconService.resolveRenditionAssetId(channelId, size, purpose);
      if (!assetId) return reply.code(404).send();
      const url = await deps.resolveAssetUrl(assetId);
      if (!url) return reply.code(404).send();
      return reply.redirect(url, 302);
    },
  );

  // POST subscribe — register (upsert) a Web-Push subscription (FR-017).
  app.post('/api/v1/storefront/pwa/subscriptions', async (request, reply) => {
    const channelId = getResolvedChannel(request).id;
    const config = await deps.configResolver.getPublicConfig(channelId);
    if (!config.pushEnabled) {
      return reply.code(403).send({ error: { code: 'PWA_PUSH_DISABLED', message: 'Push is disabled for this channel.' } });
    }
    if (!config.vapidPublicKey) {
      return reply.code(503).send({ error: { code: 'PWA_PUSH_UNCONFIGURED', message: 'Push is not configured.' } });
    }
    const body = PushSubscriptionInputSchema.parse(request.body);
    const customerAccountId = deps.resolveCustomerAccountId
      ? await deps.resolveCustomerAccountId(request)
      : null;
    const result = await deps.subscriptionService.register({
      ...body,
      salesChannelId: channelId,
      customerAccountId,
    });
    return reply.code(result.created ? 201 : 200).send({ id: result.id, status: result.status });
  });

  // DELETE subscribe — revoke (FR-018). Idempotent.
  app.delete('/api/v1/storefront/pwa/subscriptions', async (request, reply) => {
    const body = PushSubscriptionDeleteSchema.parse(request.body);
    await deps.subscriptionService.revoke(body.endpoint);
    return reply.code(204).send();
  });
}
