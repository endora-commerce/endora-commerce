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
  'secret',
  // Feature 058 — references a saved credential configuration by its code,
  // constrained to one configuration type (see `configurationType` below).
  'credential_ref',
]);
export type SettingValueType = z.infer<typeof SettingValueTypeSchema>;

/**
 * Returns the Zod schema corresponding to a setting's declared `valueType`.
 * Callers supplying their own narrower schema to `SettingsService.get<T>()`
 * still get the looser per-type validation through this helper at write time.
 *
 * `secret` accepts a plain string on write (the backend encrypts before
 * persisting — feature 043 / FR-021); read endpoints never return it.
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
    case 'secret':
      return z.string();
    case 'credential_ref':
      // The stored value is a configuration code (or '' when not configured).
      return z.string();
  }
}

// ---------------------------------------------------------------------------
// (2) Module manifest
// ---------------------------------------------------------------------------

const groupCodeRe = /^[a-z][a-z0-9_]{0,118}[a-z0-9]$/;
/**
 * Setting code shape. Exported because feature 073's module activation block
 * (`ModuleActivationSchema` in `modules.ts`) declares the code of an ordinary
 * Setting row and must validate it identically.
 */
export const settingCodeRe = /^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$/;
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

export const SettingManifestEntrySchema = z
  .object({
    code: z.string().regex(settingCodeRe),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    /** Defaults to `'general'` when omitted. */
    groupCode: z.string().optional(),
    valueType: SettingValueTypeSchema,
    defaultValue: z.unknown(),
    salesChannelCodes: z.array(z.string()).optional(),
    /**
     * Closed list of allowed values for a `string` setting. When present the
     * setting behaves like an enum: the admin renders a dropdown instead of a
     * free-text input and the backend rejects any value outside the list. Only
     * valid for `valueType: 'string'`; the `defaultValue` must be one of the
     * options.
     */
    enumOptions: z.array(z.string().min(1)).min(1).optional(),
    /**
     * Feature 058 — the configuration type a `credential_ref` setting is
     * constrained to (e.g. `'llm'`). REQUIRED when `valueType === 'credential_ref'`
     * and forbidden otherwise. The admin renders a picker of matching
     * configurations; the backend never interprets provider meaning.
     */
    configurationType: z.string().min(1).optional(),
    /**
     * When true, the setting is registered and remains fully readable/writable
     * through its owning module's dedicated surface (e.g. the PWA settings
     * page), but is excluded from the generic admin Settings screen so it is
     * managed in exactly one place. A group whose settings are all hidden does
     * not appear in the generic Settings list at all.
     */
    hidden: z.boolean().optional(),
  })
  .refine((s) => s.valueType !== 'secret' || s.defaultValue === '', {
    message:
      "A 'secret' setting's defaultValue must be the empty string — manifests can never ship a real credential.",
    path: ['defaultValue'],
  })
  .refine((s) => s.enumOptions === undefined || s.valueType === 'string', {
    message: "enumOptions is only supported for valueType 'string'.",
    path: ['enumOptions'],
  })
  .refine((s) => (s.valueType === 'credential_ref') === (s.configurationType !== undefined), {
    message:
      "configurationType is required for valueType 'credential_ref' and forbidden otherwise.",
    path: ['configurationType'],
  })
  .refine(
    (s) =>
      s.enumOptions === undefined ||
      (typeof s.defaultValue === 'string' && s.enumOptions.includes(s.defaultValue)),
    {
      message: 'An enum setting defaultValue must be one of its enumOptions.',
      path: ['defaultValue'],
    },
  );
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
  /**
   * Secret settings only (feature 043 / FR-021): `value` is redacted to
   * `null` on every read; `isSet` tells the UI whether a value exists.
   * Absent for non-secret settings.
   */
  isSet: z.boolean().optional(),
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
  /**
   * Closed list of allowed values for an enum-style `string` setting (manifest
   * `enumOptions`). Empty/absent for ordinary free-text settings; when present
   * the admin renders a dropdown bound to these values.
   */
  enumOptions: z.array(z.string()).nullish(),
  /**
   * Feature 058 — for a `credential_ref` setting, the configuration type the
   * reference is constrained to (e.g. `'llm'`); the admin filters the config
   * picker by this. Null/absent for every other value type.
   */
  configurationType: z.string().nullish(),
  /**
   * Manifest-declared default value (immutable; surfaces in `defaultValue`).
   */
  defaultValue: z.unknown(),
  /**
   * Platform-wide global override the admin has set, or `null` when the
   * admin has not customised it. Resolver chain when reading a value:
   *   per-channel SettingValue row → globalValue (when non-null) → defaultValue.
   * "All channels" admin writes update this field only and leave per-channel
   * rows untouched.
   */
  globalValue: z.unknown().nullable(),
  /**
   * Secret settings only (feature 043 / FR-021): `defaultValue` and
   * `globalValue` are redacted to `null` on every read; this flag tells the
   * UI whether a global override exists. Absent for non-secret settings.
   */
  globalValueIsSet: z.boolean().optional(),
  valuesByChannel: z.array(SettingValueByChannelSchema),
  /**
   * Server-computed effective version (= `max(setting.updatedAt,
   * max(values.updatedAt))`). Echo back as `expectedVersion` on PUT
   * /:code/value to detect concurrent edits — matches the ETag header
   * returned by the detail endpoint.
   */
  version: z.iso.datetime(),
  /**
   * Feature 073 — `false` when the owning module is not effectively present.
   * The value is still read (off is not uninstall: the stored configuration
   * survives), but every write against it is refused (FR-033). Classified per
   * setting rather than per group because the module's own activation control
   * stays writable while it is off, so a group-level filter would either hide
   * the control or render the whole group.
   */
  editable: z.boolean().optional(),
  /**
   * Feature 073 — this setting **is** its module's activation control: the
   * single exception that stays writable while the module is off, and the one
   * setting the ordinary write path refuses (the audited Command owns it).
   */
  activationControl: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// (4) Storefront shop-information surface
