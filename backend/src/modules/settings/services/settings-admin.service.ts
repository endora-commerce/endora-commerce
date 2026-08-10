import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, valueSchemaForType, type SettingValueType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { EventBus } from '../../../events/bus.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { SettingGroup } from '../entities/setting-group.entity.js';
import { Setting } from '../entities/setting.entity.js';
import { SettingValue } from '../entities/setting-value.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SecretKeyMissing, SecretKeyInvalid, encryptSecretValue } from './secret-value-codec.js';

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

/**
 * The effective-state surface this module needs — feature 073, Constitution
 * XVII. Injected rather than imported so `settings` keeps no edge into the
 * lifecycle service graph; `_lifecycle` already depends on this module's
 * `Setting` entity, and reversing that edge in code would make the direction of
 * the dependency a matter of which file you happened to open.
 */
export interface ModulePresencePort {
  /**
   * Platform availability AND operator activation, resolved in memory.
   * `undefined` when the platform has never heard of this owner — a
   * hand-created group, a legacy row, a fixture. Those are not modules whose
   * presence anybody can toggle, and treating them as absent would take an
   * operator's configuration away for a module that does not exist.
   */
  presenceOf(moduleId: string): boolean | undefined;
  /** The module whose activation control this code holds, if any. */
  activationControlOwner(settingCode: string): string | undefined;
}

/** One setting, plus what feature 073 says an operator may do with it. */
export interface ClassifiedSetting {
  setting: Setting;
  values: SettingValue[];
  /**
   * `false` when the owning module is not effectively present. The value is
   * still readable — off is not uninstall — but every write is refused
   * (FR-033).
   */
  editable: boolean;
  /**
   * This setting IS its module's activation control: the single exception that
   * stays writable while the module is off, and the one setting this service
   * refuses outright (the audited Command owns it).
   */
  activationControl: boolean;
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
    /**
     * Feature 073. Absent in a composition with no lifecycle (unit tests):
     * every setting then classifies as editable, which is the pre-073
     * behaviour rather than a fall-open — there is no activation axis to
     * resolve at all.
     */
    private readonly presence?: ModulePresencePort,
  ) {}

  // ------------------------------------------------------------------------
  // Feature 073 — presence classification (Constitution XVII)
  // ------------------------------------------------------------------------

  /**
   * Classify one setting against the effective state of the module that owns
   * it. Per setting, not per group: a disabled module's activation control must
   * stay visible and writable (Constitution XVII's single exception), so its
   * group stays non-empty and a group-level filter would render the whole
   * group — every knob of a module that is supposed to be gone.
   */
  private classify(setting: Setting): { editable: boolean; activationControl: boolean } {
    if (!this.presence) return { editable: true, activationControl: false };
    const activationControl =
      this.presence.activationControlOwner(setting.code) === setting.ownerModule;
    if (activationControl) {
      // The one way back. An operator who switched a module off must be able to
      // switch it on again, so this row never goes read-only.
      return { editable: true, activationControl: true };
    }
    // `undefined` ⇒ the owner is not a module the platform manages, so nothing
    // about it is switched off and the row keeps its pre-073 behaviour.
    return {
      editable: this.presence.presenceOf(setting.ownerModule) ?? true,
      activationControl: false,
    };
  }

  /**
   * Refuse a write the classification says is not available.
   *
   * Two distinct refusals, because they mean different things to an operator:
   * an activation code has a *different* door (the audited Command), while an
   * absent module's ordinary setting has *no* door until the module is back.
   */
  private assertWritable(setting: Setting): void {
    const { editable, activationControl } = this.classify(setting);
    if (activationControl) {
      throw new HttpError(
        400,
        ERROR_CODES.MODULE_ACTIVATION_PROTECTED,
        `"${setting.code}" is the activation control for module "${setting.ownerModule}". ` +
          `Change it through POST /api/v1/admin/modules/${setting.ownerModule}/activation, ` +
          `which audits the change.`,
      );
    }
    if (!editable) {
      throw new HttpError(
        400,
        ERROR_CODES.MODULE_SETTING_READ_ONLY,
        `Module "${setting.ownerModule}" is switched off, so "${setting.code}" cannot be changed. ` +
          `Its stored value is preserved and becomes editable again when the module is switched on.`,
      );
    }
  }

  // ------------------------------------------------------------------------
  // Read paths
  // ------------------------------------------------------------------------

  async listGroups(filter?: { groupCode?: string }): Promise<{
    groups: Array<{
      group: SettingGroup;
      settings: ClassifiedSetting[];
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
      settings: ClassifiedSetting[];
    }> = [];
    for (const group of groups) {
      const settings = await em.find(
        Setting,
        { group },
        { populate: ['salesChannels'], orderBy: { name: 'asc' } },
      );
      // Hidden settings are managed only through their owning module's dedicated
      // UI; exclude them from the generic Settings screen. A group whose every
      // setting is hidden is dropped entirely (single-source-of-truth), but a
      // genuinely empty group is preserved so group management still lists it.
      const visible = settings.filter((s) => !s.hidden);
      if (visible.length === 0 && settings.length > 0) continue;
      const settingsWithValues: ClassifiedSetting[] = [];
      for (const setting of visible) {
        const values = await em.find(
          SettingValue,
          { setting },
          { populate: ['salesChannel'] },
        );
        // Feature 073: classified, never dropped. An absent module's stored
        // configuration stays readable (off is not uninstall) and the admin
        // renders it read-only from these flags.
        settingsWithValues.push({ setting, values, ...this.classify(setting) });
      }
      out.push({ group, settings: settingsWithValues });
    }
    return { groups: out };
  }

  async getSettingByCode(code: string): Promise<{
    setting: Setting;
    values: SettingValue[];
    version: string;
    editable: boolean;
    activationControl: boolean;
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
    return {
      setting,
      values,
      version: this.computeSettingVersion(setting, values),
      ...this.classify(setting),
    };
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
    // Feature 073 / FR-009, Constitution XII. Refused here as well as in
    // `setValue`, and refused *before* the empty-subset check: activation is
    // platform-wide, and a per-channel override against an activation code
    // would make module presence channel-dependent through the back door — the
    // one thing a hot-path check that is deliberately not channel-aware cannot
    // survive. Without this, the subset path permits a write against any
    // registered setting.
    const owner = this.presence?.activationControlOwner(code);
    if (owner) {
      throw new HttpError(
        400,
        ERROR_CODES.MODULE_ACTIVATION_PROTECTED,
        `"${code}" is the activation control for module "${owner}". Activation is ` +
          `platform-wide and cannot be set per sales channel.`,
      );
    }
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

    // Feature 073 — the two write refusals, before any validation: an
    // activation code has a different door, and an absent module's ordinary
    // settings have none until it is back (FR-009, FR-033).
    this.assertWritable(setting);

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
        if (err instanceof SecretKeyMissing || err instanceof SecretKeyInvalid) {
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

    // A reset is a write. FR-033 says an absent module's configuration is
    // non-editable, and clearing an operator's stored value is the most
    // destructive edit of all.
    this.assertWritable(setting);

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
