import type { EntityManager } from '@mikro-orm/postgresql';
import type { z } from 'zod';
import { Setting } from './setting.entity.js';
import { SettingValue } from './setting-value.entity.js';
import type { SalesChannel } from '../sales-channels/sales-channel.entity.js';
import type { SettingsCache } from './settings-cache.js';
import { decryptSecretValue, isSecretEnvelope } from './secret-value-codec.js';

/**
 * SettingsService — the universal getter (US3 / T049).
 *
 * The single read mechanism every other module uses to retrieve a setting's
 * value. A read either **names a real sales channel** or says it has **none**;
 * nothing in between is spellable (feature 072, D-41).
 *
 * Resolution order for a channel-scoped read (`salesChannelId` is a uuid):
 *
 *   0. Channel-id shape check; a non-uuid → throw {@link SettingsChannelIdInvalid}.
 *   1. Cache hit (read-through Redis + per-process LRU).
 *   2. Setting lookup by code; absent → throw {@link SettingNotRegistered}.
 *   3. Scope check; the channel must be in the setting's `salesChannels`
 *      collection (or the collection must be empty = "all channels").
 *      Otherwise → throw {@link SettingOutOfScopeForChannel}.
 *   4. Per-channel `setting_values` row → return its `value`.
 *   5. Else → `setting.globalValue`, else `setting.defaultValue`.
 *
 * For a **platform-wide** read (`salesChannelId === null`) step 4 is skipped:
 * the answer is `globalValue ?? defaultValue`, the tier the admin service has
 * always written ("Platform-wide global override") and `resolveEffectiveValue`
 * has always resolved, but which had no read API. Three modules independently
 * invented the nil UUID as its spelling and a fourth inlined it — it worked by
 * accident, being well-formed enough for Postgres and matching no row. A
 * setting scoped to a *subset* of channels has no platform-wide answer, so it
 * throws {@link SettingOutOfScopeForChannel} with a `null` channel.
 *
 * No schema change: `setting_values.sales_channel_id` stays `uuid NOT NULL`.
 * The null lives in the read signature, not in a column.
 *
 * The optional caller-supplied schema is validated AFTER the resolved value
 * is materialised; mismatches surface as {@link SettingValueShapeMismatch}.
 */

export class SettingNotRegistered extends Error {
  override readonly name = 'SettingNotRegistered';
  readonly code = 'SETTING_NOT_REGISTERED' as const;
  constructor(public readonly settingCode: string) {
    super(`Setting "${settingCode}" is not registered.`);
  }
}

export class SettingOutOfScopeForChannel extends Error {
  override readonly name = 'SettingOutOfScopeForChannel';
  readonly code = 'SETTING_OUT_OF_SCOPE_FOR_CHANNEL' as const;
  constructor(
    public readonly settingCode: string,
    /** `null` = the read was platform-wide, and this setting is not. */
    public readonly salesChannelId: string | null,
  ) {
    super(
      salesChannelId === null
        ? `Setting "${settingCode}" is scoped to specific sales channels, so it has no platform-wide value.`
        : `Setting "${settingCode}" is not in scope for sales channel "${salesChannelId}".`,
    );
  }
}

/**
 * The caller passed something that is not a sales-channel id (feature 072,
 * D-42 layer 3).
 *
 * `setting_values.sales_channel_id` is `uuid`, so a channel **code**, an empty
 * string or any other id-shaped string cannot address a row: PostgreSQL rejects
 * the comparison outright. Before this guard the failure surfaced as a driver
 * error naming a column, which every caller's `catch` read as "not configured
 * yet" — that is the whole of the defect family this error exists to end.
 *
 * Thrown **before** the `EntityManager` is touched, and deliberately outside
 * the set of errors a settings read may absorb (D-43): a malformed channel id
 * is a code defect, not a missing value. "No channel" is spelled `null`.
 */
export class SettingsChannelIdInvalid extends Error {
  override readonly name = 'SettingsChannelIdInvalid';
  readonly code = 'SETTINGS_CHANNEL_ID_INVALID' as const;
  constructor(
    public readonly settingCode: string,
    public readonly salesChannelId: string,
  ) {
    super(
      `"${salesChannelId}" is not a sales-channel id (reading setting "${settingCode}"). ` +
        `Pass a channel uuid, or null for a platform-wide read.`,
    );
  }
}

