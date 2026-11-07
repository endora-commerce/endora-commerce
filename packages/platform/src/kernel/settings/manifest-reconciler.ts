import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ModuleSettingsManifestSchema,
  valueSchemaForType,
  type ModuleSettingsManifest,
  type SettingValueType,
} from '@endora-commerce/contracts';
import { SettingGroup } from './setting-group.entity.js';
import { Setting } from './setting.entity.js';
import { SalesChannel } from '../sales-channels/sales-channel.entity.js';
import type { SettingsCacheInvalidation } from './settings-cache.js';
import {
  encryptPlaintextSecretValues,
  type PlaintextSecretOptions,
} from './plaintext-secret-backfill.js';

/**
 * Manifest reconciler — feature 004 / US1 (T023).
 *
 * Walks a list of {@link ModuleSettingsManifest}s and ensures the database
 * contains every declared group and setting. Idempotent: re-running adds only
 * missing rows; never overwrites administrator-chosen `setting_values`. Boot
 * sync NEVER deletes — only `modules:uninstall` removes entries (R-1).
 *
 * Errors:
 *   - {@link ManifestSchemaInvalid} — Zod parse failed.
 *   - {@link SettingCodeConflict} / {@link GroupCodeConflict} — code owned by
 *     a different module.
 *   - {@link BreakingChangeRejected} — `valueType` or `defaultValue` changed
 *     for an existing code (without `--force`).
 */

export class ManifestSchemaInvalid extends Error {
  override readonly name = 'ManifestSchemaInvalid';
  constructor(public readonly issues: unknown) {
    super('Module settings manifest failed Zod validation.');
  }
}

export class SettingCodeConflict extends Error {
  override readonly name = 'SettingCodeConflict';
  constructor(
    public readonly code: string,
    public readonly existingOwnerModule: string,
    public readonly attemptedOwnerModule: string,
  ) {
    super(
      `Setting "${code}" is already owned by module "${existingOwnerModule}"; ` +
        `module "${attemptedOwnerModule}" cannot redeclare it.`,
    );
  }
}

export class GroupCodeConflict extends Error {
  override readonly name = 'GroupCodeConflict';
  constructor(
    public readonly code: string,
    public readonly existingOwnerModule: string,
    public readonly attemptedOwnerModule: string,
  ) {
    super(
      `Setting group "${code}" is already owned by module "${existingOwnerModule}"; ` +
        `module "${attemptedOwnerModule}" cannot redeclare it.`,
    );
  }
}

export class BreakingChangeRejected extends Error {
  override readonly name = 'BreakingChangeRejected';
  constructor(
    public readonly settingCode: string,
    public readonly field: 'valueType' | 'defaultValue',
    public readonly previous: unknown,
    public readonly attempted: unknown,
  ) {
    super(
      `Setting "${settingCode}" cannot change ${field} from ${JSON.stringify(previous)} ` +
        `to ${JSON.stringify(attempted)} without --force; existing per-channel values may ` +
        'become invalid.',
    );
  }
}

export interface ReconciliationOptions {
  /** Bypass {@link BreakingChangeRejected}; existing setting_values are NOT touched even with --force. */
  force?: boolean;
  /** Validate manifests and compute the diff but do not write. */
  dryRun?: boolean;
}

/**
 * What the reconciler needs to carry out a `string` → `secret` upgrade in full
 * (issue #700): the key to encrypt the code's stored values with, and the cache
 * to drop afterwards. Without a key the upgrade still applies and a warning
 * names the code; the boot backfill encrypts the values once a key is set.
 */
export interface ManifestReconcilerOptions extends PlaintextSecretOptions {
  readonly cache?: SettingsCacheInvalidation | undefined;
}

export interface ModuleReconciliationResult {
  moduleCode: string;
  addedGroups: number;
  updatedGroups: number;
  addedSettings: number;
  updatedSettings: number;
  orphanGroups: string[];
  orphanSettings: string[];
}

export interface ReconciliationResult {
  perModule: ModuleReconciliationResult[];
  totalAddedGroups: number;
  totalAddedSettings: number;
}

interface ChannelLookup {
  byCode: Map<string, SalesChannel>;
}

