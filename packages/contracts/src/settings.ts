// Settings module — feature 004 contract surface.
// Holds three logical sections in one file (matching the convention used by
// every other module in @b2b/contracts):
//   (1) Setting value-type Zod registry.
//   (2) Module manifest schemas — the cross-module registration contract that
//       any backend module may use to declare its setting groups and settings
//       (see specs/004-settings-module/contracts/settings-004.contract.md, A).
//   (3) Admin HTTP request/response schemas (section C).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// (1) Value types
// ---------------------------------------------------------------------------

export const SettingValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'json',
  'string_list',
]);
export type SettingValueType = z.infer<typeof SettingValueTypeSchema>;

/**
 * Returns the Zod schema corresponding to a setting's declared `valueType`.
 * Callers supplying their own narrower schema to `SettingsService.get<T>()`
 * still get the looser per-type validation through this helper at write time.
 */
export function valueSchemaForType(t: SettingValueType): z.ZodType<unknown> {
  switch (t) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'json':
      return z.unknown();
    case 'string_list':
      return z.array(z.string());
  }
}

// ---------------------------------------------------------------------------
// (2) Module manifest
// ---------------------------------------------------------------------------

const groupCodeRe = /^[a-z][a-z0-9_]{0,118}[a-z0-9]$/;
const settingCodeRe = /^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$/;
const moduleCodeRe = /^[a-z][a-z0-9_]{0,118}[a-z0-9]$/;

export const GroupManifestEntrySchema = z.object({
  code: z.string().regex(groupCodeRe),
  name: z.string().min(1).max(200),
  /**
   * Sales-channel scope by `sales_channels.code`. Omit (or empty) to mean
   * "applies to all channels" (R-5 / FR-004).
   */
  salesChannelCodes: z.array(z.string()).optional(),
  /**
   * Reserved for the built-in `general` group only — other modules MUST NOT
   * set this to `true`. The reconciler refuses such manifests at boot.
   */
  isSystemProtected: z.boolean().optional(),
});
export type GroupManifestEntry = z.infer<typeof GroupManifestEntrySchema>;

export const SettingManifestEntrySchema = z.object({
  code: z.string().regex(settingCodeRe),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Defaults to `'general'` when omitted. */
  groupCode: z.string().optional(),
  valueType: SettingValueTypeSchema,
  defaultValue: z.unknown(),
  salesChannelCodes: z.array(z.string()).optional(),
});
export type SettingManifestEntry = z.infer<typeof SettingManifestEntrySchema>;

export const ModuleSettingsManifestSchema = z.object({
  moduleCode: z.string().regex(moduleCodeRe),
  groups: z.array(GroupManifestEntrySchema).default([]),
  settings: z.array(SettingManifestEntrySchema).default([]),
});
export type ModuleSettingsManifest = z.infer<typeof ModuleSettingsManifestSchema>;

/**
 * Identity-with-validation helper for module authors. Modules export a single
 * constant with `defineModuleSettingsManifest({...})`; this gives them full
 * TypeScript inference and the reconciler can ingest the value directly.
 */
export function defineModuleSettingsManifest(
  m: ModuleSettingsManifest,
): ModuleSettingsManifest {
  return ModuleSettingsManifestSchema.parse(m);
}

// ---------------------------------------------------------------------------
// (3) Admin HTTP
// ---------------------------------------------------------------------------

export const SettingValueByChannelSchema = z.object({
  salesChannelId: z.uuid(),
  salesChannelCode: z.string(),
  value: z.unknown(),
  updatedAt: z.iso.datetime(),
});

export const SettingDtoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  valueType: SettingValueTypeSchema,
  ownerModule: z.string(),
  salesChannelCodes: z.array(z.string()),
  defaultValue: z.unknown(),
  valuesByChannel: z.array(SettingValueByChannelSchema),
  /**
   * Server-computed effective version (= `max(setting.updatedAt,
   * max(values.updatedAt))`). Echo back as `expectedVersion` on PUT
   * /:code/value to detect concurrent edits — matches the ETag header
   * returned by the detail endpoint.
   */
  version: z.iso.datetime(),
});
export type SettingDto = z.infer<typeof SettingDtoSchema>;

export const SettingGroupDtoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isSystemProtected: z.boolean(),
  ownerModule: z.string(),
  salesChannelCodes: z.array(z.string()),
  settings: z.array(SettingDtoSchema),
});
export type SettingGroupDto = z.infer<typeof SettingGroupDtoSchema>;

export const SettingsListResponseSchema = z.object({
  groups: z.array(SettingGroupDtoSchema),
});

export const SettingsListQuerySchema = z.object({
  groupCode: z.string().optional(),
});

export const SetValueAllRequestSchema = z.object({
  scope: z.literal('all'),
  value: z.unknown(),
});

export const SetValueSubsetRequestSchema = z.object({
  scope: z.literal('subset'),
  salesChannelCodes: z.array(z.string()).min(1),
  value: z.unknown(),
});

export const SetValueRequestSchema = z.discriminatedUnion('scope', [
  SetValueAllRequestSchema,
  SetValueSubsetRequestSchema,
]);
export type SetValueRequest = z.infer<typeof SetValueRequestSchema>;

export const ResetValueQuerySchema = z.object({
  /** Comma-separated list; omit to reset for every channel. */
  salesChannelCodes: z.string().optional(),
});

export const GroupCreateRequestSchema = z.object({
  code: z.string().regex(groupCodeRe),
  name: z.string().min(1).max(200),
  salesChannelCodes: z.array(z.string()).optional(),
});

export const GroupUpdateRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  salesChannelCodes: z.array(z.string()).optional(),
});

export const SettingDetailResponseSchema = SettingDtoSchema;
