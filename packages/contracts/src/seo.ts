import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * SEO meta + sitemap contracts (T235 / FR-101, FR-102).
 *
 * The `entityType` enum is closed — only entities the storefront actually
 * renders public pages for can carry meta overrides.
 */

export const seoEntityTypeSchema = z.enum(['product', 'category', 'cms_page']);
export type SeoEntityType = z.infer<typeof seoEntityTypeSchema>;

export const resolvedMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  openGraph: z.object({
    title: z.string(),
    description: z.string(),
    image: z.string().nullable(),
  }),
  /** Whether the resolved values came from a stored override or the rule. */
  source: z.enum(['override', 'rule']),
  locale: z.string(),
});
export type ResolvedMeta = z.infer<typeof resolvedMetaSchema>;

export const seoMetaOverrideSchema = z.object({
  id: uuidSchema,
  entityType: seoEntityTypeSchema,
  entityId: uuidSchema,
  locale: z.string().min(2).max(10),
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
  ogImageUrl: z.string().url().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const upsertSeoMetaOverrideRequestSchema = z.object({
  locale: z.string().min(2).max(10),
  title: z.string().min(1).max(160).nullable().optional(),
  description: z.string().min(1).max(400).nullable().optional(),
  ogTitle: z.string().min(1).max(160).nullable().optional(),
  ogDescription: z.string().min(1).max(400).nullable().optional(),
  ogImageUrl: z.string().url().nullable().optional(),
});
export type UpsertSeoMetaOverrideRequest = z.infer<typeof upsertSeoMetaOverrideRequestSchema>;

export const sitemapStatusSchema = z.object({
  generatedAt: isoDateTimeSchema.nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  urlCount: z.number().int().nonnegative().nullable(),
});
export type SitemapStatus = z.infer<typeof sitemapStatusSchema>;