async function loadChannelLookup(em: EntityManager): Promise<ChannelLookup> {
  const channels = await em.find(SalesChannel, {});
  return { byCode: new Map(channels.map((c) => [c.code, c])) };
}

function isJsonEqual(a: unknown, b: unknown): boolean {
  // jsonb columns deserialize to plain JS values; this is sufficient for the
  // scalar / array / object payloads we accept as setting values.
  return JSON.stringify(a) === JSON.stringify(b);
}

export class ManifestReconciler {
  /** Settings this `apply()` moved from `string` to `secret`. */
  private secretUpgrades: Setting[] = [];

  constructor(
    private readonly em: EntityManager,
    private readonly options: ManifestReconcilerOptions = {},
  ) {}

  /**
   * Apply the supplied manifests to the database.
   *
   * Within one apply() the manifests are processed in order; later manifests
   * see earlier ones' groups, but ownership conflicts ALWAYS abort the whole
   * batch — partial commits are rolled back via the surrounding transaction.
   */
  async apply(
    manifests: ModuleSettingsManifest[],
    options: ReconciliationOptions = {},
  ): Promise<ReconciliationResult> {
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // invariant repair, not an operator-initiated audited write.
    // (1) Validate every manifest before touching the DB.
    const parsed = manifests.map((m) => {
      const result = ModuleSettingsManifestSchema.safeParse(m);
      if (!result.success) throw new ManifestSchemaInvalid(result.error.issues);
      return result.data;
    });

    // (1a) Validate each setting's defaultValue against its declared valueType.
    for (const m of parsed) {
      for (const s of m.settings) {
        const schema = valueSchemaForType(s.valueType);
        const r = schema.safeParse(s.defaultValue);
        if (!r.success) {
          throw new ManifestSchemaInvalid({
            moduleCode: m.moduleCode,
            settingCode: s.code,
            field: 'defaultValue',
            issues: r.error.issues,
          });
        }
      }
    }

    const channels = await loadChannelLookup(this.em);

    this.secretUpgrades = [];
    const perModule: ModuleReconciliationResult[] = [];
    let totalAddedGroups = 0;
    let totalAddedSettings = 0;

    for (const manifest of parsed) {
      const result = await this.applyOne(manifest, channels, options);
      perModule.push(result);
      totalAddedGroups += result.addedGroups;
      totalAddedSettings += result.addedSettings;
    }

    if (!options.dryRun) {
      // Issue #700 — the type change and the encryption of the values it
      // reclassifies commit in the one flush, so no reader ever sees a `secret`
      // whose stored values the upgrade has not reached.
      const upgraded = await encryptPlaintextSecretValues(
        this.em,
        this.secretUpgrades,
        this.options,
      );
      await this.em.flush();
      // After the commit: the cache may hold what a process resolved while the
      // code was still a `string`, which is the plaintext, whether or not it
      // could be encrypted just now.
      if (this.options.cache) {
        for (const code of [...upgraded.encryptedCodes, ...upgraded.plaintextCodes]) {
          await this.options.cache.invalidateAfterWrite(code);
        }
      }
    }

    return { perModule, totalAddedGroups, totalAddedSettings };
  }

