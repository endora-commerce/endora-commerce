import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Quote Requests (RFQ) module contracts — Source of truth per Principle V.
 * See specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md.
 */

export const rfqStatusSchema = z.enum([
  'draft',
  'new',
  'under_review',
  'quoted',
  'accepted',
  'rejected',
  'expired',
]);
export type RfqStatus = z.infer<typeof rfqStatusSchema>;

export const quoteTermsSchema = z.object({
  leadTimeDays: z.number().int().nonnegative().nullable(),
  validityDays: z.number().int().positive().nullable(),
  deliveryTerms: z.string().nullable(),
  remarks: z.string().nullable(),
});
export type QuoteTerms = z.infer<typeof quoteTermsSchema>;

export const quoteRequestItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  variantId: uuidSchema.nullable(),
  variantLabel: z.string().nullable(),
  quantity: z.number().int().positive(),
  requesterNote: z.string().nullable(),
  quotedUnitPrice: z.number().finite().nullable(),
  quotedDiscountPercent: z.number().finite().nullable(),
});
export type QuoteRequestItem = z.infer<typeof quoteRequestItemSchema>;

export const quoteRequestSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  customerAccountId: uuidSchema,
  assignedAdminUserId: uuidSchema.nullable().optional(),
  status: rfqStatusSchema,
  requesterNote: z.string().nullable(),
  items: z.array(quoteRequestItemSchema),
  quoteTerms: quoteTermsSchema.nullable(),
  submittedAt: isoDateTimeSchema.nullable(),
  quotedAt: isoDateTimeSchema.nullable(),
  respondedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().nonnegative(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

// --- Requests ----------------------------------------------------------------

export const addRfqItemRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
  requesterNote: z.string().max(2000).optional(),
});
export type AddRfqItemRequest = z.infer<typeof addRfqItemRequestSchema>;

export const updateRfqItemRequestSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    requesterNote: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateRfqItemRequest = z.infer<typeof updateRfqItemRequestSchema>;

export const submitRfqRequestSchema = z
  .object({
    requesterNote: z.string().max(4000).optional(),
  })
  .strict();
export type SubmitRfqRequest = z.infer<typeof submitRfqRequestSchema>;

export const acceptRfqRequestSchema = z
  .object({
    notes: z.string().max(4000).optional(),
  })
  .strict();
export type AcceptRfqRequest = z.infer<typeof acceptRfqRequestSchema>;

export const rejectRfqRequestSchema = z.object({
  reason: z.enum(['price', 'terms', 'other']),
  message: z.string().max(4000).optional(),
  requestChanges: z.boolean().optional(),
});
export type RejectRfqRequest = z.infer<typeof rejectRfqRequestSchema>;

export const convertRfqRequestSchema = z.object({
  deliveryAddressId: uuidSchema,
  billingAddressId: uuidSchema,
  deliveryMethodId: uuidSchema,
  paymentMethodId: uuidSchema,
});
export type ConvertRfqRequest = z.infer<typeof convertRfqRequestSchema>;

export const sendQuoteRequestItemSchema = z.object({
  itemId: uuidSchema,
  quotedUnitPrice: z.number().finite().nonnegative(),
  quotedDiscountPercent: z.number().finite().min(0).max(100).optional(),
});
export type SendQuoteRequestItem = z.infer<typeof sendQuoteRequestItemSchema>;

export const sendQuoteRequestSchema = z.object({
  items: z.array(sendQuoteRequestItemSchema).min(1),
  terms: z.object({
    leadTimeDays: z.number().int().nonnegative(),
    validityDays: z.number().int().positive(),
    deliveryTerms: z.string().max(4000).optional(),
    remarks: z.string().max(4000).optional(),
  }),
});
export type SendQuoteRequest = z.infer<typeof sendQuoteRequestSchema>;

export const declineRfqRequestSchema = z.object({
  message: z.string().max(4000),
});
export type DeclineRfqRequest = z.infer<typeof declineRfqRequestSchema>;

export const claimRfqResponseSchema = z.object({
  quoteRequest: quoteRequestSchema,
});
export type ClaimRfqResponse = z.infer<typeof claimRfqResponseSchema>;
