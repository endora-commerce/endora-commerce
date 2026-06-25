import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import webpush from 'web-push';
import { z } from 'zod';
import {
  PWA_PERMISSIONS,
  PWA_SETTING_CODES,
  CreatePushMessageRequestSchema,
  UpdatePwaConfigRequestSchema,
} from '@b2b/contracts';
import type { PwaConfigResolver } from './services/pwa-config-resolver.js';
import { PwaIconInvalid, type PwaIconService } from './services/pwa-icon-service.js';
import type { PushSubscriptionService } from './services/push-subscription-service.js';
import type { PushMessageService } from './services/push-message-service.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface AdminAuditContext {
  actorAdminUserId: string | null;
}

/** Write port over SettingsAdminService (global vs per-channel value writes). */
export interface SettingsWritePort {
  setValueForAllChannels(
    code: string,
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<unknown>;
  setValueForSubset(
    code: string,
    channelCodes: string[],
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<unknown>;
}

const StringSchema = z.string();
const BoolSchema = z.boolean();

export interface PwaAdminRoutesDeps {
  requireAdmin: RequireAdminFactory;
  configResolver: PwaConfigResolver;
  iconService: PwaIconService;
  subscriptionService: PushSubscriptionService;
  messageService: PushMessageService;
  settingsWrite: SettingsWritePort;
  settingsRead: { get<T>(code: string, channelId: string, schema: z.ZodType<T>): Promise<T> };
  /** Resolve a salesChannelId query value (or null) to the channel id to read/write. */
  resolveScopeChannelId: (salesChannelId: string | null) => Promise<string>;
  /** Map a channel id to its code (subset writes are keyed by code). */
  channelCodeForId: (channelId: string) => Promise<string | null>;
  resolveAuditContext: (request: FastifyRequest) => AdminAuditContext;
}

export async function registerPwaAdminRoutes(
  app: FastifyInstance,
  deps: PwaAdminRoutesDeps,
): Promise<void> {
  const readGate = deps.requireAdmin(PWA_PERMISSIONS.READ);
  const writeGate = deps.requireAdmin(PWA_PERMISSIONS.WRITE);
  const sendGate = deps.requireAdmin(PWA_PERMISSIONS.SEND_PUSH);

  const safeGet = async (code: string, channelId: string, fallback = ''): Promise<string> => {
    try {
      return await deps.settingsRead.get(code, channelId, StringSchema);
    } catch {
      return fallback;
    }
  };
  const safeBool = async (code: string, channelId: string): Promise<boolean> => {
    try {
      return await deps.settingsRead.get(code, channelId, BoolSchema);
    } catch {
      return false;
    }
  };

  // GET /admin/pwa/config — effective config + secret isSet flags.
  app.get<{ Querystring: { salesChannelId?: string } }>(
    '/api/v1/admin/pwa/config',
    { preHandler: readGate },
    async (request, reply) => {
      const salesChannelId = request.query.salesChannelId ?? null;
      const channelId = await deps.resolveScopeChannelId(salesChannelId);
      const [appName, shortName, themeColor, backgroundColor, displayMode, iconAssetId, vapidPublicKey, vapidPrivate, fcm] =
        await Promise.all([
          safeGet(PWA_SETTING_CODES.APP_NAME, channelId, 'B2B Platform'),
          safeGet(PWA_SETTING_CODES.SHORT_NAME, channelId, 'B2B'),
          safeGet(PWA_SETTING_CODES.THEME_COLOR, channelId, '#1d4ed8'),
          safeGet(PWA_SETTING_CODES.BACKGROUND_COLOR, channelId, '#fafafa'),
          safeGet(PWA_SETTING_CODES.DISPLAY_MODE, channelId, 'standalone'),
          safeGet(PWA_SETTING_CODES.ICON_ASSET_ID, channelId, ''),
          safeGet(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, channelId, ''),
          safeGet(PWA_SETTING_CODES.VAPID_PRIVATE_KEY, channelId, ''),
          safeGet(PWA_SETTING_CODES.FCM_SERVICE_ACCOUNT, channelId, ''),
        ]);
      const [cachingEnabled, pushEnabled] = await Promise.all([
        safeBool(PWA_SETTING_CODES.CACHING_ENABLED, channelId),
        safeBool(PWA_SETTING_CODES.PUSH_ENABLED, channelId),
      ]);
      return reply.send({
        salesChannelId,
        appName,
        shortName,
        themeColor,
        backgroundColor,
        displayMode,
        iconAssetId,
        cachingEnabled,
        pushEnabled,
        vapidPublicKey,
        vapidPrivateKeyIsSet: vapidPrivate.length > 0,
        fcmServiceAccountIsSet: fcm.length > 0,
      });
    },
  );

  // PUT /admin/pwa/config — write a subset of settings for global or a channel.
  app.put('/api/v1/admin/pwa/config', { preHandler: writeGate }, async (request, reply) => {
    const body = UpdatePwaConfigRequestSchema.parse(request.body);
    const actor = deps.resolveAuditContext(request);
    const salesChannelId = body.salesChannelId ?? null;

    const writes: Array<{ code: string; value: unknown }> = [];
    if (body.appName !== undefined) writes.push({ code: PWA_SETTING_CODES.APP_NAME, value: body.appName });
    if (body.shortName !== undefined) writes.push({ code: PWA_SETTING_CODES.SHORT_NAME, value: body.shortName });
    if (body.themeColor !== undefined) writes.push({ code: PWA_SETTING_CODES.THEME_COLOR, value: body.themeColor });
    if (body.backgroundColor !== undefined) writes.push({ code: PWA_SETTING_CODES.BACKGROUND_COLOR, value: body.backgroundColor });
    if (body.displayMode !== undefined) writes.push({ code: PWA_SETTING_CODES.DISPLAY_MODE, value: body.displayMode });
    if (body.cachingEnabled !== undefined) writes.push({ code: PWA_SETTING_CODES.CACHING_ENABLED, value: body.cachingEnabled });
    if (body.pushEnabled !== undefined) writes.push({ code: PWA_SETTING_CODES.PUSH_ENABLED, value: body.pushEnabled });
    if (body.vapidPublicKey !== undefined) writes.push({ code: PWA_SETTING_CODES.VAPID_PUBLIC_KEY, value: body.vapidPublicKey });
    if (body.vapidPrivateKey !== undefined) writes.push({ code: PWA_SETTING_CODES.VAPID_PRIVATE_KEY, value: body.vapidPrivateKey });
    if (body.fcmServiceAccount !== undefined) writes.push({ code: PWA_SETTING_CODES.FCM_SERVICE_ACCOUNT, value: body.fcmServiceAccount });

    const channelCode = salesChannelId ? await deps.channelCodeForId(salesChannelId) : null;
    for (const w of writes) {
      if (channelCode) {
        await deps.settingsWrite.setValueForSubset(w.code, [channelCode], w.value, null, actor);
      } else {
        await deps.settingsWrite.setValueForAllChannels(w.code, w.value, null, actor);
      }
    }
    return reply.send({ updated: writes.length });
  });

  // POST /admin/pwa/vapid/generate — generate + persist a VAPID key pair.
  app.post('/api/v1/admin/pwa/vapid/generate', { preHandler: writeGate }, async (request, reply) => {
    const actor = deps.resolveAuditContext(request);
    const keys = webpush.generateVAPIDKeys();
    await deps.settingsWrite.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, keys.publicKey, null, actor);
    await deps.settingsWrite.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PRIVATE_KEY, keys.privateKey, null, actor);
    return reply.send({ publicKey: keys.publicKey });
  });

