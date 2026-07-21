// Newsletter module — feature 048 contract surface.
//
// Holds the Zod request/response schemas (admin + storefront + self), the
// subscriber/tag/campaign/automation DTOs, the provider configuration shape,
// and the `NewsletterSendProvider` port other newsletter services implement.
// Email content reuses the transactional-emails `puckDataTreeSchema` so the
// shared `@b2b/email-components` renderer can render both identically.

import { z } from 'zod';
import { puckDataTreeSchema } from './transactional-emails.js';

// ---------------------------------------------------------------------------
// (1) Enumerations
// ---------------------------------------------------------------------------

export const newsletterOptInModeSchema = z.enum(['single', 'double']);
export type NewsletterOptInMode = z.infer<typeof newsletterOptInModeSchema>;

export const subscriberStatusSchema = z.enum([
  'pending',
  'active',
  'unsubscribed',
  'deactivated',
]);
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;

export const suppressionReasonSchema = z.enum(['unsubscribe', 'bounce', 'complaint']);
export type SuppressionReason = z.infer<typeof suppressionReasonSchema>;

export const customFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'date']);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const campaignTargetTypeSchema = z.enum(['all', 'group', 'tag', 'tag_list']);
export type CampaignTargetType = z.infer<typeof campaignTargetTypeSchema>;

export const campaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled',
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const automationStatusSchema = z.enum(['draft', 'active', 'paused']);
export type AutomationStatus = z.infer<typeof automationStatusSchema>;

export const automationTriggerTypeSchema = z.enum(['all', 'tag', 'tag_list']);
export type AutomationTriggerType = z.infer<typeof automationTriggerTypeSchema>;

export const reentryPolicySchema = z.enum(['once', 'every_trigger']);
export type ReentryPolicy = z.infer<typeof reentryPolicySchema>;

export const sendRecordStatusSchema = z.enum([
  'queued',
  'sent',
  'failed',
  'bounced',
  'complained',
]);
export type SendRecordStatus = z.infer<typeof sendRecordStatusSchema>;

// A single email value — `customFields` values are scalar-only by design.
export const customFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

const emailSchema = z.string().trim().toLowerCase().email().max(320);

// ---------------------------------------------------------------------------
// (2) Tags & custom fields
// ---------------------------------------------------------------------------

export const newsletterTagSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable(),
});
export type NewsletterTag = z.infer<typeof newsletterTagSchema>;

export const createNewsletterTagRequestSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
});
export type CreateNewsletterTagRequest = z.infer<typeof createNewsletterTagRequestSchema>;

export const updateNewsletterTagRequestSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type UpdateNewsletterTagRequest = z.infer<typeof updateNewsletterTagRequestSchema>;

export const newsletterCustomFieldSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  type: customFieldTypeSchema,
});
export type NewsletterCustomField = z.infer<typeof newsletterCustomFieldSchema>;

export const createNewsletterCustomFieldRequestSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(160),
  type: customFieldTypeSchema,
});
export type CreateNewsletterCustomFieldRequest = z.infer<
  typeof createNewsletterCustomFieldRequestSchema
>;

export const updateNewsletterCustomFieldRequestSchema = z.object({
  label: z.string().min(1).max(160).optional(),
});
export type UpdateNewsletterCustomFieldRequest = z.infer<
  typeof updateNewsletterCustomFieldRequestSchema
>;

// ---------------------------------------------------------------------------
// (3) Subscribers
// ---------------------------------------------------------------------------

export const subscriberSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  status: subscriberStatusSchema,
  source: z.string().nullable(),
  salesChannelId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  consentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type SubscriberSummary = z.infer<typeof subscriberSummarySchema>;

