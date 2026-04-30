import type { EntityManager } from '@mikro-orm/postgresql';
import type { z } from 'zod';
import { Setting } from '../entities/setting.entity.js';
import { SettingValue } from '../entities/setting-value.entity.js';
import type { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';
import type { SettingsCache } from './settings-cache.js';

/**
 * SettingsService — the universal getter (US3 / T049).
 *
 * The single read mechanism every other module uses to retrieve a setting's
 * value for a given sales channel. Resolution order:
 *
 *   1. Cache hit (read-through Redis + per-process LRU).
 *   2. Setting lookup by code; absent → throw {@link SettingNotRegistered}.
 *   3. Scope check; the channel must be in the setting's `salesChannels`
 *      collection (or the collection must be empty = "all channels").
 *      Otherwise → throw {@link SettingOutOfScopeForChannel}.
 *   4. Per-channel `setting_values` row → return its `value`.
 *   5. Else → return `setting.defaultValue`.
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
  constructor(public readonly settingCode: string, public readonly salesChannelId: string) {
    super(
      `Setting "${settingCode}" is not in scope for sales channel "${salesChannelId}".`,
    );
  }
}

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
  ) {}

  async get<T>(
    code: string,
    salesChannelId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    // Cache lookup (covers both real values and "not registered" sentinel).
    if (this.cache) {
      const cached = await this.cache.get(code, salesChannelId);
      if (cached.hit) {
        if (cached.notRegistered) throw new SettingNotRegistered(code);
        return this.validate(code, cached.value, schema);
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

    // Scope check: empty collection ⇒ all channels in scope.
    const scope = setting.salesChannels.getItems();
    if (scope.length > 0 && !scope.some((c) => c.id === salesChannelId)) {
      throw new SettingOutOfScopeForChannel(code, salesChannelId);
    }

    const value = await em.findOne(
      SettingValue,
      { setting, salesChannel: { id: salesChannelId } as Partial<SalesChannel> },
    );

    const resolved = value ? value.value : setting.defaultValue;
    if (this.cache) await this.cache.set(code, salesChannelId, resolved);
    return this.validate(code, resolved, schema);
  }

  /**
   * Batch read. Every code is resolved independently; per-code errors are
   * returned as `{ ok: false, error: ... }` instead of throwing, so a single
   * missing code does not poison the whole batch.
   */
  async getMany(
    codes: string[],
    salesChannelId: string,
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
          throw err;
        }
      }
    }
    return out;
  }

  /** Raw-read variant used by `getMany` — no caller schema, returns `unknown`. */
  private async getRaw(code: string, salesChannelId: string): Promise<unknown> {
    if (this.cache) {
      const cached = await this.cache.get(code, salesChannelId);
      if (cached.hit) {
        if (cached.notRegistered) throw new SettingNotRegistered(code);
        return cached.value;
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

    const value = await em.findOne(
      SettingValue,
      { setting, salesChannel: { id: salesChannelId } as Partial<SalesChannel> },
    );
    const resolved = value ? value.value : setting.defaultValue;
    if (this.cache) await this.cache.set(code, salesChannelId, resolved);
    return resolved;
  }

  private validate<T>(code: string, value: unknown, schema: z.ZodType<T>): T {
    const r = schema.safeParse(value);
    if (!r.success) throw new SettingValueShapeMismatch(code, r.error.issues);
    return r.data;
  }
}
