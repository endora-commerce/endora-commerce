// PWA module — feature 046 contract surface.
//
// Source-of-truth Zod schemas for the PWA module's API boundaries and internal
// ports, per Principle V. Four sections:
//   (1) Public storefront config (manifest identity + toggles + VAPID public key).
//   (2) Push subscription + message DTOs (storefront subscribe / admin send).
//   (3) Admin config + icon DTOs.
//   (4) Internal ports: PushProvider abstraction (FR-019).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Setting codes owned by the PWA module (Settings group `pwa`). */
export const PWA_SETTING_CODES = {
  APP_NAME: 'pwa.app_name',
  SHORT_NAME: 'pwa.short_name',
  THEME_COLOR: 'pwa.theme_color',
  BACKGROUND_COLOR: 'pwa.background_color',
  DISPLAY_MODE: 'pwa.display_mode',
  ICON_ASSET_ID: 'pwa.icon_asset_id',
  CACHING_ENABLED: 'pwa.caching_enabled',
  PUSH_ENABLED: 'pwa.push_enabled',
  VAPID_PUBLIC_KEY: 'pwa.vapid_public_key',
  VAPID_PRIVATE_KEY: 'pwa.vapid_private_key',
  FCM_SERVICE_ACCOUNT: 'pwa.fcm_service_account',
} as const;

export const PWA_PERMISSIONS = {
  READ: 'pwa:read',
  WRITE: 'pwa:write',
  SEND_PUSH: 'pwa:send_push',
} as const;

export const PwaDisplayModeSchema = z.enum(['standalone', 'fullscreen', 'minimal-ui']);
export type PwaDisplayMode = z.infer<typeof PwaDisplayModeSchema>;

export const PwaIconPurposeSchema = z.enum(['any', 'maskable']);
export type PwaIconPurpose = z.infer<typeof PwaIconPurposeSchema>;

/** Required derived icon sizes (px, square). 180 = apple-touch. */
export const PWA_ICON_SIZES = [180, 192, 512] as const;

/** A hex colour like `#1d4ed8`. */
const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour, e.g. #1d4ed8');

// ---------------------------------------------------------------------------
// (1) Public storefront config
// ---------------------------------------------------------------------------

export const PwaIconDescriptorSchema = z.object({
  src: z.string().min(1),
  sizes: z.string().min(1), // e.g. "512x512"
  type: z.string().min(1), // e.g. "image/png"
  purpose: PwaIconPurposeSchema.optional(),
});
export type PwaIconDescriptor = z.infer<typeof PwaIconDescriptorSchema>;

export const PwaPublicConfigSchema = z.object({
  appName: z.string().min(1),
  shortName: z.string().min(1),
  themeColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  displayMode: PwaDisplayModeSchema,
  icons: z.array(PwaIconDescriptorSchema),
  cachingEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  /** Empty string when push is disabled or VAPID is unconfigured. */
  vapidPublicKey: z.string(),
});
export type PwaPublicConfig = z.infer<typeof PwaPublicConfigSchema>;

// ---------------------------------------------------------------------------
// (2) Push subscription + message DTOs
// ---------------------------------------------------------------------------

export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().startsWith('https://', 'Endpoint must be an https URL'),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(512).optional(),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

export const PushSubscriptionDeleteSchema = z.object({
  endpoint: z.string().url(),
});
export type PushSubscriptionDelete = z.infer<typeof PushSubscriptionDeleteSchema>;

export const PushSubscriptionStatusSchema = z.enum(['active', 'invalid']);
export type PushSubscriptionStatus = z.infer<typeof PushSubscriptionStatusSchema>;

export const SubscribeResponseSchema = z.object({
  id: z.string().uuid(),
  status: PushSubscriptionStatusSchema,
});
export type SubscribeResponse = z.infer<typeof SubscribeResponseSchema>;

export const PushAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('customers'),
    customerAccountIds: z.array(z.string().uuid()).min(1),
  }),
]);
export type PushAudience = z.infer<typeof PushAudienceSchema>;

export const PushTriggerSchema = z.enum(['admin', 'order_status', 'quote_request']);
export type PushTrigger = z.infer<typeof PushTriggerSchema>;

export const PushMessageStatusSchema = z.enum(['queued', 'sending', 'sent', 'failed']);
export type PushMessageStatus = z.infer<typeof PushMessageStatusSchema>;

