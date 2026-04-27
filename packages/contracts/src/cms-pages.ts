import { z } from 'zod';
import { isoDateTimeSchema, multilingualStringSchema, uuidSchema } from './common.js';

/**
 * CMS pages contracts (T234 / FR-100).
 *
 * Pages have a single `path` that uniquely addresses them. Body is a
 * multilingual map of strings — the storefront chooses how to render
 * (Markdown today, structured blocks later).
 */

export const cmsPageStatusSchema = z.enum(['draft', 'published', 'archived']);
export type CmsPageStatus = z.infer<typeof cmsPageStatusSchema>;

const PATH_PATTERN = /^[a-z0-9]+(?:[/\-][a-z0-9]+)*$/;
export const cmsPagePathSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(PATH_PATTERN, 'kebab-case path with optional /-separated segments');

export const cmsPageSchema = z.object({
  id: uuidSchema,
  path: cmsPagePathSchema,
  status: cmsPageStatusSchema,
  title: multilingualStringSchema,
  body: multilingualStringSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CmsPage = z.infer<typeof cmsPageSchema>;

export const upsertCmsPageRequestSchema = z.object({
  path: cmsPagePathSchema,
  title: multilingualStringSchema,
  body: multilingualStringSchema,
});
export type UpsertCmsPageRequest = z.infer<typeof upsertCmsPageRequestSchema>;

export const updateCmsPageRequestSchema = z.object({
  title: multilingualStringSchema.optional(),
  body: multilingualStringSchema.optional(),
});
