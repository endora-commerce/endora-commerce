// Transactional Emails — contract surface (feature 047).
//
// Source-of-truth Zod schemas + inferred types shared by backend (routes,
// reconciler, sender port) and admin (API client). Content trees are opaque
// Puck data; their email-safe component set is owned by @b2b/email-components.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Opaque Puck data tree for one language. */
export const puckDataTreeSchema = z.record(z.string(), z.unknown());
export type PuckDataTreeDto = z.infer<typeof puckDataTreeSchema>;

export const transactionalEmailCodeRe = /^[a-z][a-z0-9_]*$/;

/** A variable an email declares for substitution + preview sample data. */
export const emailVariableDescriptorSchema = z.object({
  key: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
  sampleValue: z.string().max(2000).optional(),
  description: z.string().max(500).optional(),
});
export type EmailVariableDescriptor = z.infer<typeof emailVariableDescriptorSchema>;

// ---------------------------------------------------------------------------
// Manifest declaration (consumed by ModuleManifest.transactionalEmails)
// ---------------------------------------------------------------------------

export const transactionalEmailManifestEntrySchema = z.object({
  code: z.string().regex(transactionalEmailCodeRe).max(160),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  group: z.string().max(64).optional(),
  variables: z.array(emailVariableDescriptorSchema).default([]),
});
export type TransactionalEmailManifestEntry = z.infer<typeof transactionalEmailManifestEntrySchema>;

// ---------------------------------------------------------------------------
// Definitions — list + detail
// ---------------------------------------------------------------------------

export const transactionalEmailSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  ownerModule: z.string(),
  group: z.string().nullable(),
  active: z.boolean(),
  languages: z.array(z.string()),
  hasGlobalOverride: z.boolean(),
  hasChannelOverride: z.boolean(),
});
export type TransactionalEmailSummary = z.infer<typeof transactionalEmailSummarySchema>;

export const transactionalEmailListResponseSchema = z.object({
  items: z.array(transactionalEmailSummarySchema),
});
export type TransactionalEmailListResponse = z.infer<typeof transactionalEmailListResponseSchema>;

export const resolvedEmailContentSchema = z.object({
  subject: z.string(),
  content: puckDataTreeSchema,
  source: z.enum(['channel', 'global', 'default']),
  version: z.number().int().nullable(),
});
export type ResolvedEmailContent = z.infer<typeof resolvedEmailContentSchema>;

export const transactionalEmailDetailSchema = z.object({
  code: z.string(),
  name: z.string(),
  ownerModule: z.string(),
  group: z.string().nullable(),
  description: z.string().nullable(),
  active: z.boolean(),
  languages: z.array(z.string()),
  variables: z.array(emailVariableDescriptorSchema),
  scope: z.object({ salesChannelId: z.string().nullable(), language: z.string() }),
  effective: resolvedEmailContentSchema,
  default: z.object({ subject: z.string(), content: puckDataTreeSchema }),
  hasGlobalOverride: z.boolean(),
  hasChannelOverride: z.boolean(),
});
export type TransactionalEmailDetail = z.infer<typeof transactionalEmailDetailSchema>;

export const transactionalEmailDetailQuerySchema = z.object({
  salesChannelId: z.string().uuid().optional(),
  language: z.string().min(2).max(12).optional(),
});
export type TransactionalEmailDetailQuery = z.infer<typeof transactionalEmailDetailQuerySchema>;

// ---------------------------------------------------------------------------
// Save / reset content
// ---------------------------------------------------------------------------

export const putEmailContentQuerySchema = z.object({
  salesChannelId: z.string().uuid().optional(),
  language: z.string().min(2).max(12),
});
export type PutEmailContentQuery = z.infer<typeof putEmailContentQuerySchema>;

export const putEmailContentRequestSchema = z.object({
  subject: z.string().min(1).max(500),
  content: puckDataTreeSchema,
  expectedVersion: z.number().int().optional(),
});
export type PutEmailContentRequest = z.infer<typeof putEmailContentRequestSchema>;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const previewEmailRequestSchema = z.object({
  salesChannelId: z.string().uuid().optional(),
  language: z.string().min(2).max(12).optional(),
  draftSubject: z.string().max(500).optional(),
  draftContent: puckDataTreeSchema.optional(),
});
export type PreviewEmailRequest = z.infer<typeof previewEmailRequestSchema>;

export const previewEmailResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type PreviewEmailResponse = z.infer<typeof previewEmailResponseSchema>;

// ---------------------------------------------------------------------------
// Reusable blocks & templates
// ---------------------------------------------------------------------------