export const CreatePushMessageRequestSchema = z.object({
  salesChannelId: z.string().uuid(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  url: z.string().max(2048).optional(),
  iconUrl: z.string().max(2048).optional(),
  audience: PushAudienceSchema,
});
export type CreatePushMessageRequest = z.infer<typeof CreatePushMessageRequestSchema>;

export const CreatePushMessageResponseSchema = z.object({
  messageId: z.string().uuid(),
  queuedDeliveries: z.number().int().nonnegative(),
});
export type CreatePushMessageResponse = z.infer<typeof CreatePushMessageResponseSchema>;

export const PushMessageSummarySchema = z.object({
  id: z.string().uuid(),
  salesChannelId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  trigger: PushTriggerSchema,
  status: PushMessageStatusSchema,
  sentCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type PushMessageSummary = z.infer<typeof PushMessageSummarySchema>;

export const PushSubscriptionStatsSchema = z.object({
  active: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
});
export type PushSubscriptionStats = z.infer<typeof PushSubscriptionStatsSchema>;

// ---------------------------------------------------------------------------
// (3) Admin config + icon DTOs
// ---------------------------------------------------------------------------

/** Admin-readable PWA config. Secrets are reported as `*IsSet` flags only. */
export const PwaAdminConfigSchema = z.object({
  salesChannelId: z.string().uuid().nullable(), // null = global scope
  appName: z.string(),
  shortName: z.string(),
  themeColor: z.string(),
  backgroundColor: z.string(),
  displayMode: PwaDisplayModeSchema,
  iconAssetId: z.string(),
  cachingEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  vapidPublicKey: z.string(),
  vapidPrivateKeyIsSet: z.boolean(),
  fcmServiceAccountIsSet: z.boolean(),
});
export type PwaAdminConfig = z.infer<typeof PwaAdminConfigSchema>;

/** Partial update; only provided keys are written. */
export const UpdatePwaConfigRequestSchema = z
  .object({
    salesChannelId: z.string().uuid().nullable().optional(),
    appName: z.string().min(1).max(120).optional(),
    shortName: z.string().min(1).max(64).optional(),
    themeColor: HexColorSchema.optional(),
    backgroundColor: HexColorSchema.optional(),
    displayMode: PwaDisplayModeSchema.optional(),
    cachingEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    vapidPublicKey: z.string().optional(),
    vapidPrivateKey: z.string().optional(),
    fcmServiceAccount: z.string().optional(),
  })
  .strict();
export type UpdatePwaConfigRequest = z.infer<typeof UpdatePwaConfigRequestSchema>;

export const VapidKeyPairResponseSchema = z.object({
  publicKey: z.string().min(1),
});
export type VapidKeyPairResponse = z.infer<typeof VapidKeyPairResponseSchema>;

export const PwaIconRenditionSchema = z.object({
  size: z.number().int().positive(),
  purpose: PwaIconPurposeSchema,
  assetId: z.string().uuid(),
  contentHash: z.string().min(1),
});
export type PwaIconRendition = z.infer<typeof PwaIconRenditionSchema>;

export const PwaIconUploadResponseSchema = z.object({
  sourceAssetId: z.string().uuid(),
  renditions: z.array(PwaIconRenditionSchema),
});
export type PwaIconUploadResponse = z.infer<typeof PwaIconUploadResponseSchema>;

// ---------------------------------------------------------------------------
// (4) Internal ports — PushProvider abstraction (FR-019)
// ---------------------------------------------------------------------------

export interface PushSubscriptionRef {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  provider: string;
  /** Channel context — providers resolve per-channel credentials (e.g. VAPID keys) from it. */
  salesChannelId: string;
}

export interface PushPayload {
  title: string;
  body: string;
  iconUrl?: string;
  url?: string;
  tag?: string;
}

export type PushSendResult =
  | { ok: true }
  | { ok: false; gone: true }
  | { ok: false; gone: false; error: string; retryable: boolean };

export interface PushProvider {
  readonly key: string;
  isConfigured(salesChannelId: string): Promise<boolean>;
  send(sub: PushSubscriptionRef, payload: PushPayload): Promise<PushSendResult>;
}

export interface PushProviderRegistryPort {
  register(provider: PushProvider): void;
  get(key: string): PushProvider | undefined;
  resolveDefault(salesChannelId: string): Promise<PushProvider>;
}
