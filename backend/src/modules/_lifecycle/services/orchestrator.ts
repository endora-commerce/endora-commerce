import { dirname } from 'node:path';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { IMigrator } from '@mikro-orm/core';
import type Redis from 'ioredis';
import type {
  ModuleInstallHook,
  ModuleUninstallHook,
  RegistryState,
  ModuleListItem,
  ModuleListItemFlag,
} from '@b2b/contracts';
import { ManifestReconciler } from '../../../kernel/settings/manifest-reconciler.js';
import { Setting } from '../../../kernel/settings/setting.entity.js';
import { SettingGroup } from '../../../kernel/settings/setting-group.entity.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { ModuleRegistration } from '../../../kernel/lifecycle/module-registration.entity.js';
import {
  acquireLifecycleLock,
  type LifecycleLeaseHandle,
} from './lock.js';
import {
  publishStateChanged,
  registryCache,
} from '../../../kernel/lifecycle/registry-cache.js';
import {
  pauseWorkersFor,
  resumeWorkersFor,
} from '../../../kernel/lifecycle/plugin-helpers.js';
import type { LoadedManifestRegistry } from './manifest-loader.js';
import { MIGRATION_REGISTRY } from '../../../db/migrations-registry.generated.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  orm: MikroORM;
  redis: Redis;
  em: () => EntityManager;
  auditLog: AuditLogService;
  /** The loaded manifest registry — built once at boot or per CLI run. */
  registry: LoadedManifestRegistry;
  /**
   * How a migrator is obtained. Defaults to the ORM's own accessor; tests
   * inject a stub here so a revert can be observed without touching schema.
   */
  migratorFor?: (orm: MikroORM) => Promise<IMigrator>;
  /** Optional logger (Fastify request-logger compatible). Defaults to console. */
  log?: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  /**
   * Optional Admin UI i18n reconciler — feature 019. When supplied, the
   * orchestrator delegates per-module bundle install (after settings
   * reconciliation, before the module's own install hook) and per-module
   * bundle removal (during hard-uninstall) so `translation_bundles` rows
   * stay aligned with the lifecycle. Omitted in tests / CLI runs that
   * don't need translation bookkeeping.
   */
  i18nReconciler?: {
    install(args: {
      moduleId: string;
      modulePath: string;
      bundlesDir: string;
    }): Promise<{ installed: string[] }>;
    remove(moduleId: string): Promise<{ removed: number }>;
  };
  /**
   * Optional Admin Command Palette actions reconciler — feature 020.
   * When supplied, install delegates per-module action UPSERT-and-prune
   * (after i18n bundles, before the install hook) and hard-uninstall
   * delegates per-module action removal so `module_actions` rows stay
   * aligned with the lifecycle. Omitted in tests / CLI runs that don't
   * need command-palette bookkeeping.
   */
  adminActionsReconciler?: {
    install(args: {
      moduleId: string;
      actions: readonly import('@b2b/contracts').ModuleAction[];
    }): Promise<{ upserted: number; pruned: number }>;
    remove(moduleId: string): Promise<{ removed: number }>;
  };
}

export interface InstallResult {
  moduleId: string;
  version: string;
  state: 'installed' | 'already-installed';
  appliedMigrations: string[];
  settings: { addedGroups: number; addedSettings: number; updatedGroups: number; updatedSettings: number };
  hookDurationMs: number;
  totalDurationMs: number;
}

export interface UninstallResult {
  moduleId: string;
  hard: boolean;
  state: 'uninstalled' | 'already-uninstalled';
  removedSettings: number;
  removedGroups: number;
  revertedMigrations: string[];
}

export interface EnableResult {
  moduleId: string;
  state: 'installed' | 'already-enabled';
}

export interface DisableResult {
  moduleId: string;
  state: 'disabled' | 'already-disabled';
  cascade: boolean;
  cascaded: string[];
}

