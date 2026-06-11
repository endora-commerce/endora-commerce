import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, valueSchemaForType, type SettingValueType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { EventBus } from '../../../events/bus.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { SettingGroup } from '../entities/setting-group.entity.js';
import { Setting } from '../entities/setting.entity.js';
import { SettingValue } from '../entities/setting-value.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SecretKeyMissing, encryptSecretValue } from './secret-value-codec.js';

/**
 * SettingsAdminService — feature 004 / US2 (T034).
 *
 * Centralises every mutation an Admin UI client can make to settings:
 *   - per-channel value writes (apply-to-all / apply-to-subset / reset)
 *   - group CRUD (create / rename / rescope / delete-with-reassign-to-general)
 *
 * Optimistic concurrency uses an ISO-timestamp `expectedVersion` field
 * matching the pattern adopted in feature 003 governance: when present and
 * stale, the service rejects with `409 VERSION_CONFLICT`.
 *
 * Every successful mutation emits:
 *   - an `audit_log_entries` row via {@link AuditLogService}
 *   - an EventBus event (see contract section E)
 */

export interface AdminAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

export interface SetValueResult {
  setting: Setting;
  affectedChannelIds: string[];
  newVersion: string;
}

export class SettingsAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly eventBus: EventBus,
    private readonly auditLogService?: AuditLogService,
    /** Base64 32-byte key for `secret` settings (feature 043, FR-021). */
    private readonly secretEncryptionKey?: string,
  ) {}

  // ------------------------------------------------------------------------
  // Read paths
  // ------------------------------------------------------------------------

  async listGroups(filter?: { groupCode?: string }): Promise<{
    groups: Array<{
      group: SettingGroup;
      settings: Array<{ setting: Setting; values: SettingValue[] }>;
    }>;
  }> {
    const em = this.emFactory();
    const where = filter?.groupCode ? { code: filter.groupCode } : {};
    const groups = await em.find(SettingGroup, where, {
      populate: ['salesChannels'],
      orderBy: { name: 'asc' },
    });
    const out: Array<{
      group: SettingGroup;
      settings: Array<{ setting: Setting; values: SettingValue[] }>;
    }> = [];
    for (const group of groups) {
      const settings = await em.find(
        Setting,
        { group },
        { populate: ['salesChannels'], orderBy: { name: 'asc' } },
      );
      const settingsWithValues: Array<{ setting: Setting; values: SettingValue[] }> = [];
      for (const setting of settings) {
        const values = await em.find(
          SettingValue,
          { setting },
          { populate: ['salesChannel'] },
        );
        settingsWithValues.push({ setting, values });
      }
      out.push({ group, settings: settingsWithValues });
    }
    return { groups: out };
  }

  async getSettingByCode(code: string): Promise<{
    setting: Setting;
    values: SettingValue[];
    version: string;
  }> {
    const em = this.emFactory();
    const setting = await em.findOne(
      Setting,
      { code },
      { populate: ['salesChannels', 'group'] },
    );
    if (!setting) {
      throw new HttpError(
        404,
        ERROR_CODES.SETTING_NOT_REGISTERED,
        `Setting "${code}" is not registered.`,
      );
    }
    const values = await em.find(
      SettingValue,
      { setting },
      { populate: ['salesChannel'] },
    );
    return { setting, values, version: this.computeSettingVersion(setting, values) };
  }

  // ------------------------------------------------------------------------
  // Value writes
  // ------------------------------------------------------------------------

  async setValueForAllChannels(
    code: string,
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<SetValueResult> {
    return this.setValue(code, rawValue, expectedVersion, actor, { scope: 'all' });
  }

  async setValueForSubset(
    code: string,
    channelCodes: string[],
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<SetValueResult> {
    if (channelCodes.length === 0) {
      throw new HttpError(
        400,
        ERROR_CODES.SETTING_EMPTY_SUBSET,
        'A subset save must target at least one sales channel.',
      );
    }
    return this.setValue(code, rawValue, expectedVersion, actor, {
      scope: 'subset',
      channelCodes,
    });
  }

  private async setValue(
    code: string,
    rawValue: unknown,
    expectedVersion: string | null,
    actor: AdminAuditContext,
    target: { scope: 'all' } | { scope: 'subset'; channelCodes: string[] },
  ): Promise<SetValueResult> {
    const em = this.emFactory();
    const setting = await em.findOne(
      Setting,
      { code },
      { populate: ['salesChannels'] },
    );
    if (!setting) {
      throw new HttpError(
        404,
        ERROR_CODES.SETTING_NOT_REGISTERED,
        `Setting "${code}" is not registered.`,
      );
    }

    // Validate the incoming value against the declared type.
    const schema = valueSchemaForType(setting.valueType as SettingValueType);
    const parsed = schema.safeParse(rawValue);
    if (!parsed.success) {
      throw new HttpError(
        400,
        ERROR_CODES.SETTING_VALUE_SHAPE_MISMATCH,
        `Value does not match valueType="${setting.valueType}".`,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          issue: issue.message,
        })),
      );
    }

    // Enum settings: the value must be one of the manifest-declared options.
    if (setting.enumOptions && setting.enumOptions.length > 0) {
      if (
        typeof parsed.data !== 'string' ||
        !setting.enumOptions.includes(parsed.data)
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.SETTING_VALUE_SHAPE_MISMATCH,
          `Value must be one of: ${setting.enumOptions.join(', ')}.`,
        );
      }
    }

    // Secret settings (feature 043, FR-021): persist a ciphertext envelope,
    // never the plaintext. An empty string clears the value (stored as '' so
    // the redacted DTO reports isSet=false). No silent plaintext fallback —
    // a missing key is a hard configuration error.
    const isSecret = setting.valueType === 'secret';
    let storedValue: unknown = parsed.data;
    if (isSecret) {
      const plaintext = parsed.data as string;
      try {
        storedValue = plaintext === '' ? '' : encryptSecretValue(plaintext, this.secretEncryptionKey);
      } catch (err) {
        if (err instanceof SecretKeyMissing) {
          throw new HttpError(500, ERROR_CODES.SETTING_SECRET_KEY_MISSING, err.message);
        }
        throw err;
      }
    }

    const existingValues = await em.find(
      SettingValue,
      { setting },
      { populate: ['salesChannel'] },
    );
    this.assertVersion(this.computeSettingVersion(setting, existingValues), expectedVersion);

    const affectedChannelIds: string[] = [];
    let globalValueUpdated = false;

    if (target.scope === 'all') {
      // Platform-wide global override: writes setting.globalValue only. Channels
      // that already carry their own per-channel `SettingValue` row keep it
      // (their override wins over global). Channels without an explicit
      // override now inherit this new global value via the resolver.
      setting.globalValue = storedValue;
      globalValueUpdated = true;
    } else {
      // Per-channel overrides. Validate the requested codes are real channels
      // and within the setting's scope.
      const allChannels = await em.find(SalesChannel, {});
      const inScopeChannels =
        setting.salesChannels.length === 0
          ? allChannels
          : setting.salesChannels.getItems();
      const codeToChannel = new Map(allChannels.map((c) => [c.code, c]));
      const inScopeIds = new Set(inScopeChannels.map((c) => c.id));
      const targetChannels: SalesChannel[] = [];
      for (const c of target.channelCodes) {
        const channel = codeToChannel.get(c);
        if (!channel) {
          throw new HttpError(
            400,
            ERROR_CODES.SETTING_OUT_OF_SCOPE_FOR_CHANNEL,
            `Sales channel "${c}" does not exist.`,
          );
        }
        if (!inScopeIds.has(channel.id)) {
          throw new HttpError(
            400,
            ERROR_CODES.SETTING_OUT_OF_SCOPE_FOR_CHANNEL,
            `Setting "${code}" is not in scope for sales channel "${c}".`,
          );
        }
        targetChannels.push(channel);
      }

      if (targetChannels.length === 0) {
        throw new HttpError(
          400,
          ERROR_CODES.SETTING_EMPTY_SUBSET,
          'No applicable sales channels — setting cannot be left bound to zero channels.',
        );
      }

      const valuesByChannelId = new Map(existingValues.map((v) => [v.salesChannel.id, v]));
      for (const channel of targetChannels) {
        const existing = valuesByChannelId.get(channel.id);
        if (existing) {
          existing.value = storedValue;
        } else {
          em.create(SettingValue, {
            setting,
            salesChannel: channel,
            value: storedValue,
          });
        }
        affectedChannelIds.push(channel.id);
      }
    }

    await em.flush();

    // Refresh values for an accurate post-save version.
    const refreshed = await em.find(
      SettingValue,
      { setting },
      { populate: ['salesChannel'] },
    );
    const newVersion = this.computeSettingVersion(setting, refreshed);

    // Audit + event after commit.
    if (this.auditLogService) {
      if (globalValueUpdated) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting.global_value_set',
          objectType: 'setting',
          objectId: setting.id,
          stateAfter: {
            settingCode: setting.code,
            // Secret plaintext never lands in the audit log (FR-021).
            value: isSecret ? '[redacted]' : parsed.data,
            valueType: setting.valueType,
          },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
      for (const channelId of affectedChannelIds) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting.value_set',
          objectType: 'setting',
          objectId: setting.id,
          stateAfter: {
            settingCode: setting.code,
            salesChannelId: channelId,
            value: isSecret ? '[redacted]' : parsed.data,
            valueType: setting.valueType,
          },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
    }
    this.eventBus.emit('settings.value_changed', {
      eventId: `settings.value_changed:${setting.id}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      settingCode: setting.code,
      salesChannelIds: affectedChannelIds,
      globalValueUpdated,
      valueType: setting.valueType,
    } as never);

    return { setting, affectedChannelIds, newVersion };
  }

  async resetValues(
    code: string,
    channelCodes: string[] | undefined,
    actor: AdminAuditContext,
  ): Promise<{
    setting: Setting;
    resetChannelIds: string[];
    globalValueCleared: boolean;
    newVersion: string;
  }> {
    const em = this.emFactory();
    const setting = await em.findOne(Setting, { code });
    if (!setting) {
      throw new HttpError(
        404,
        ERROR_CODES.SETTING_NOT_REGISTERED,
        `Setting "${code}" is not registered.`,
      );
    }

    let resetChannelIds: string[] = [];
    let globalValueCleared = false;

    if (channelCodes && channelCodes.length > 0) {
      // Channel-scoped reset: delete only the specified channels' override rows.
      // The global override (if any) is left intact; affected channels now
      // inherit it (or fall through to the manifest default).
      const channels = await em.find(SalesChannel, { code: { $in: channelCodes } });
      const ids = channels.map((c) => c.id);
      if (ids.length === 0) {
        return {
          setting,
          resetChannelIds: [],
          globalValueCleared: false,
          newVersion: this.computeSettingVersion(setting, []),
        };
      }
      const values = await em.find(
        SettingValue,
        { setting, salesChannel: { $in: ids } as Partial<SalesChannel> },
        { populate: ['salesChannel'] },
      );
      resetChannelIds = values.map((v) => v.salesChannel.id);
      for (const v of values) em.remove(v);
    } else {
      // Platform-wide reset: clear the global override only. Per-channel
      // override rows are intentionally left untouched (per the agreed
      // semantics; admins can still reset individual channels separately).
      if (setting.globalValue !== null && setting.globalValue !== undefined) {
        setting.globalValue = null;
        globalValueCleared = true;
      }
    }

    await em.flush();

    const remaining = await em.find(
      SettingValue,
      { setting },
      { populate: ['salesChannel'] },
    );
    const newVersion = this.computeSettingVersion(setting, remaining);

    if (this.auditLogService) {
      for (const channelId of resetChannelIds) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting.value_reset',
          objectType: 'setting',
          objectId: setting.id,
          stateAfter: { settingCode: setting.code, salesChannelId: channelId },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
      if (globalValueCleared) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting.global_value_reset',
          objectType: 'setting',
          objectId: setting.id,
          stateAfter: { settingCode: setting.code },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
    }
    if (resetChannelIds.length > 0 || globalValueCleared) {
      this.eventBus.emit('settings.value_changed', {
        eventId: `settings.value_reset:${setting.id}:${Date.now()}`,
        occurredAt: new Date().toISOString(),
        settingCode: setting.code,
        salesChannelIds: resetChannelIds,
        globalValueUpdated: globalValueCleared,
        valueType: setting.valueType,
      } as never);
    }

    return { setting, resetChannelIds, globalValueCleared, newVersion };
  }

  // ------------------------------------------------------------------------
  // Group CRUD
  // ------------------------------------------------------------------------

  async createGroup(
    input: { code: string; name: string; salesChannelCodes?: string[] },
    actor: AdminAuditContext,
  ): Promise<SettingGroup> {
    const em = this.emFactory();
    const existing = await em.findOne(SettingGroup, { code: input.code });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.SETTING_GROUP_CODE_CONFLICT,
        `Setting group "${input.code}" already exists.`,
      );
    }
    const group = em.create(SettingGroup, {
      code: input.code,
      name: input.name,
      ownerModule: 'manual',
      isSystemProtected: false,
    });
    if (input.salesChannelCodes && input.salesChannelCodes.length > 0) {
      const channels = await em.find(SalesChannel, {
        code: { $in: input.salesChannelCodes },
      });
      for (const c of channels) group.salesChannels.add(c);
    }
    await em.persistAndFlush(group);

    if (this.auditLogService) {
      await this.auditLogService.record({
        actorAdminUserId: actor.actorAdminUserId,
        action: 'setting_group.created',
        objectType: 'setting_group',
        objectId: group.id,
        stateAfter: {
          code: group.code,
          name: group.name,
          salesChannelCodes: input.salesChannelCodes ?? [],
        },
        ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
      });
    }
    this.eventBus.emit('settings.group_changed', {
      eventId: `settings.group_changed:${group.id}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      groupCode: group.code,
      change: 'created',
    } as never);

    return group;
  }

  async updateGroup(
    code: string,
    patch: { name?: string; salesChannelCodes?: string[] },
    expectedVersion: string | null,
    actor: AdminAuditContext,
  ): Promise<SettingGroup> {
    const em = this.emFactory();
    const group = await em.findOne(
      SettingGroup,
      { code },
      { populate: ['salesChannels'] },
    );
    if (!group) {
      throw new HttpError(
        404,
        ERROR_CODES.SETTING_GROUP_NOT_FOUND,
        `Setting group "${code}" not found.`,
      );
    }
    this.assertVersion(group.updatedAt.toISOString(), expectedVersion);

    const stateBefore = {
      name: group.name,
      salesChannelCodes: group.salesChannels.getItems().map((c) => c.code),
    };

    let renamed = false;
    let rescoped = false;

    if (patch.name && patch.name !== group.name) {
      group.name = patch.name;
      renamed = true;
    }

    if (patch.salesChannelCodes !== undefined) {
      const allChannels = await em.find(SalesChannel, {});
      const codeToChannel = new Map(allChannels.map((c) => [c.code, c]));
      group.salesChannels.removeAll();
      for (const c of patch.salesChannelCodes) {
        const channel = codeToChannel.get(c);
        if (channel) group.salesChannels.add(channel);
      }
      rescoped = true;
    }

    await em.flush();

    const stateAfter = {
      name: group.name,
      salesChannelCodes: group.salesChannels.getItems().map((c) => c.code),
    };

    if (this.auditLogService) {
      if (renamed) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting_group.renamed',
          objectType: 'setting_group',
          objectId: group.id,
          stateBefore: { name: stateBefore.name },
          stateAfter: { name: stateAfter.name },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
      if (rescoped) {
        await this.auditLogService.record({
          actorAdminUserId: actor.actorAdminUserId,
          action: 'setting_group.rescoped',
          objectType: 'setting_group',
          objectId: group.id,
          stateBefore: { salesChannelCodes: stateBefore.salesChannelCodes },
          stateAfter: { salesChannelCodes: stateAfter.salesChannelCodes },
          ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        });
      }
    }
    if (renamed || rescoped) {
      this.eventBus.emit('settings.group_changed', {
        eventId: `settings.group_changed:${group.id}:${Date.now()}`,
        occurredAt: new Date().toISOString(),
        groupCode: group.code,
        change: renamed && rescoped ? 'rescoped' : renamed ? 'renamed' : 'rescoped',
      } as never);
    }

    return group;
  }

  async deleteGroup(code: string, actor: AdminAuditContext): Promise<void> {
    const em = this.emFactory();
    const group = await em.findOne(SettingGroup, { code });
    if (!group) {
      throw new HttpError(
        404,
        ERROR_CODES.SETTING_GROUP_NOT_FOUND,
        `Setting group "${code}" not found.`,
      );
    }
    if (group.isSystemProtected) {
      throw new HttpError(
        400,
        ERROR_CODES.SETTING_GROUP_PROTECTED,
        `Setting group "${code}" is system-protected and cannot be deleted.`,
      );
    }

    const general = await em.findOne(SettingGroup, { code: 'general' });
    if (!general) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Built-in "general" setting group is missing — boot-time sync did not run.',
      );
    }

    const ownedSettings = await em.find(Setting, { group });
    const reassignedSettingIds: string[] = [];
    for (const s of ownedSettings) {
      s.group = general;
      reassignedSettingIds.push(s.id);
    }

    em.remove(group);
    await em.flush();

    if (this.auditLogService) {
      await this.auditLogService.record({
        actorAdminUserId: actor.actorAdminUserId,
        action: 'setting_group.deleted',
        objectType: 'setting_group',
        objectId: group.id,
        stateBefore: { code: group.code, name: group.name },
        stateAfter: {
          reassignedSettings: reassignedSettingIds.length,
          reassignedToGroupCode: 'general',
        },
        ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
      });
    }
    this.eventBus.emit('settings.group_changed', {
      eventId: `settings.group_changed:${group.id}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      groupCode: code,
      change: 'deleted',
    } as never);
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  /** Compute the setting's effective version = max(setting.updated_at, max(values.updated_at)). */
  computeSettingVersion(setting: Setting, values: SettingValue[]): string {
    let max = setting.updatedAt.getTime();
    for (const v of values) {
      const t = v.updatedAt.getTime();
      if (t > max) max = t;
    }
    return new Date(max).toISOString();
  }

  private assertVersion(currentVersion: string, expectedVersion: string | null): void {
    if (!expectedVersion) return;
    if (currentVersion !== expectedVersion) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Setting was modified by another request. Refresh and retry.',
      );
    }
  }
}