/**
 * The shape `sales_channels.id` and `setting_values.sales_channel_id` share.
 * Deliberately not a version-specific UUID pattern: the nil UUID must be
 * rejected as a *spelling of platform-wide*, not as a malformed id, and it is
 * `check-channel-resolution.ts` — which can see the literal — that says so.
 */
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SettingValueShapeMismatch extends Error {
  override readonly name = 'SettingValueShapeMismatch';
  readonly code = 'SETTING_VALUE_SHAPE_MISMATCH' as const;
  constructor(
    public readonly settingCode: string,
    public readonly issues: unknown,
  ) {
    super(`Stored value for setting "${settingCode}" does not match the caller's schema.`);
  }
}

export type SettingsReadResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: 'not_registered' | 'out_of_scope' | 'shape_mismatch';
      details?: unknown;
    };

export class SettingsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: SettingsCache,
    /**
     * Base64 32-byte key for the `secret` value type (feature 043). The
     * cache stores ciphertext envelopes; decryption happens per read in this
     * process so plaintext never sits in Redis.
     */
    private readonly secretEncryptionKey?: string,
  ) {}

  async get<T>(
    code: string,
    salesChannelId: string | null,
    schema: z.ZodType<T>,
  ): Promise<T> {
    this.assertChannelId(code, salesChannelId);

    // Cache lookup (covers both real values and "not registered" sentinel).
    if (this.cache) {
      const cached = await this.cache.get(code, salesChannelId);
      if (cached.hit) {
        if (cached.notRegistered) throw new SettingNotRegistered(code);
        return this.validate(code, this.maybeDecrypt(cached.value), schema);
      }
    }

    const em = this.emFactory();
    const setting = await em.findOne(
      Setting,
      { code },
      { populate: ['salesChannels'] },
    );
    if (!setting) {
      if (this.cache) await this.cache.setNotRegistered(code, salesChannelId);
      throw new SettingNotRegistered(code);
    }

    // Scope check: empty collection ⇒ all channels in scope. A platform-wide
    // read of a channel-subset setting has no answer at all.
    const scope = setting.salesChannels.getItems();
    if (scope.length > 0 && !scope.some((c) => c.id === salesChannelId)) {
      throw new SettingOutOfScopeForChannel(code, salesChannelId);
    }

    const value =
      salesChannelId === null
        ? null
        : await em.findOne(SettingValue, {
            setting,
            salesChannel: { id: salesChannelId } as Partial<SalesChannel>,
          });

    const resolved = resolveEffectiveValue(setting, value);
    if (this.cache) await this.cache.set(code, salesChannelId, resolved);
    return this.validate(code, this.maybeDecrypt(resolved), schema);
  }

  /**
   * Batch read. Every code is resolved independently; per-code errors are
   * returned as `{ ok: false, error: ... }` instead of throwing, so a single
   * missing code does not poison the whole batch.
   */
  async getMany(
    codes: string[],
    salesChannelId: string | null,
  ): Promise<Map<string, SettingsReadResult<unknown>>> {
    const out = new Map<string, SettingsReadResult<unknown>>();
    for (const code of codes) {
      try {
        const value = await this.getRaw(code, salesChannelId);
        out.set(code, { ok: true, value });
      } catch (err: unknown) {
        const name = (err as { name?: string }).name ?? 'Error';
        if (name === 'SettingNotRegistered') {
          out.set(code, { ok: false, error: 'not_registered' });
        } else if (name === 'SettingOutOfScopeForChannel') {
          out.set(code, { ok: false, error: 'out_of_scope' });
        } else if (name === 'SettingValueShapeMismatch') {
          out.set(code, {
            ok: false,
            error: 'shape_mismatch',
            details: (err as SettingValueShapeMismatch).issues,
          });
        } else {
          // Includes SettingsChannelIdInvalid: a malformed channel is wrong for
          // the whole batch, not a per-code outcome.
          throw err;
        }
      }
    }
    return out;
  }

  /** Raw-read variant used by `getMany` — no caller schema, returns `unknown`. */
  private async getRaw(code: string, salesChannelId: string | null): Promise<unknown> {
    this.assertChannelId(code, salesChannelId);

    if (this.cache) {
      const cached = await this.cache.get(code, salesChannelId);
      if (cached.hit) {
        if (cached.notRegistered) throw new SettingNotRegistered(code);
        return this.maybeDecrypt(cached.value);
      }
    }

    const em = this.emFactory();
    const setting = await em.findOne(
      Setting,
      { code },
      { populate: ['salesChannels'] },
    );
    if (!setting) {
      if (this.cache) await this.cache.setNotRegistered(code, salesChannelId);
      throw new SettingNotRegistered(code);
    }

    const scope = setting.salesChannels.getItems();
    if (scope.length > 0 && !scope.some((c) => c.id === salesChannelId)) {
      throw new SettingOutOfScopeForChannel(code, salesChannelId);
    }

    const value =
      salesChannelId === null
        ? null
        : await em.findOne(SettingValue, {
            setting,
            salesChannel: { id: salesChannelId } as Partial<SalesChannel>,
          });
    const resolved = resolveEffectiveValue(setting, value);
    if (this.cache) await this.cache.set(code, salesChannelId, resolved);
    return this.maybeDecrypt(resolved);
  }

  /**
   * The seam guard (D-42 layer 3). Runs before the cache and before the
   * `EntityManager`, so a caller learns it passed a non-id rather than the
   * driver reporting a column it has never heard of.
   */
  private assertChannelId(code: string, salesChannelId: string | null): void {
    if (salesChannelId === null) return;
    if (!CHANNEL_ID_PATTERN.test(salesChannelId)) {
      throw new SettingsChannelIdInvalid(code, salesChannelId);
    }
  }

  private validate<T>(code: string, value: unknown, schema: z.ZodType<T>): T {
    const r = schema.safeParse(value);
    if (!r.success) throw new SettingValueShapeMismatch(code, r.error.issues);
    return r.data;
  }

  /**
   * Secret settings (feature 043) resolve to a ciphertext envelope; backend
   * consumers receive the plaintext. Non-envelope values (every other value
   * type, plus legacy plaintext secrets) pass through untouched.
   */
  private maybeDecrypt(value: unknown): unknown {
    if (!isSecretEnvelope(value)) return value;
    return decryptSecretValue(value, this.secretEncryptionKey);
  }

  /**
   * Feature 058 (US2) — delete-integrity lookup for the credentials module.
   *
   * Returns every `credential_ref` setting whose resolved value (global
   * override OR a per-channel `SettingValue`) equals `configurationCode`. The
   * credentials module calls this through its port interface (Principle I)
   * before deleting a configuration; a non-empty result blocks the delete
   * (`CREDENTIAL_IN_USE`, FR-012). The manifest `defaultValue` is intentionally
   * ignored — a manifest never ships a real configuration code.
   */
  async listReferencesToConfiguration(
    configurationCode: string,
  ): Promise<{ settingCode: string; salesChannelCode?: string }[]> {
    const em = this.emFactory();
    const settings = await em.find(Setting, { valueType: 'credential_ref' });
    const refs: { settingCode: string; salesChannelCode?: string }[] = [];
    for (const setting of settings) {
      if (setting.globalValue === configurationCode) {
        refs.push({ settingCode: setting.code });
      }
      const values = await em.find(
        SettingValue,
        { setting },
        { populate: ['salesChannel'] },
      );
      for (const v of values) {
        if (v.value === configurationCode) {
          refs.push({ settingCode: setting.code, salesChannelCode: v.salesChannel.code });
        }
      }
    }
    return refs;
  }
}

/**
 * Three-tier resolution: per-channel SettingValue row → setting.globalValue
 * (when non-null) → manifest defaultValue. A NULL `globalValue` means the
 * admin has not set a platform-wide override; the manifest default applies.
 * Per-channel rows always win over `globalValue`.
 */
function resolveEffectiveValue(
  setting: Setting,
  perChannel: SettingValue | null,
): unknown {
  if (perChannel) return perChannel.value;
  if (setting.globalValue !== null && setting.globalValue !== undefined) {
    return setting.globalValue;
  }
  return setting.defaultValue;
}