export class LifecycleError extends Error {
  constructor(
    public readonly kind:
      | 'unknown-module'
      | 'missing-deps'
      | 'dependents-block'
      | 'wrong-state'
      | 'install-failed'
      | 'uninstall-failed'
      | 'manifest-cycle'
      | 'lock-busy'
      | 'non-deactivatable',
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class ModuleLifecycleOrchestrator {
  private readonly log: NonNullable<OrchestratorDeps['log']>;

  constructor(private readonly deps: OrchestratorDeps) {
    this.log = deps.log ?? consoleLogger();
  }

  // -------------------------------------------------------------------------
  // INSTALL
  // -------------------------------------------------------------------------

  async install(moduleId: string): Promise<InstallResult> {
    const start = Date.now();
    const entry = this.deps.registry.modules.get(moduleId);
    if (!entry) {
      throw new LifecycleError('unknown-module', `unknown module "${moduleId}"`);
    }
    const manifest = entry.manifest;

    const lease = await this.acquireLock();
    try {
      // Read existing registration row.
      const existing = await this.deps.em().findOne(ModuleRegistration, {
        moduleId,
      });
      if (existing?.state === 'installed') {
        return {
          moduleId,
          version: existing.version,
          state: 'already-installed',
          appliedMigrations: [],
          settings: { addedGroups: 0, addedSettings: 0, updatedGroups: 0, updatedSettings: 0 },
          hookDurationMs: 0,
          totalDurationMs: Date.now() - start,
        };
      }
      if (existing?.state === 'disabled') {
        throw new LifecycleError(
          'wrong-state',
          `module "${moduleId}" is installed but disabled; use module:enable`,
          { state: existing.state },
        );
      }
      if (existing?.state === 'installing') {
        throw new LifecycleError(
          'lock-busy',
          `module "${moduleId}" has a stale 'installing' record; see runbook`,
        );
      }

      // Verify deps are installed (or disabled — they're still "installed" semantically).
      const installedSet = await this.installedSet();
      const missing = this.deps.registry.graph.unresolvedDependenciesOf(
        moduleId,
        installedSet,
      );
      if (missing.length > 0) {
        await this.deps.auditLog.record({
          actorAdminUserId: null,
          action: 'module.dependency_blocked',
          objectType: 'module',
          objectId: moduleId,
          stateAfter: { command: 'install', conflicting: missing },
        });
        throw new LifecycleError(
          'missing-deps',
          `module "${moduleId}" missing dependencies: ${missing.join(', ')}`,
          { missing },
        );
      }

      // Mark 'installing' so a crash leaves a paper trail.
      await this.upsertRegistration(moduleId, {
        state: 'installing',
        version: manifest.version,
        installedAt: existing?.installedAt ?? new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      });

      let appliedMigrations: string[] = [];
      let settingsResult = { addedGroups: 0, addedSettings: 0, updatedGroups: 0, updatedSettings: 0 };
      let hookDurationMs = 0;

      try {
        // 1. Migrations — run all pending. Per research §R3, on a single
        //    instance migrations are global (linear log); installing a
        //    module's migrations also runs any prior pending ones, which is
        //    the expected outcome.
        const migrator = await this.migrator();
        const pendingBefore = await migrator.getPendingMigrations();
        if (pendingBefore.length > 0) {
          const applied = await migrator.up();
          appliedMigrations = applied.map((m) => m.name);
        }

        // 2. Settings — reuse feature 004's reconciler.
        if (manifest.settings) {
          const reconciler = new ManifestReconciler(this.deps.em());
          const result = await reconciler.apply([manifest.settings]);
          const r = result.perModule[0];
          if (r) {
            settingsResult = {
              addedGroups: r.addedGroups,
              addedSettings: r.addedSettings,
              updatedGroups: r.updatedGroups,
              updatedSettings: r.updatedSettings,
            };
          }
        }

        // 2b. Admin UI i18n bundles — feature 019. Optional reconciler;
        // when wired, refreshes translation_bundles rows for the module
        // from `<modulePath>/<bundlesDir>/<lang>.json`. Bundle-loader
        // failures bubble out of install transaction (FR-016).
        if (manifest.i18n && this.deps.i18nReconciler) {
          await this.deps.i18nReconciler.install({
            moduleId: manifest.id,
            modulePath: dirname(entry.filePath),
            bundlesDir: manifest.i18n.bundlesDir,
          });
        }

        // 2c. Admin Command Palette actions — feature 020. Optional
        // reconciler; when wired, refreshes module_actions rows for the
        // module from `manifest.actions`. Reconciler errors abort the
        // install transaction (FR-005 — duplicate-id surfaces as the
        // install failure rather than a silent drop).
        if (this.deps.adminActionsReconciler) {
          await this.deps.adminActionsReconciler.install({
            moduleId: manifest.id,
            actions: manifest.actions ?? [],
          });
        }

        // 3. Install hook — runs inside the same em context.
        if (entry.installHook) {
          const hookStart = Date.now();
          await (entry.installHook as ModuleInstallHook<EntityManager, Redis>)({
            em: this.deps.em(),
            redis: this.deps.redis,
            log: this.log,
            module: { id: manifest.id, version: manifest.version },
          });
          hookDurationMs = Date.now() - hookStart;
        }

        // 4. Mark installed.
        await this.upsertRegistration(moduleId, {
          state: 'installed',
          version: manifest.version,
          lastStateChangeAt: new Date(),
        });
      } catch (err) {
        // Rollback path: revert any migrations we just applied (in reverse).
        for (const name of [...appliedMigrations].reverse()) {
          try {
            await (await this.migrator()).down({ migrations: [name] });
          } catch (revertErr) {
            this.log.error(
              `[install-rollback] failed to revert migration ${name}: ` +
                (revertErr instanceof Error ? revertErr.message : String(revertErr)),
            );
            break;
          }
        }
        // Mark the registry as failed-uninstalled so a re-run is allowed.
        await this.upsertRegistration(moduleId, {
          state: 'uninstalled',
          lastInstallFailedAt: new Date(),
          lastInstallError:
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          lastStateChangeAt: new Date(),
        });
        await this.deps.auditLog.record({
          actorAdminUserId: null,
          action: 'module.install_failed',
          objectType: 'module',
          objectId: moduleId,
          stateAfter: {
            version: manifest.version,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          },
        });
        throw new LifecycleError(
          'install-failed',
          `install of "${moduleId}" failed: ` +
            (err instanceof Error ? err.message : String(err)),
          {
            cause: err instanceof Error ? err.message : String(err),
            revertedMigrations: appliedMigrations,
          },
        );
      }

      // Audit + pub/sub on the success path.
      await this.deps.auditLog.record({
        actorAdminUserId: null,
        action: 'module.installed',
        objectType: 'module',
        objectId: moduleId,
        stateAfter: {
          version: manifest.version,
          settings: settingsResult,
          hooks: entry.installHook ? ['install'] : [],
          migrations: appliedMigrations,
        },
      });
      await publishStateChanged(this.deps.redis, {
        moduleId,
        newState: 'installed',
      });
      // Update the in-process cache immediately so the same process sees
      // the change without waiting for the pub/sub round-trip.
      await registryCache.refreshFromDb(this.deps.em);

      return {
        moduleId,
        version: manifest.version,
        state: 'installed',
        appliedMigrations,
        settings: settingsResult,
        hookDurationMs,
        totalDurationMs: Date.now() - start,
      };
    } finally {
      await lease.release();
    }
  }

  // -------------------------------------------------------------------------
  // UNINSTALL (soft + hard)
  // -------------------------------------------------------------------------

  async uninstall(
    moduleId: string,
    opts: { hard: boolean } = { hard: false },
  ): Promise<UninstallResult> {
    const entry = this.deps.registry.modules.get(moduleId);
    // unknown-module is OK for uninstall — the registry might have an
    // orphan row we want to clean up. Use whatever we know.
    const manifest = entry?.manifest ?? null;

    const lease = await this.acquireLock();
    try {
      const row = await this.deps.em().findOne(ModuleRegistration, {
        moduleId,
      });
      if (!row || row.state === 'uninstalled') {
        return {
          moduleId,
          hard: opts.hard,
          state: 'already-uninstalled',
          removedSettings: 0,
          removedGroups: 0,
          revertedMigrations: [],
        };
      }
      if (row.state === 'installing') {
        throw new LifecycleError(
          'lock-busy',
          `module "${moduleId}" has a stale 'installing' record; see runbook`,
        );
      }

      // Block on dependents (any state except uninstalled).
      const dependents = await this.installedDependentsOf(moduleId);
      if (dependents.length > 0) {
        await this.deps.auditLog.record({
          actorAdminUserId: null,
          action: 'module.dependency_blocked',
          objectType: 'module',
          objectId: moduleId,
          stateAfter: { command: 'uninstall', conflicting: dependents },
        });
        throw new LifecycleError(
          'dependents-block',
          `cannot uninstall "${moduleId}": other modules depend on it: ${dependents.join(', ')}`,
          { dependents },
        );
      }

      // Run the manifest's uninstall hook, before any removal. A throw aborts
      // the whole uninstall and removes nothing — the settings sweep and the
      // migration revert below are both downstream of it.
      if (entry?.uninstallHook) {
        try {
          await (entry.uninstallHook as ModuleUninstallHook<EntityManager, Redis>)({
            em: this.deps.em(),
            redis: this.deps.redis,
            log: this.log,
            module: {
              id: moduleId,
              version: manifest?.version ?? row.version,
            },
            hard: opts.hard,
          });
        } catch (err) {
          this.log.error(
            `[uninstall] hook for "${moduleId}" threw: ` +
              (err instanceof Error ? err.message : String(err)),
          );
          throw new LifecycleError(
            'uninstall-failed',
            `uninstall hook for "${moduleId}" failed: ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }

      // Unregister settings (always — soft and hard both clear settings).
      const em = this.deps.em();
      const ownedSettings = await em.find(Setting, { ownerModule: moduleId });
      for (const s of ownedSettings) em.remove(s);
      const ownedGroups = await em.find(SettingGroup, {
        ownerModule: moduleId,
        isSystemProtected: false,
      });
      for (const g of ownedGroups) em.remove(g);
      await em.flush();

      let revertedMigrations: string[] = [];
      if (opts.hard) {
        revertedMigrations = await this.revertMigrationsFor(moduleId);
        // Hard uninstall deletes the row; soft preserves it as 'uninstalled'.
        await em.removeAndFlush(row);
        // Feature 019 — hard-uninstall drops the module's translation
        // bundles too. Soft-uninstall preserves them so a re-install
        // picks them up unchanged (data-model §3).
        if (this.deps.adminActionsReconciler) {
          await this.deps.adminActionsReconciler.remove(moduleId);
        }
        if (manifest?.i18n && this.deps.i18nReconciler) {
          await this.deps.i18nReconciler.remove(moduleId);
        }
      } else {
        row.state = 'uninstalled';
        row.lastStateChangeAt = new Date();
        await em.flush();
      }

      await this.deps.auditLog.record({
        actorAdminUserId: null,
        action: 'module.uninstalled',
        objectType: 'module',
        objectId: moduleId,
        stateAfter: {
          hard: opts.hard,
          settings: {
            removedSettings: ownedSettings.length,
            removedGroups: ownedGroups.length,
          },
          revertedMigrations,
          hooks: entry?.uninstallHook ? ['uninstall'] : [],
        },
      });
      await publishStateChanged(this.deps.redis, {
        moduleId,
        newState: 'uninstalled',
      });
      await registryCache.refreshFromDb(this.deps.em);

      return {
        moduleId,
        hard: opts.hard,
        state: 'uninstalled',
        removedSettings: ownedSettings.length,
        removedGroups: ownedGroups.length,
        revertedMigrations,
      };
    } finally {
      await lease.release();
    }
  }

  // -------------------------------------------------------------------------
  // ENABLE / DISABLE
  // -------------------------------------------------------------------------

  async enable(moduleId: string): Promise<EnableResult> {
    const entry = this.deps.registry.modules.get(moduleId);
    if (!entry) {
      throw new LifecycleError('unknown-module', `unknown module "${moduleId}"`);
    }
    const lease = await this.acquireLock();
    try {
      const row = await this.deps.em().findOne(ModuleRegistration, {
        moduleId,
      });
      if (!row || row.state === 'uninstalled' || row.state === 'installing') {
        throw new LifecycleError(
          'wrong-state',
          `module "${moduleId}" is not installed (state=${row?.state ?? 'none'})`,
        );
      }
      if (row.state === 'installed') {
        return { moduleId, state: 'already-enabled' };
      }
      // state === 'disabled' — verify deps are enabled.
      const enabledSet = await this.enabledSet();
      const missing = this.deps.registry.graph.unresolvedDependenciesOf(
        moduleId,
        enabledSet,
      );
      if (missing.length > 0) {
        throw new LifecycleError(
          'missing-deps',
          `cannot enable "${moduleId}": dependencies not enabled: ${missing.join(', ')}`,
          { missing },
        );
      }
      row.state = 'installed';
      row.lastStateChangeAt = new Date();
      await this.deps.em().flush();
      await this.deps.auditLog.record({
        actorAdminUserId: null,
        action: 'module.enabled',
        objectType: 'module',
        objectId: moduleId,
        stateAfter: { version: row.version },
      });
      await publishStateChanged(this.deps.redis, { moduleId, newState: 'installed' });
      await registryCache.refreshFromDb(this.deps.em);
      await resumeWorkersFor(moduleId);
      return { moduleId, state: 'installed' };
    } finally {
      await lease.release();
    }
  }

  async disable(
    moduleId: string,
    opts: { cascade: boolean } = { cascade: false },
  ): Promise<DisableResult> {
    const entry = this.deps.registry.modules.get(moduleId);
    if (!entry) {
      throw new LifecycleError('unknown-module', `unknown module "${moduleId}"`);
    }
    const lease = await this.acquireLock();
    try {
      const row = await this.deps.em().findOne(ModuleRegistration, {
        moduleId,
      });
      if (!row || row.state === 'uninstalled' || row.state === 'installing') {
        throw new LifecycleError(
          'wrong-state',
          `module "${moduleId}" is not installed (state=${row?.state ?? 'none'})`,
        );
      }
      if (row.state === 'disabled') {
        return { moduleId, state: 'already-disabled', cascade: false, cascaded: [] };
      }

      this.assertDeactivatable(moduleId);

      // Find currently-enabled dependents, over both kinds of edge.
      const directDependents = this.gatingDependentsOf(moduleId);
      const em = this.deps.em();
      const dependentRows = await em.find(ModuleRegistration, {
        moduleId: { $in: directDependents },
        state: 'installed',
      });
      const enabledDependents = dependentRows.map((r) => r.moduleId);

      const cascaded: string[] = [];
      if (enabledDependents.length > 0) {
        if (!opts.cascade) {
          await this.deps.auditLog.record({
            actorAdminUserId: null,
            action: 'module.dependency_blocked',
            objectType: 'module',
            objectId: moduleId,
            stateAfter: { command: 'disable', conflicting: enabledDependents },
          });
          throw new LifecycleError(
            'dependents-block',
            `cannot disable "${moduleId}": dependent enabled modules: ${enabledDependents.join(', ')}`,
            { dependents: enabledDependents },
          );
        }
        // Cascade: disable transitive dependents in reverse-topo order, then this one.
        const transitive = this.deps.registry.graph.transitiveDependentsOf(moduleId);
        // Filter to those currently enabled.
        const transitiveRows = await em.find(ModuleRegistration, {
          moduleId: { $in: transitive },
          state: 'installed',
        });
        const enabledTransitive = new Set(transitiveRows.map((r) => r.moduleId));
        const order = this.deps.registry.graph
          .reverseTopologicalOrder()
          .filter((id) => enabledTransitive.has(id));
        // Every module the cascade would reach is checked before the first
        // write. A cascade that stops half-way through is worse than the
        // refusal it was trying to avoid, and the dangerous shape here is a
        // perfectly ordinary target whose dependent is the module the platform
        // cannot run without.
        for (const dep of order) this.assertDeactivatable(dep);
        // A cascade cannot cross an acknowledged edge, and refusing is the only
        // honest answer: those edges are mutual by construction — that is why
        // they are withheld from `dependencies` — so there is no reverse-topo
        // position for them, and disabling the target anyway would leave the
        // acknowledging module resolving a port whose owner is gone. Naming it
        // lets the operator disable it explicitly first (feature 073, FR-008).
        const cascadeSet = new Set([...order, moduleId]);
        const stranded = new Set<string>();
        for (const member of cascadeSet) {
          for (const dependent of this.acknowledgedDependentsOf(member)) {
            if (!cascadeSet.has(dependent)) stranded.add(dependent);
          }
        }
        const strandedRows = await em.find(ModuleRegistration, {
          moduleId: { $in: [...stranded] },
          state: 'installed',
        });
        if (strandedRows.length > 0) {
          const blocking = strandedRows.map((r) => r.moduleId).sort();
          await this.deps.auditLog.record({
            actorAdminUserId: null,
            action: 'module.dependency_blocked',
            objectType: 'module',
            objectId: moduleId,
            stateAfter: { command: 'disable', conflicting: blocking },
          });
          throw new LifecycleError(
            'dependents-block',
            `cannot disable "${moduleId}": these modules resolve a port it owns ` +
              `through an acknowledged edge and cannot be cascaded: ${blocking.join(', ')}`,
            { dependents: blocking },
          );
        }
        for (const dep of order) {
          const depRow = await em.findOne(ModuleRegistration, { moduleId: dep });
          if (!depRow || depRow.state !== 'installed') continue;
          depRow.state = 'disabled';
          depRow.lastStateChangeAt = new Date();
          await em.flush();
          cascaded.push(dep);
          await pauseWorkersFor(dep);
          await this.deps.auditLog.record({
            actorAdminUserId: null,
            action: 'module.disabled',
            objectType: 'module',
            objectId: dep,
            stateAfter: { version: depRow.version, cascade: true, cascaded: [] },
          });
          await publishStateChanged(this.deps.redis, { moduleId: dep, newState: 'disabled' });
        }
      }

      // Disable the target itself.
      row.state = 'disabled';
      row.lastStateChangeAt = new Date();
      await em.flush();
      await pauseWorkersFor(moduleId);
      await this.deps.auditLog.record({
        actorAdminUserId: null,
        action: 'module.disabled',
        objectType: 'module',
        objectId: moduleId,
        stateAfter: {
          version: row.version,
          cascade: opts.cascade,
          cascaded,
        },
      });
      await publishStateChanged(this.deps.redis, { moduleId, newState: 'disabled' });
      await registryCache.refreshFromDb(this.deps.em);

      return { moduleId, state: 'disabled', cascade: opts.cascade, cascaded };
    } finally {
      await lease.release();
    }
  }

  /**
   * The platform axis honours `nonDeactivatable` — D-36a item 3, issue #37.
   *
   * Until this existed nothing on this axis read the field for any module, so
   * `module:disable auth` proceeded and the declaration was a comment that
   * looked like a guard.
   *
   * There is deliberately **no `--force`**. `uninstall --hard --force` guards
   * data loss, a consequence an operator can weigh at the prompt; this guards
   * a deployment that can no longer authenticate the operator who would undo
   * it, which they cannot. The operator axis already refuses the same flip
   * (`activation.commands.ts`), so both axes now agree.
   */
  private assertDeactivatable(moduleId: string): void {
    const activation = this.deps.registry.modules.get(moduleId)?.manifest.activation;
    if (!activation || !('nonDeactivatable' in activation)) return;
    throw new LifecycleError(
      'non-deactivatable',
      `module "${moduleId}" declares itself non-deactivatable: ${activation.reason}`,
      { moduleId, reason: activation.reason },
    );
  }

  // -------------------------------------------------------------------------
  // STATUS
  // -------------------------------------------------------------------------

  async status(): Promise<ModuleListItem[]> {
    const rows = await this.deps.em().find(ModuleRegistration, {});
    const byId = new Map(rows.map((r) => [r.moduleId, r]));
    const out: ModuleListItem[] = [];

    const enabledSet = await this.installedSet();
    const seen = new Set<string>();

    for (const [id, entry] of this.deps.registry.modules) {
      seen.add(id);
      const row = byId.get(id);
      const flags: ModuleListItemFlag[] = [];
      if (row && entry.manifest.version !== row.version) {
        flags.push('pending-upgrade');
      }
      const missing = this.deps.registry.graph.unresolvedDependenciesOf(
        id,
        new Set([...byId.entries()].filter(([, r]) => r.state !== 'uninstalled').map(([k]) => k)),
      );
      if (missing.length > 0) flags.push('dep-missing');
      if (row?.state === 'installed') {
        const depDisabled = entry.manifest.dependencies.some((d) => !enabledSet.has(d));
        if (depDisabled) flags.push('dep-disabled');
      }
      out.push({
        id,
        name: entry.manifest.name,
        description: entry.manifest.description ?? null,
        version: {
          registered: row?.version ?? null,
          onDisk: entry.manifest.version,
        },
        state: (row?.state ?? 'not-installed') as ModuleListItem['state'],
        dependencies: entry.manifest.dependencies,
        flags,
        license: entry.manifest.license ?? null,
        installedAt: row?.installedAt.toISOString() ?? null,
        lastStateChangeAt: row?.lastStateChangeAt.toISOString() ?? null,
      });
    }

    // Orphan rows: registry has it but no manifest on disk.
    for (const [id, row] of byId) {
      if (seen.has(id)) continue;
      out.push({
        id,
        name: id,
        description: null,
        version: {
          registered: row.version,
          onDisk: null,
        },
        state: row.state as ModuleListItem['state'],
        dependencies: [],
        flags: ['orphan'],
        license: null,
        installedAt: row.installedAt.toISOString(),
        lastStateChangeAt: row.lastStateChangeAt.toISOString(),
      });
    }

    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async acquireLock(): Promise<LifecycleLeaseHandle> {
    try {
      return await acquireLifecycleLock(this.deps.redis);
    } catch (err) {
      throw new LifecycleError(
        'lock-busy',
        `lifecycle lock is held by another process; retry shortly`,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  private async upsertRegistration(
    moduleId: string,
    patch: Partial<{
      state: RegistryState;
      version: string;
      installedAt: Date;
      lastStateChangeAt: Date;
      lastInstallFailedAt: Date | null;
      lastInstallError: string | null;
    }>,
  ): Promise<void> {
    const em = this.deps.em();
    const row = await em.findOne(ModuleRegistration, { moduleId });
    if (row) {
      Object.assign(row, patch);
      await em.flush();
      return;
    }
    const created = em.create(ModuleRegistration, {
      moduleId,
      state: patch.state ?? 'installing',
      version: patch.version ?? '0.0.0',
      installedAt: patch.installedAt ?? new Date(),
      lastStateChangeAt: patch.lastStateChangeAt ?? new Date(),
      lastInstallFailedAt: patch.lastInstallFailedAt ?? null,
      lastInstallError: patch.lastInstallError ?? null,
    });
    await em.persistAndFlush(created);
  }

  /** Set of moduleIds whose state is 'installed' OR 'disabled' (i.e. present, not removed). */
  private async installedSet(): Promise<Set<string>> {
    const rows = await this.deps.em().find(ModuleRegistration, {
      state: { $in: ['installed', 'disabled'] },
    });
    return new Set(rows.map((r) => r.moduleId));
  }

  /**
   * Set of moduleIds that are currently ENABLED (state='installed'). Distinct
   * from {@link installedSet}, which also counts disabled modules as present.
   * Enabling a module requires every dependency to be enabled — a merely
   * present-but-disabled dependency must NOT satisfy the check.
   */
  private async enabledSet(): Promise<Set<string>> {
    const rows = await this.deps.em().find(ModuleRegistration, {
      state: 'installed',
    });
    return new Set(rows.map((r) => r.moduleId));
  }

  private async installedDependentsOf(moduleId: string): Promise<string[]> {
    const rows = await this.deps.em().find(ModuleRegistration, {
      state: { $in: ['installed', 'disabled'] },
    });
    const installed = new Set(rows.map((r) => r.moduleId));
    return this.gatingDependentsOf(moduleId).filter((id) => installed.has(id));
  }

  /**
   * Direct dependents over **both** kinds of edge — feature 073, FR-008.
   *
   * `registry.graph` is built from `manifest.dependencies` alone because it has
   * to be a DAG: it computes the install order. That leaves out the handful of
   * real port edges the manifests withhold for exactly that reason, and reading
   * only the DAG here is what let the two presence axes disagree — the operator
   * axis refuses to switch `price_lists` off under `catalog`, so this one must
   * too, or the same platform answers the same question two ways depending on
   * which door the operator used.
   */
  private gatingDependentsOf(moduleId: string): string[] {
    return [
      ...new Set([
        ...this.deps.registry.graph.dependentsOf(moduleId),
        ...this.acknowledgedDependentsOf(moduleId),
      ]),
    ].sort();
  }

  /** The modules that acknowledge a withheld port edge onto `moduleId`. */
  private acknowledgedDependentsOf(moduleId: string): string[] {
    const out: string[] = [];
    for (const [id, entry] of this.deps.registry.modules) {
      const acknowledged = entry.manifest.acknowledgedDependencies ?? [];
      if (acknowledged.some((edge) => edge.moduleId === moduleId)) out.push(id);
    }
    return out.sort();
  }

  private async migrator(): Promise<IMigrator> {
    const accessor = this.deps.migratorFor ?? (async (orm: MikroORM) => orm.getMigrator());
    return accessor(this.deps.orm);
  }

  /**
   * Revert the migrations a module owns, newest first.
   *
   * Ownership comes from `MIGRATION_REGISTRY` (a data-only import — the
   * orchestrator must never pull in the ORM config) and the migration name is
   * always `cls.name`, which is exactly what `mikro_orm_migrations.name`
   * stores. Ordering is ascending timestamp, which for a single module is the
   * resolved execution order: `orderMigrations` guarantees intra-module
   * chronology (contracts/ordering-algorithm.md, invariant I2).
   *
   * Best-effort: a module with no migrations logs a warning and reverts
   * nothing, and a failing revert stops the loop rather than widening the gap.
   */
  private async revertMigrationsFor(moduleId: string): Promise<string[]> {
    const names = MIGRATION_REGISTRY.filter((entry) => entry.moduleId === moduleId)
      .map((entry) => entry.cls.name)
      .sort();
    if (names.length === 0) {
      this.log.warn(
        `[uninstall] module "${moduleId}" owns no registered migration; ` +
          `skipping migration revert. Hard-uninstall relies on the uninstall hook.`,
      );
      return [];
    }
    const migrator = await this.migrator();
    const reverted: string[] = [];
    for (const name of names.reverse()) {
      try {
        const result = await migrator.down({ migrations: [name] });
        for (const m of result) reverted.push(m.name);
      } catch (err) {
        this.log.warn(
          `[uninstall] failed to revert migration ${name}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        // Stop reverting further migrations to avoid making the gap worse.
        break;
      }
    }
    return reverted;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function consoleLogger(): NonNullable<OrchestratorDeps['log']> {
  return {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };
}