export const subscriberDetailSchema = subscriberSummarySchema.extend({
  customerAccountId: z.string().uuid().nullable(),
  customFields: z.record(z.string(), customFieldValueSchema),
  confirmedAt: z.string().datetime().nullable(),
  unsubscribedAt: z.string().datetime().nullable(),
  unsubscribeReason: z.string().nullable(),
  deactivatedAt: z.string().datetime().nullable(),
  version: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type SubscriberDetail = z.infer<typeof subscriberDetailSchema>;

export const subscriberListResponseSchema = z.object({
  items: z.array(subscriberSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type SubscriberListResponse = z.infer<typeof subscriberListResponseSchema>;

export const createSubscriberRequestSchema = z.object({
  email: emailSchema,
  tags: z.array(z.string().min(1)).optional(),
  customFields: z.record(z.string(), customFieldValueSchema).optional(),
  source: z.string().max(64).optional(),
  salesChannelId: z.string().uuid().optional(),
});
export type CreateSubscriberRequest = z.infer<typeof createSubscriberRequestSchema>;

export const patchSubscriberRequestSchema = z.object({
  tags: z.array(z.string().min(1)).optional(),
  customFields: z.record(z.string(), customFieldValueSchema).optional(),
  expectedVersion: z.number().int(),
});
export type PatchSubscriberRequest = z.infer<typeof patchSubscriberRequestSchema>;

export const unsubscribeSubscriberRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
  expectedVersion: z.number().int(),
});
export type UnsubscribeSubscriberRequest = z.infer<typeof unsubscribeSubscriberRequestSchema>;

export const subscriberListQuerySchema = z.object({
  status: subscriberStatusSchema.optional(),
  tag: z.string().optional(),
  channel: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
export type SubscriberListQuery = z.infer<typeof subscriberListQuerySchema>;

// ---------------------------------------------------------------------------
// (4) Campaigns
// ---------------------------------------------------------------------------

export const campaignSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subject: z.string(),
  status: campaignStatusSchema,
  targetType: campaignTargetTypeSchema,
  scheduledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

export const campaignStatsSchema = z.object({
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  opened: z.number().int(),
  clicked: z.number().int(),
  openRate: z.number(),
  clickRate: z.number(),
  perLinkClicks: z.array(z.object({ url: z.string(), clicks: z.number().int() })),
});
export type CampaignStats = z.infer<typeof campaignStatsSchema>;

export const campaignDetailSchema = campaignSummarySchema.extend({
  content: puckDataTreeSchema,
  salesChannelId: z.string().uuid().nullable(),
  language: z.string(),
  targetTagIds: z.array(z.string().uuid()),
  trackingEnabled: z.boolean(),
  audienceEstimate: z.number().int().nullable(),
  stats: campaignStatsSchema.nullable(),
  version: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

export const createCampaignRequestSchema = z.object({
  name: z.string().min(1).max(200),
  salesChannelId: z.string().uuid().optional(),
  language: z.string().min(2).max(12),
  subject: z.string().min(1),
  content: puckDataTreeSchema,
  targetType: campaignTargetTypeSchema,
  targetTagIds: z.array(z.string().uuid()).optional(),
  trackingEnabled: z.boolean().optional(),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

export const updateCampaignRequestSchema = createCampaignRequestSchema.partial().extend({
  expectedVersion: z.number().int(),
});
export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

export const setCampaignGroupRequestSchema = z.object({
  subscriberIds: z.array(z.string().uuid()),
});
export type SetCampaignGroupRequest = z.infer<typeof setCampaignGroupRequestSchema>;

export const sendCampaignRequestSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  expectedVersion: z.number().int(),
});
export type SendCampaignRequest = z.infer<typeof sendCampaignRequestSchema>;

export const previewCampaignRequestSchema = z.object({
  subscriberId: z.string().uuid().optional(),
});
export type PreviewCampaignRequest = z.infer<typeof previewCampaignRequestSchema>;

export const renderedEmailSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type RenderedEmail = z.infer<typeof renderedEmailSchema>;

// ---------------------------------------------------------------------------
// (5) Automations
// ---------------------------------------------------------------------------

export const automationSendStepSchema = z.object({
  type: z.literal('send'),
  subject: z.string().min(1),
  content: puckDataTreeSchema,
});
export const automationWaitStepSchema = z.object({
  type: z.literal('wait'),
  days: z.number().int().positive().max(365),
});
export const automationStepSchema = z.discriminatedUnion('type', [
  automationSendStepSchema,
  automationWaitStepSchema,
]);
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: automationStatusSchema,
  triggerType: automationTriggerTypeSchema,
  stepCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AutomationSummary = z.infer<typeof automationSummarySchema>;

export const automationDetailSchema = automationSummarySchema.extend({
  triggerTagIds: z.array(z.string().uuid()),
  salesChannelId: z.string().uuid().nullable(),
  language: z.string(),
  reentryPolicy: reentryPolicySchema,
  steps: z.array(automationStepSchema),
  version: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type AutomationDetail = z.infer<typeof automationDetailSchema>;

export const createAutomationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: automationTriggerTypeSchema,
  triggerTagIds: z.array(z.string().uuid()).optional(),
  salesChannelId: z.string().uuid().optional(),
  language: z.string().min(2).max(12),
  reentryPolicy: reentryPolicySchema.default('once'),
  steps: z.array(automationStepSchema),
});
export type CreateAutomationRequest = z.infer<typeof createAutomationRequestSchema>;

export const updateAutomationRequestSchema = createAutomationRequestSchema.partial().extend({
  expectedVersion: z.number().int(),
});
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>;

export const automationActionRequestSchema = z.object({
  expectedVersion: z.number().int(),
});
export type AutomationActionRequest = z.infer<typeof automationActionRequestSchema>;

// ---------------------------------------------------------------------------
// (6) Email blocks (reusable, module-owned)
// ---------------------------------------------------------------------------

export const newsletterEmailBlockSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  isSystem: z.boolean(),
});
export type NewsletterEmailBlockSummary = z.infer<typeof newsletterEmailBlockSummarySchema>;

export const newsletterEmailBlockDetailSchema = newsletterEmailBlockSummarySchema.extend({
  description: z.string().nullable(),
  content: puckDataTreeSchema,
  salesChannelId: z.string().uuid().nullable(),
  version: z.number().int(),
});
export type NewsletterEmailBlockDetail = z.infer<typeof newsletterEmailBlockDetailSchema>;

export const createNewsletterEmailBlockRequestSchema = z.object({
  code: z.string().min(1).max(180),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  content: puckDataTreeSchema,
  salesChannelId: z.string().uuid().optional(),
});
export type CreateNewsletterEmailBlockRequest = z.infer<
  typeof createNewsletterEmailBlockRequestSchema
>;

export const updateNewsletterEmailBlockRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  content: puckDataTreeSchema.optional(),
  active: z.boolean().optional(),
  expectedVersion: z.number().int(),
});
export type UpdateNewsletterEmailBlockRequest = z.infer<
  typeof updateNewsletterEmailBlockRequestSchema
>;

// ---------------------------------------------------------------------------
// (7) Provider configuration
// ---------------------------------------------------------------------------

/**
 * Feature 058 — the SMTP connection + credentials now live in a reusable
 * `email_adapter` credential configuration referenced by the
 * `newsletter.email_credentials` setting (managed on the Credentials / Settings
 * screen). This surface manages only the non-credential sender + throttle
 * config.
 */
export const providerConfigSchema = z.object({
  sender: z.object({
    fromEmail: z.string(),
    fromName: z.string(),
  }),
  rateLimitPerSecond: z.number().int().positive(),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const putProviderRequestSchema = z.object({
  sender: z.object({
    fromEmail: z.string().email(),
    fromName: z.string().max(200),
  }),
  rateLimitPerSecond: z.number().int().positive().max(1000),
});
export type PutProviderRequest = z.infer<typeof putProviderRequestSchema>;

export const testProviderRequestSchema = z.object({
  to: z.string().email().optional(),
});
export type TestProviderRequest = z.infer<typeof testProviderRequestSchema>;

export const testProviderResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TestProviderResponse = z.infer<typeof testProviderResponseSchema>;

// ---------------------------------------------------------------------------
// (8) Storefront (public) + self
// ---------------------------------------------------------------------------

export const newsletterStatusResponseSchema = z.object({
  enabled: z.boolean(),
  optInMode: newsletterOptInModeSchema,
});
export type NewsletterStatusResponse = z.infer<typeof newsletterStatusResponseSchema>;

export const newsletterSubscribeRequestSchema = z.object({
  email: emailSchema,
  channelCode: z.string().min(1).max(32),
  tags: z.array(z.string().min(1)).optional(),
  customFields: z.record(z.string(), customFieldValueSchema).optional(),
  source: z.string().max(64).optional(),
});
export type NewsletterSubscribeRequest = z.infer<typeof newsletterSubscribeRequestSchema>;

export const newsletterSubscribeResponseSchema = z.object({
  status: z.enum(['pending', 'active']),
});
export type NewsletterSubscribeResponse = z.infer<typeof newsletterSubscribeResponseSchema>;

export const publicUnsubscribeRequestSchema = z.object({
  token: z.string().min(1),
  reason: z.string().max(2000).optional(),
});
export type PublicUnsubscribeRequest = z.infer<typeof publicUnsubscribeRequestSchema>;

export const selfNewsletterStatusSchema = z.object({
  subscribed: z.boolean(),
  status: subscriberStatusSchema.nullable(),
  tags: z.array(z.object({ code: z.string(), name: z.string() })),
  canManage: z.literal(true),
});
export type SelfNewsletterStatus = z.infer<typeof selfNewsletterStatusSchema>;

export const selfSubscribeRequestSchema = z.object({
  tags: z.array(z.string().min(1)).optional(),
  customFields: z.record(z.string(), customFieldValueSchema).optional(),
});
export type SelfSubscribeRequest = z.infer<typeof selfSubscribeRequestSchema>;

export const selfUnsubscribeRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type SelfUnsubscribeRequest = z.infer<typeof selfUnsubscribeRequestSchema>;

// ---------------------------------------------------------------------------
// (9) Send provider port (TypeScript interfaces — implemented in the backend)
// ---------------------------------------------------------------------------

export interface NewsletterSendMessage {
  to: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  html: string;
  text: string;
  /** Stable idempotency key = the send-record id. */
  messageId: string;
  headers?: Record<string, string>;
}

export interface NewsletterSendProvider {
  send(msg: NewsletterSendMessage): Promise<{ providerMessageId?: string }>;
  verify(): Promise<{ ok: true } | { ok: false; error: string }>;
}

// ---------------------------------------------------------------------------
// (10) Setting codes (shared between manifest + services)
// ---------------------------------------------------------------------------

export const NEWSLETTER_SETTING_CODES = {
  OPT_IN_MODE: 'newsletter.opt_in_mode',
  CONFIRM_TTL_HOURS: 'newsletter.confirm_ttl_hours',
  // Feature 058 — the single email credential source: a reusable `email_adapter`
  // credential configuration (SMTP host/port/secure/username/password).
  EMAIL_CREDENTIALS: 'newsletter.email_credentials',
  SENDER_FROM_EMAIL: 'newsletter.sender.from_email',
  SENDER_FROM_NAME: 'newsletter.sender.from_name',
  RATE_LIMIT_PER_SECOND: 'newsletter.rate_limit_per_second',
} as const;
