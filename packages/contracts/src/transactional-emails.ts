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

/**
 * Whether an operator may switch this one email off, and why not (issue #89).
 *
 * Deliberately the same pair of field names `ModulePresenceSchema` uses for the
 * module axis: the two refusals are the same statement at two granularities,
 * and an admin that renders one can render the other without learning a second
 * vocabulary. The reason is the owning module's own sentence, carried from the
 * `EmailDefaultsRegistry` — no frontend holds a list of protected codes.
 */
export const transactionalEmailProtectionSchema = z.object({
  deactivatable: z.boolean(),
  nonDeactivatableReason: z.string().nullable(),
});

export const transactionalEmailSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  ownerModule: z.string(),
  group: z.string().nullable(),
  active: z.boolean(),
  languages: z.array(z.string()),
  hasGlobalOverride: z.boolean(),
  hasChannelOverride: z.boolean(),
}).extend(transactionalEmailProtectionSchema.shape);
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
}).extend(transactionalEmailProtectionSchema.shape);
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
// Per-email activation (issue #89)
// ---------------------------------------------------------------------------

/**
 * The operator's per-email on/off switch.
 *
 * The module that owns this surface is non-deactivatable (issue #88), because
 * the granularity the business wants is this one: an operator silences the
 * back-in-stock notice without silencing account verification. The read side
 * has honoured `active` since feature 047; this is the write side.
 *
 * Shaped like `ModuleActivationRequestSchema` — one boolean, stated rather than
 * toggled, so a retry lands on the state the operator asked for instead of the
 * opposite one.
 */
export const setTransactionalEmailActiveRequestSchema = z.object({ active: z.boolean() });
export type SetTransactionalEmailActiveRequest = z.infer<
  typeof setTransactionalEmailActiveRequestSchema
>;

/** The recomputed summary, so the list re-reads what the server resolved. */
export const setTransactionalEmailActiveResponseSchema = transactionalEmailSummarySchema;
export type SetTransactionalEmailActiveResponse = z.infer<
  typeof setTransactionalEmailActiveResponseSchema
>;

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
  /**
   * The channel whose content, branding and embeds apply, or `null` for the
   * platform-wide ones.
   *
   * Widened from `string` (issue #103). The sender's own resolution chain has
   * always been channel → global → default and has always spelled "global" as
   * `null`; only this input type could not say it, so `invoices` passed `''`,
   * which the settings seam guard rejects — the branding read threw, the
   * dispatcher's `catch` absorbed it, and the invoice e-mail vanished.
   */
  salesChannelId: string | null;
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
  /**
   * The business document this message delivers, when it delivers one (D-59).
   * Forwarded to the transport so the delivery record is findable by the
   * document an operator is asked about — an invoice, in the case the ruling
   * was written for — rather than only by a recipient and a message id.
   */
  document?: { type: string; id: string };
  meta?: Record<string, unknown>;
}

/**
 * Why a send did — or did not — reach the transport.
 *
 * `send` used to answer `Promise<void>` for four unrelated situations, so a
 * caller could not tell "the operator switched this email off" from "no
 * template exists for this code yet". Only the latter justifies falling back to
 * a caller's legacy in-code builder; the others mean the platform deliberately
 * sent nothing and a fallback would send mail the operator did not ask for.
 */
export type TransactionalSendOutcome =
  /** Handed to the transport. */
  | { status: 'sent' }
  /** The definition exists and an operator set `active = false`. */
  | { status: 'deactivated' }
  /** No mailer is wired in this composition — nothing can be delivered. */
  | { status: 'no_transport' }
  /** No definition for this code: the caller may use its own builder. */
  | { status: 'no_definition' };

export interface TransactionalEmailSender {
  /**
   * An implementor must say which of the four happened — reporting nothing
   * while delivering nothing is the defect this type exists to close. A
   * deployment decoration that still answers `void` stops compiling against
   * this interface, and that compile break is the intended signal.
   */
  send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome>;
}

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The rest of the in-process surface `transactional_emails` publishes
// (feature 075, Phase P). `TransactionalEmailSender` above is the first of
// them and pre-dates this section.
// ---------------------------------------------------------------------------

/** The subject and body a module ships for one of its own e-mails. */
export interface EmailDefaults {
  /** Per-language subject: `{ lang: string }`. */
  defaultSubject: Record<string, string>;
  /** Content envelope: `{ schema_version, languages: { lang: tree } }`. */
  defaultContent: Record<string, unknown>;
  /**
   * Declared exactly when this individual e-mail may never be switched off
   * (issue #89) — the per-e-mail twin of a manifest's
   * `activation.nonDeactivatable`, and named after it on purpose.
   *
   * It lives **here**, on the contribution the owning module already pushes,
   * rather than as a list in `transactional_emails` or in the admin app: only
   * the module that sends the e-mail knows whether its flow survives silence,
   * and a list anywhere else is a second source of truth that drifts the first
   * time a module adds one.
   *
   * Presence carries the "true": a shape with a separate boolean and a reason
   * has a state where the two contradict each other, and this one does not.
   */
  nonDeactivatable?: { reason: string };
}

/**
 * Container name: `emailDefaultsPort`. Owner: `transactional_emails`.
 *
 * A **contribution seam**, and the most-contributed-to one in the tree: seven
 * modules push the defaults for their own e-mails from `ctx.onBoot`, and this
 * module's boot reconciler reads the table once.
 *
 * The ordering is by construction rather than by luck — boot hooks run during
 * composition and plugin bodies only when the Fastify app is built, so every
 * contribution lands before the read. Publishing the shape must not change
 * that, and must not gate it: a gate would throw during composition, exactly
 * as `assetReferenceRegistry`'s did before it was un-gated.
 */
export interface EmailDefaultsRegistryPort {
  register(code: string, defaults: EmailDefaults, ownerModuleId: string): void;
  get(code: string): EmailDefaults | undefined;
  has(code: string): boolean;
  /** Which module contributed the code, or `undefined` when nobody did. */
  ownerOf(code: string): string | undefined;
  /** Every code and its contributor. */
  owners(): ReadonlyMap<string, string>;
  /**
   * The reason this e-mail may never be switched off, or `null` when it may.
   * The write path and the admin projection both read it, so the two never
   * disagree.
   */
  nonDeactivatableReasonOf(code: string): string | null;
}

/**
 * Container name: `templateEmailPort`. Owner: `transactional_emails`.
 *
 * `organizations` is the only cross-module consumer. `true` means "handled —
 * do not use your legacy in-code builder", and it covers three outcomes: a
 * delivered e-mail, one an operator deactivated, and a composition with no
 * transport. In all three the platform decided what to send, and a fallback
 * would either send mail the operator switched off or fail the same way. Only
 * a code with no definition at all answers `false`.
 */
export interface TemplateEmailPort {
  trySend(input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown> | undefined;
  }): Promise<boolean>;
}