export const emailBlockSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  isSystem: z.boolean(),
  scope: z.enum(['global', 'channel']),
  languages: z.array(z.string()),
  version: z.number().int(),
});
export type EmailBlockSummary = z.infer<typeof emailBlockSummarySchema>;

export const emailBlockDetailSchema = emailBlockSummarySchema.extend({
  description: z.string().nullable(),
  content: z.record(z.string(), puckDataTreeSchema),
  salesChannelIds: z.array(z.string()),
});
export type EmailBlockDetail = z.infer<typeof emailBlockDetailSchema>;

export const createEmailBlockRequestSchema = z.object({
  code: z.string().min(1).max(180),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  salesChannelIds: z.array(z.string().uuid()).optional(),
  languages: z.array(z.string().min(2).max(12)).min(1),
});
export type CreateEmailBlockRequest = z.infer<typeof createEmailBlockRequestSchema>;

export const patchEmailBlockRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
    salesChannelIds: z.array(z.string().uuid()).optional(),
    expectedVersion: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type PatchEmailBlockRequest = z.infer<typeof patchEmailBlockRequestSchema>;

export const putEmailBlockContentRequestSchema = z.object({
  content: puckDataTreeSchema,
  expectedVersion: z.number().int(),
});
export type PutEmailBlockContentRequest = z.infer<typeof putEmailBlockContentRequestSchema>;

// Templates reuse the block surface, minus the `active` flag.
export const emailTemplateSummarySchema = emailBlockSummarySchema.omit({ active: true });
export type EmailTemplateSummary = z.infer<typeof emailTemplateSummarySchema>;

export const emailTemplateDetailSchema = emailBlockDetailSchema.omit({ active: true });
export type EmailTemplateDetail = z.infer<typeof emailTemplateDetailSchema>;

export const createEmailTemplateRequestSchema = createEmailBlockRequestSchema.omit({ active: true });
export type CreateEmailTemplateRequest = z.infer<typeof createEmailTemplateRequestSchema>;

export const patchEmailTemplateRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    salesChannelIds: z.array(z.string().uuid()).optional(),
    expectedVersion: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type PatchEmailTemplateRequest = z.infer<typeof patchEmailTemplateRequestSchema>;

// ---------------------------------------------------------------------------
// Branding (per scope) — wraps Settings
// ---------------------------------------------------------------------------

export const emailBrandingSchema = z.object({
  salesChannelId: z.string().nullable(),
  logoAssetId: z.string(),
  logoUrl: z.string(),
  accentColor: z.string(),
  headerBlockCode: z.string(),
  footerBlockCode: z.string(),
  source: z.enum(['channel', 'global', 'default']),
});
export type EmailBranding = z.infer<typeof emailBrandingSchema>;

export const putEmailBrandingRequestSchema = z
  .object({
    logoAssetId: z.string().optional(),
    accentColor: z.string().max(32).optional(),
    headerBlockCode: z.string().max(180).optional(),
    footerBlockCode: z.string().max(180).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type PutEmailBrandingRequest = z.infer<typeof putEmailBrandingRequestSchema>;

export const emailScopeQuerySchema = z.object({
  salesChannelId: z.string().uuid().optional(),
});
export type EmailScopeQuery = z.infer<typeof emailScopeQuerySchema>;

// ---------------------------------------------------------------------------
// Email page-builder descriptor (email-safe palette)
// ---------------------------------------------------------------------------

export const emailPageBuilderDescriptorSchema = z.object({
  schemaVersion: z.number().int(),
  components: z.array(
    z.object({
      name: z.string(),
      previewIcon: z.string().optional(),
    }),
  ),
});
export type EmailPageBuilderDescriptor = z.infer<typeof emailPageBuilderDescriptorSchema>;

// ---------------------------------------------------------------------------
// Sender port (interface only — provided by the transactional_emails module,
// consumed by owning modules through composition). Not an HTTP contract.
// ---------------------------------------------------------------------------

export interface TransactionalEmailSendInput {
  code: string;
  salesChannelId: string;
  language: string;
  to: string;
  variables: Record<string, unknown>;
  /** Idempotency key — preserve the per-email message id used today. */
  messageId: string;
  /**
   * Optional binary attachments (feature 047 invoices — PDF delivery). Uses
   * `Uint8Array` (not Node's `Buffer`) so this shared contract stays
   * browser-safe for the api-client; a backend `Buffer` satisfies it.
   */
  attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }>;
  meta?: Record<string, unknown>;
}

export interface TransactionalEmailSender {
  send(input: TransactionalEmailSendInput): Promise<void>;
}