  private async applyOne(
    manifest: ModuleSettingsManifest,
    channels: ChannelLookup,
    options: ReconciliationOptions,
  ): Promise<ModuleReconciliationResult> {
    // command-coverage-ignore: idempotent boot reconcile of one module's settings
    // manifest — a system-invariant repair, not an operator-initiated audited write.
    const moduleCode = manifest.moduleCode;
    let addedGroups = 0;
    let updatedGroups = 0;
    let addedSettings = 0;
    let updatedSettings = 0;

    // Groups first.
    for (const entry of manifest.groups) {
      const existing = await this.em.findOne(
        SettingGroup,
        { code: entry.code },
        { populate: ['salesChannels'] },
      );
      if (existing) {
        if (existing.ownerModule !== moduleCode) {
          throw new GroupCodeConflict(entry.code, existing.ownerModule, moduleCode);
        }
        let changed = false;
        if (existing.name !== entry.name) {
          existing.name = entry.name;
          changed = true;
        }
        // Additive scope reconciliation only (R-1): never remove existing rows.
        if (entry.salesChannelCodes && entry.salesChannelCodes.length > 0) {
          for (const code of entry.salesChannelCodes) {
            const channel = channels.byCode.get(code);
            if (!channel) continue; // tolerate absent channels — logged at WARN by caller
            if (!existing.salesChannels.getItems().some((c) => c.id === channel.id)) {
              existing.salesChannels.add(channel);
              changed = true;
            }
          }
        }
        if (changed) updatedGroups += 1;
      } else {
        const group = this.em.create(SettingGroup, {
          code: entry.code,
          name: entry.name,
          ownerModule: moduleCode,
          isSystemProtected: entry.isSystemProtected ?? false,
        });
        if (entry.salesChannelCodes && entry.salesChannelCodes.length > 0) {
          for (const code of entry.salesChannelCodes) {
            const channel = channels.byCode.get(code);
            if (channel) group.salesChannels.add(channel);
          }
        }
        this.em.persist(group);
        addedGroups += 1;
      }
    }

    // Settings second (so groupCode lookups can resolve).
    for (const entry of manifest.settings) {
      const groupCode = entry.groupCode ?? 'general';
      const group = await this.em.findOne(SettingGroup, { code: groupCode });
      if (!group) {
        throw new ManifestSchemaInvalid({
          moduleCode,
          settingCode: entry.code,
          field: 'groupCode',
          issue: `Group "${groupCode}" is not declared by any manifest in this batch and is not pre-existing in the database.`,
        });
      }

      const existing = await this.em.findOne(
        Setting,
        { code: entry.code },
        { populate: ['salesChannels', 'group'] },
      );
      if (existing) {
        if (existing.ownerModule !== moduleCode) {
          throw new SettingCodeConflict(entry.code, existing.ownerModule, moduleCode);
        }
        const valueType: SettingValueType = entry.valueType;
        // `string` → `secret` is the ONE sanctioned non-breaking valueType
        // upgrade (feature 043): the write schema is unchanged (plain
        // string). Auto-applying it here lets pre-043 rows (or test
        // databases reseeded out of band) self-heal at boot instead of
        // failing the whole reconciliation. The values stored as plain
        // strings are encrypted in the same flush (issue #700) — the codec's
        // legacy passthrough would otherwise keep them, and every cache fill
        // of them, plaintext until an operator happened to save each one.
        const isSanctionedSecretUpgrade =
          existing.valueType === 'string' && valueType === 'secret';
        if (isSanctionedSecretUpgrade) {
          existing.valueType = valueType;
          this.secretUpgrades.push(existing);
        } else if (existing.valueType !== valueType && !options.force) {
          throw new BreakingChangeRejected(
            entry.code,
            'valueType',
            existing.valueType,
            valueType,
          );
        }
        // A **declared** default migration (feature 078, D-95.3 move 4). A
        // `defaultValue` change is breaking because it silently alters
        // behaviour for every deployment that never overrode the value — but a
        // module that names the exact prior value it supersedes has said which
        // change is intended and how far it reaches. A stored default equal to
        // one of those is moved forward; anything else, including an operator's
        // own choice that happens to differ, still throws. Same shape and same
        // self-healing argument as `isSanctionedSecretUpgrade` above; without
        // it a shipped default can never change, because no composition root
        // passes `force` at boot.
        const isDeclaredDefaultMigration =
          !isJsonEqual(existing.defaultValue, entry.defaultValue) &&
          (entry.previousDefaultValues ?? []).some((previous) =>
            isJsonEqual(existing.defaultValue, previous),
          );
        if (
          !isJsonEqual(existing.defaultValue, entry.defaultValue) &&
          !isDeclaredDefaultMigration &&
          !options.force
        ) {
          throw new BreakingChangeRejected(
            entry.code,
            'defaultValue',
            existing.defaultValue,
            entry.defaultValue,
          );
        }
        let changed = false;
        if (isDeclaredDefaultMigration) {
          existing.defaultValue = entry.defaultValue;
          changed = true;
        }
        if (existing.name !== entry.name) {
          existing.name = entry.name;
          changed = true;
        }
        const desc = entry.description ?? null;
        if ((existing.description ?? null) !== desc) {
          existing.description = desc;
          changed = true;
        }
        if (existing.group.id !== group.id) {
          existing.group = group;
          changed = true;
        }
        // enumOptions is manifest-driven config (not admin data): keep it in
        // sync with the manifest on every reconciliation.
        const nextEnumOptions = entry.enumOptions ?? null;
        if (!isJsonEqual(existing.enumOptions ?? null, nextEnumOptions)) {
          existing.enumOptions = nextEnumOptions;
          changed = true;
        }
        // configurationType is manifest-driven config (feature 058) — keep it
        // in sync with the manifest on every reconciliation.
        const nextConfigurationType = entry.configurationType ?? null;
        if ((existing.configurationType ?? null) !== nextConfigurationType) {
          existing.configurationType = nextConfigurationType;
          changed = true;
        }
        // hidden is manifest-driven config — keep it in sync on every run.
        const nextHidden = entry.hidden ?? false;
        if (existing.hidden !== nextHidden) {
          existing.hidden = nextHidden;
          changed = true;
        }
        // multiline is manifest-driven presentation — keep it in sync on every
        // run, in both directions: a declaration that drops the flag takes the
        // multi-line field away on the next boot.
        //
        // `?? false`, because a row read from a `settings` table the multiline
        // migration has not reached carries no such property, and absent is
        // not a difference from `false`: without it every boot over such a
        // table writes a column that is not there, for manifests that never
        // mention the flag. A manifest that does set it still fails there, and
        // should — it asks for something that database cannot store. The
        // create branch below is not softened the same way: an insert names
        // the column because the entity owns its default, as it does for
        // `hidden`, and a new row on an unmigrated table is refused loudly.
        const nextMultiline = entry.multiline ?? false;
        if (((existing.multiline as boolean | undefined) ?? false) !== nextMultiline) {
          existing.multiline = nextMultiline;
          changed = true;
        }
        if (options.force) {
          if (existing.valueType !== valueType) {
            existing.valueType = valueType;
            changed = true;
          }
          if (!isJsonEqual(existing.defaultValue, entry.defaultValue)) {
            existing.defaultValue = entry.defaultValue;
            changed = true;
          }
        }
        // Additive scope reconciliation.
        if (entry.salesChannelCodes && entry.salesChannelCodes.length > 0) {
          for (const code of entry.salesChannelCodes) {
            const channel = channels.byCode.get(code);
            if (!channel) continue;
            if (!existing.salesChannels.getItems().some((c) => c.id === channel.id)) {
              existing.salesChannels.add(channel);
              changed = true;
            }
          }
        }
        if (changed) updatedSettings += 1;
      } else {
        const setting = this.em.create(Setting, {
          code: entry.code,
          name: entry.name,
          group,
          valueType: entry.valueType,
          defaultValue: entry.defaultValue,
          ownerModule: moduleCode,
          description: entry.description ?? null,
          enumOptions: entry.enumOptions ?? null,
          configurationType: entry.configurationType ?? null,
          hidden: entry.hidden ?? false,
          multiline: entry.multiline ?? false,
        });
        if (entry.salesChannelCodes && entry.salesChannelCodes.length > 0) {
          for (const code of entry.salesChannelCodes) {
            const channel = channels.byCode.get(code);
            if (channel) setting.salesChannels.add(channel);
          }
        }
        this.em.persist(setting);
        addedSettings += 1;
      }
    }

    // Detect orphans for warning purposes — rows owned by this module that the
    // current manifest no longer claims. The reconciler does NOT remove them.
    const ownedSettings = await this.em.find(Setting, { ownerModule: moduleCode });
    const declaredSettingCodes = new Set(manifest.settings.map((s) => s.code));
    const orphanSettings = ownedSettings
      .filter((s) => !declaredSettingCodes.has(s.code))
      .map((s) => s.code);

    const ownedGroups = await this.em.find(SettingGroup, { ownerModule: moduleCode });
    const declaredGroupCodes = new Set(manifest.groups.map((g) => g.code));
    const orphanGroups = ownedGroups
      .filter((g) => !declaredGroupCodes.has(g.code))
      .map((g) => g.code);

    return {
      moduleCode,
      addedGroups,
      updatedGroups,
      addedSettings,
      updatedSettings,
      orphanGroups,
      orphanSettings,
    };
  }
}