// ---------------------------------------------------------------------------

/**
 * Public shop / company contact information resolved for the active sales
 * channel. Backs the storefront footer, the 404 "need help?" block and the
 * contact form. Every field is a string; an unset (or not-yet-registered)
 * setting resolves to an empty string so the storefront can decide what to
 * render. The contact-form recipient list is intentionally omitted — it is
 * an internal routing concern, not public information.
 */
export const ShopInfoSchema = z.object({
  name: z.string(),
  address: z.string(),
  contactEmail: z.string(),
  supportEmail: z.string(),
  phone: z.string(),
});
export type ShopInfo = z.infer<typeof ShopInfoSchema>;

export const ShopInfoResponseSchema = z.object({ data: ShopInfoSchema });
export type ShopInfoResponse = z.infer<typeof ShopInfoResponseSchema>;

// ---------------------------------------------------------------------------
// (5) Cache administration (maintenance)
// ---------------------------------------------------------------------------

/**
 * A clearable cache namespace surfaced in the admin "Clear cache" page. `key`
 * is the stable identifier the client sends back to clear it; `label` and
 * `description` are human-readable (English defaults — the admin localises via
 * the `settings.cache.namespace.<key>.*` i18n keys).
 */
export const CacheNamespaceDtoSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
});
export type CacheNamespaceDto = z.infer<typeof CacheNamespaceDtoSchema>;

export const CacheNamespacesResponseSchema = z.object({
  data: z.array(CacheNamespaceDtoSchema),
  /** False when no Redis cache is wired (clearing is a no-op). */
  cacheEnabled: z.boolean(),
});
export type CacheNamespacesResponse = z.infer<typeof CacheNamespacesResponseSchema>;

export const ClearCacheRequestSchema = z.object({
  /** Namespace keys to clear, or the literal `"all"` for every namespace. */
  namespaces: z.union([z.literal('all'), z.array(z.string()).min(1)]),
});
export type ClearCacheRequest = z.infer<typeof ClearCacheRequestSchema>;

export const ClearedCacheNamespaceSchema = z.object({
  key: z.string(),
  deletedKeysCount: z.number().int().nonnegative(),
});

export const ClearCacheResultSchema = z.object({
  data: z.object({
    cleared: z.array(ClearedCacheNamespaceSchema),
    totalDeletedKeys: z.number().int().nonnegative(),
  }),
});
export type ClearCacheResult = z.infer<typeof ClearCacheResultSchema>;

// ---------------------------------------------------------------------------
// (6) Storefront home-page configuration
// ---------------------------------------------------------------------------

/**
 * Resolved storefront home-page configuration for the active sales channel.
 * `cmsPageSlug` is the CMS page slug an operator chose as the home page, or
 * null when none is configured (the storefront then renders its built-in
 * landing page).
 */
export const HomepageConfigSchema = z.object({
  cmsPageSlug: z.string().nullable(),
});
export type HomepageConfig = z.infer<typeof HomepageConfigSchema>;

export const HomepageConfigResponseSchema = z.object({ data: HomepageConfigSchema });
export type HomepageConfigResponse = z.infer<typeof HomepageConfigResponseSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process **write** surface `settings` publishes (feature 075, Phase P).
//
// The read side is deliberately absent: `settingsReadPort` is a *kernel* port
// (`src/kernel/settings/settings.service.ts`), because every module reads its
// own settings and the kernel applies the channel-scope rules. Only the write
// path crosses a module boundary, and it does so from six modules — the four
// payment gateways, `search` and `transactional_emails` — each of which hosts
// an admin screen over settings it owns.
// ---------------------------------------------------------------------------

/** Who made a settings write, for the audit entry. */
export interface SettingsAdminAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

/**
 * What a write did. `affectedChannelIds` is what the caller re-reads, and
 * `newVersion` is the optimistic-lock token for the next write.
 *
 * `setting` is deliberately **not** here. The service returns the `Setting`
 * entity on it, no cross-module caller reads it, and publishing an ORM row
 * would be exactly the substitution this feature exists to remove.
 */
export interface SettingsSetValueResult {
  affectedChannelIds: string[];
  newVersion: string;
}

/**
 * Container name: `settingsAdminService`. Owner: `settings`.
 *
 * Two writes, and the difference between them is the whole channel-scoping
 * story (Constitution XII): a value set for all channels and a value set for a
 * named subset are different operations with different audit entries, not one
 * operation with an optional argument.
 *
 * `expectedVersion` is `null` for a first write and the previous
 * `newVersion` afterwards; a mismatch is a 409, on this side of the port.
 *
 * When `settings` is off the write fails closed. There is no degrade to
 * design: a configuration screen that reported success while storing nothing
 * is worse than one that refuses.
 *
 * Whether `settings` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface SettingsAdminPort {
  setValueForAllChannels(
    code: string,
    rawValue: unknown,
    expectedVersion: string | null,
    actor: SettingsAdminAuditContext,
  ): Promise<SettingsSetValueResult>;
  setValueForSubset(
    code: string,
    channelCodes: string[],
    rawValue: unknown,
    expectedVersion: string | null,
    actor: SettingsAdminAuditContext,
  ): Promise<SettingsSetValueResult>;
}