  // POST /admin/pwa/icon — multipart source upload + sharp rendition derivation.
  app.post<{ Querystring: { salesChannelId?: string } }>(
    '/api/v1/admin/pwa/icon',
    { preHandler: writeGate },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.code(400).send({ error: { code: 'PWA_ICON_INVALID', message: 'Upload requires multipart/form-data with a `file` part.' } });
      }
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: { code: 'PWA_ICON_INVALID', message: 'Missing `file` part.' } });
      }
      const buffer = await file.toBuffer();
      const salesChannelId = request.query.salesChannelId ?? null;
      try {
        const result = await deps.iconService.ingest({
          salesChannelId,
          declaredMime: file.mimetype,
          buffer,
        });
        // Record the source asset id on the channel/global config.
        const actor = deps.resolveAuditContext(request);
        const channelCode = salesChannelId ? await deps.channelCodeForId(salesChannelId) : null;
        if (channelCode) {
          await deps.settingsWrite.setValueForSubset(PWA_SETTING_CODES.ICON_ASSET_ID, [channelCode], result.sourceAssetId, null, actor);
        } else {
          await deps.settingsWrite.setValueForAllChannels(PWA_SETTING_CODES.ICON_ASSET_ID, result.sourceAssetId, null, actor);
        }
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof PwaIconInvalid) {
          return reply.code(400).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    },
  );

  // GET /admin/pwa/subscriptions — subscriber counts for a channel.
  app.get<{ Querystring: { salesChannelId?: string } }>(
    '/api/v1/admin/pwa/subscriptions',
    { preHandler: readGate },
    async (request, reply) => {
      const channelId = await deps.resolveScopeChannelId(request.query.salesChannelId ?? null);
      const stats = await deps.subscriptionService.statsForChannel(channelId);
      return reply.send(stats);
    },
  );

  // POST /admin/pwa/messages — admin-initiated send (FR-024).
  app.post('/api/v1/admin/pwa/messages', { preHandler: sendGate }, async (request, reply) => {
    const body = CreatePushMessageRequestSchema.parse(request.body);
    const config = await deps.configResolver.getPublicConfig(body.salesChannelId);
    if (!config.pushEnabled || !config.vapidPublicKey) {
      return reply.code(503).send({ error: { code: 'PWA_PUSH_UNCONFIGURED', message: 'Push is not configured for this channel.' } });
    }
    const actor = deps.resolveAuditContext(request);
    const result = await deps.messageService.createAndEnqueue({
      salesChannelId: body.salesChannelId,
      title: body.title,
      body: body.body,
      url: body.url ?? null,
      iconUrl: body.iconUrl ?? null,
      audience: body.audience,
      trigger: 'admin',
      createdByAdminUserId: actor.actorAdminUserId,
    });
    return reply.code(202).send(result);
  });
}
