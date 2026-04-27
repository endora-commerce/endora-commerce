import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';

/**
 * Languages + currencies configuration contracts (T238 / FR-105).
 *
 * Codes are stored verbatim — language as IETF BCP 47 (e.g. `en-US`,
 * `pl-PL`) and currency as ISO 4217 (e.g. `PLN`, `EUR`). The platform
 * never invents codes; admins pick from anything that fits the regex.
 */

const LANGUAGE_CODE = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'BCP-47 language tag');
const CURRENCY_CODE = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');

export const languageSchema = z.object({
  code: LANGUAGE_CODE,
  label: z.string().min(1).max(64),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Language = z.infer<typeof languageSchema>;

export const upsertLanguageRequestSchema = z.object({
  label: z.string().min(1).max(64),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const setDefaultLanguageRequestSchema = z.object({
  code: LANGUAGE_CODE,
});

export const currencySchema = z.object({
  code: CURRENCY_CODE,
  label: z.string().min(1).max(64),
  symbol: z.string().min(1).max(8),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Currency = z.infer<typeof currencySchema>;

export const upsertCurrencyRequestSchema = z.object({
  label: z.string().min(1).max(64),
  symbol: z.string().min(1).max(8),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const setDefaultCurrencyRequestSchema = z.object({
  code: CURRENCY_CODE,
});

/**
 * Storefront-facing read path. Returns only active rows + the defaults so a
 * client can render its language switcher / currency selector with a single
 * request.
 */
export const i18nConfigResponseSchema = z.object({
  languages: z.array(languageSchema),
  currencies: z.array(currencySchema),
  defaultLanguageCode: LANGUAGE_CODE.nullable(),
  defaultCurrencyCode: CURRENCY_CODE.nullable(),
});
export type I18nConfigResponse = z.infer<typeof i18nConfigResponseSchema>;
