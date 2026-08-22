import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import { InventoryThreshold } from '../entities/inventory-threshold.entity.js';
import { INVENTORY_SETTING_CODES } from '../manifest.js';

export interface SettingsValueChangedPayload {
  settingCode: string;
  salesChannelIds: string[];
  valueType: string;
}

const NUMBER_OR_NULL = z.number().int().nullable();

const KEY_TO_FIELD: Record<string, 'thresholdHigh' | 'thresholdMedium' | 'thresholdLow'> = {
  [INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_HIGH]: 'thresholdHigh',
  [INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_MEDIUM]: 'thresholdMedium',
  [INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_LOW]: 'thresholdLow',
};

/**
 * ThresholdSettingsMirror (US5 / T058).
 *
 * The `inventory.global_threshold_{high,medium,low}` settings live in
 * the Settings module so admins can edit them through the Module
 * Settings UI alongside every other inventory key. The display-band
 * resolver, however, reads the global thresholds from
 * `inventory_thresholds` because that's where category and product
 * thresholds also live (one read path, three scopes — research §R3).
 *
 * This subscriber bridges the two: when a settings.value_changed event
 * carries one of the three threshold keys, we mirror the new value
 * into the singleton `(scope_kind='global', scope_id=null)` row.
 *
 * The mirror is best-effort — failures are logged but never propagate
 * back to the settings writer. The seeded defaults in migration 030
 * keep the resolver happy if the mirror has never run.
 */
export class ThresholdSettingsMirror {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsService: SettingsReadPort,
    /** Resolves the channel id used to read the settings value. System
     *  default is fine because the global thresholds are not per-channel.
     *  Resolved lazily so the mirror does not block module construction
     *  on channel lookups. */
    private readonly resolveSettingsChannelId: () => Promise<string | null>,
    private readonly onError?: (err: unknown) => void,
  ) {}

  /**
   * `settings.value_changed` — mirror one of the three global threshold codes
   * into the singleton `inventory_thresholds` row.
   *
   * The registration lives in this module's `backend.ts` and goes through
   * `ctx.subscribe` (issue #107): as a bare `eventBus.on` this kept writing the
   * mirror row while `inventory` was switched off. The read it performs sees the
   * new value because the settings write seam drops the cache and awaits the
   * drop before it emits (issue #45) — not because of where this handler sits
   * in the dispatch order.
   */
  async onSettingChanged(payload: SettingsValueChangedPayload): Promise<void> {
    const field = KEY_TO_FIELD[payload.settingCode];
    if (!field) return;
    try {
      await this.mirror(payload.settingCode, field);
    } catch (err) {
      const log = this.onError ?? ((e: unknown) => console.warn('threshold-mirror failed', e));
      log(err);
    }
  }

  private async mirror(
    settingCode: string,
    field: 'thresholdHigh' | 'thresholdMedium' | 'thresholdLow',
  ): Promise<void> {
    // command-coverage-ignore: derived-state sync — mirrors a Settings value into
    // the global InventoryThreshold row; the Settings write is the audited source.
    const channelId = await this.resolveSettingsChannelId();
    if (!channelId) return;
    const value = await this.settingsService.get(
      settingCode,
      channelId,
      NUMBER_OR_NULL,
    );
    const em = this.emFactory();
    let row = await em.findOne(InventoryThreshold, { scopeKind: 'global', scopeId: null });
    if (!row) {
      row = em.create(InventoryThreshold, { scopeKind: 'global', scopeId: null });
      em.persist(row);
    }
    row[field] = value;
    await em.flush();
  }
}
