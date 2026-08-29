import { dirname } from 'node:path';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { IMigrator } from '@mikro-orm/core';
import type { Redis } from 'ioredis';
import { settingsManifestWithRecentActivity } from '@endora-commerce/contracts';
import type {
  ModuleInstallHook,
  ModuleUninstallHook,
  RegistryState,
  ModuleListItem,
  ModuleListItemFlag,
} from '@endora-commerce/contracts';
import { ManifestReconciler } from '../../kernel/settings/manifest-reconciler.js';
import { Setting } from '../../kernel/settings/setting.entity.js';
import { SettingGroup } from '../../kernel/settings/setting-group.entity.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import { ModuleRegistration } from '../../kernel/lifecycle/module-registration.entity.js';
import {
  acquireLifecycleLock,
  type LifecycleLeaseHandle,
} from './lock.js';
import {
  publishStateChanged,
  registryCache,
} from '../../kernel/lifecycle/registry-cache.js';
import {
  pauseWorkersFor,
  resumeWorkersFor,
} from '../../kernel/lifecycle/plugin-helpers.js';
import type {
  LoadedLifecycleParticipant,
  LoadedManifestRegistry,
} from './manifest-loader.js';
import { moduleDependencyCycles } from './dep-graph.js';
import type { MigrationOwnership } from './migration-ownership.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  orm: MikroORM;
  redis: Redis;
  em: () => EntityManager;
  auditLog: AuditPort;
  /**
   * The loaded manifest registry — built once at boot or per CLI run.
   *
   * It carries the **lifecycle participants** as well as the manifests (feature
   * 080, T036a / D-159): the two modules that keep a projection of the manifest
   * set — `_i18n`'s `translation_bundles`, `admin_actions`' `module_actions` —
   * declare a `lifecycleParticipant` in their `manifest.ts` and the orchestrator
   * collects them from here. They used to arrive as two optional injected
   * services, which only a composition root could supply, so an install from a
   * terminal reconciled neither while the same install from `/platform/modules`
   * reconciled both.
   */
  registry: LoadedManifestRegistry;
  /**
   * Who owns which migration — the input `uninstall --hard` reverts by.
   *
   * **Injected, and a design decision rather than an `await`** (feature 080,
   * T033 / D-155.3(c)). This used to be a static `MIGRATION_REGISTRY` import,
   * justified in its own comment by "the orchestrator must never pull in the
   * ORM config" — which is right, and is why the merged value arrives as a
   * value rather than as an `import` of anything async. The merge itself
   * belongs to whoever composed the platform, because only a composition root
   * knows which packages this instance installed; `composition.ts` passes
   * `(await configuredMigrations()).ownership`.
   *
   * Omitting it **refuses** every hard uninstall, naming this field. It used to
   * default to the committed core registry (`coreMigrationOwnership()`), which
   * is a reach out of the platform into `backend/src/db` — the last thing
   * standing between this file and the host package (D-160.11) — and the
   * default was never the interesting half of that decision. The five `module:*`
   * CLI scripts, which are the callers it existed for, now pass
   * `coreMigrationOwnership()` themselves and say why in place: a platform
   * command must not compose (D-157.2), so it answers for core modules and for
   * nothing else, and a hard uninstall of a package module is refused from the
   * terminal rather than reverting core's rows and leaving the package's
   * behind. The refusal is the same one either way; what changed is that the
   * host chooses it.
   */
  migrationOwnership?: MigrationOwnership;
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

      await this.assertInstallClosesNoCycle(moduleId, installedSet);

      // Before the registration row moves: an install this orchestrator cannot
      // reconcile is refused rather than performed and reported as done.
      const participants = this.participantsOrRefuse('install', moduleId);

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
        //
        // The manifest's own declaration **plus** the visibility Setting its
        // recent-activity eligibility implies (feature 080, T042j / D-163.1).
        // One derivation with two callers, this and the boot reconcile: a
        // package has only this one, since D-157.6(b) makes `install` its sole
        // settings author, so a second copy of the merge would mean a packaged
        // module's dashboard control existing on one path and not the other.
        const settingsManifest = settingsManifestWithRecentActivity(
          manifest,
          entry.recentActivity,
        );
        if (settingsManifest) {
          const reconciler = new ManifestReconciler(this.deps.em());
          const result = await reconciler.apply([settingsManifest]);
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

        // 2b. Every module that keeps a projection of the manifest set gets
        // told, in one pass (feature 080, T036a / D-159). `_i18n` refreshes
        // `translation_bundles` from `<modulePath>/<bundlesDir>/<lang>.json`
        // and `admin_actions` upserts-and-prunes `module_actions` from
        // `manifest.actions`; each decides for itself whether this manifest
        // is one it projects, which is why the orchestrator no longer asks
        // about `manifest.i18n`. A participant that throws aborts the install
        // and reverts its migrations, which is what FR-016 rests on — an
        // operator installing a module with an unreadable bundle is told while
        // they can still choose not to install it.
        //
        // The `em` is **this operation's**: the two reconcilers accepted a
        // transactional one and were called without it, so their rows landed
        // on a fork made when the platform was composed rather than in the
        // work the orchestrator is doing.
        {
          const participantEm = this.deps.em();
          for (const { moduleId: owner, participant } of participants) {
            await participant.onModuleInstalled({
              moduleId: manifest.id,
              manifest,
              modulePath: dirname(entry.filePath),
              em: participantEm,
              log: taggedLogger(this.log, owner),
            });
          }
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

      // D-69 (issue #145) — the declaration that refuses `disable` refuses this
      // too, soft and hard alike. Uninstall is disable *plus* the settings sweep
      // below and, on `--hard`, the migration revert, so a lock that forbids the
      // smaller operation cannot coherently permit the larger one. Raised after
      // the `already-uninstalled` no-op (nothing left to protect) and before the
      // dependents check, the uninstall hook and the sweep — the dependents block
      // covers the locked set only by accident today, since nothing stops an
      // operator uninstalling the dependents first.
      this.assertDeactivatable(moduleId);

      // A hard uninstall is the half that does not self-heal (D-159 §7): both
      // boot reconcilers iterate the manifest registry, so `uninstall --hard`
      // followed by `pnpm remove` leaves rows no boot pass will ever see the
      // manifest for again. Refuse before the uninstall hook rather than after,
      // for the reason the migration-revert refusal states in the same file: a
      // hard uninstall that removes the registration and leaves the projection
      // is the one outcome it may not have. A **soft** uninstall reaches no
      // participant at all — it preserves the module's data by design — so it
      // is not gated on this.
      const participants = opts.hard
        ? this.participantsOrRefuse('uninstall --hard', moduleId)
        : [];

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
        // Hard-uninstall drops every projection of this module's manifest —
        // its translation bundles and its palette actions. Soft-uninstall
        // preserves them so a re-install picks them up unchanged
        // (data-model §3), which is why this sits in the `hard` branch.
        //
        // `manifest` is nullable here and the participants are told so: an
        // orphan registration row, whose module this instance no longer has,
        // is exactly the case whose rows nothing else will ever remove.
        for (const { moduleId: owner, participant } of participants) {
          await participant.onModuleHardUninstalled({
            moduleId,
            manifest,
            em,
            log: taggedLogger(this.log, owner),
          });
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
   * It guards **every platform-axis withdrawal**: `disable` (the target and
   * every member of a cascade) and, since D-69 / issue #145, `uninstall` on the
   * soft and hard path alike. Uninstall is disable plus the settings sweep plus
   * the schema revert, so the same declaration has to reach it.
   *
   * There is deliberately **no `--force`**. `uninstall --hard --force` guards
   * data loss, a consequence an operator can weigh at the prompt; this guards
   * a deployment that can no longer authenticate the operator who would undo
   * it, which they cannot. If the declaration is wrong for a module, the fix is
   * the manifest, which is reviewed. The operator axis already refuses the same
   * flip (`activation.commands.ts`), so both axes agree.
   *
   * It reads the **manifest**, so a registry row with no manifest — an orphan —
   * is not covered, deliberately: cleaning those up is the one job `uninstall`
   * has that nothing else does. `test/unit/_lifecycle/orchestrator.test.ts`
   * pins that carve-out.
   */
  /**
   * Refuse an install whose arrival closes a dependency cycle, naming every
   * member (feature 081, FR-012).
   *
   * A cycle is not thrown by `orderMigrations`: the manifest graph is the whole
   * cross-module migration order now, and a manifest can arrive from an
   * installed package, so refusing there would let one stranger's declaration
   * stop a shop's own schema from migrating. It comes back as a diagnostic with
   * three readers instead, and this is the third — the moment the loop would be
   * *created* is the one moment where refusing costs nothing, because nothing
   * downstream of it exists yet.
   *
   * The graph is the **installed** set plus the arriving module, and only a
   * component holding the arriving module is refused: a loop between two other
   * modules is somebody else's problem, and blocking every later install on it
   * would reproduce the platform-wide stall the no-throw rule exists to
   * prevent. It reuses `moduleDependencyCycles` rather than
   * `ModuleDepGraph.hasCycle` — one walk, so the install refusal and the
   * migration order cannot disagree about what a cycle is, and the operator
   * reads the same member list in both. The walk is `dep-graph.ts`'s since
   * D-160.11; `src/db/migration-order.ts` reads the same function and adds its
   * own wording.
   */
  private async assertInstallClosesNoCycle(
    moduleId: string,
    installed: ReadonlySet<string>,
  ): Promise<void> {
    const nodes = new Set<string>([...installed, moduleId]);
    const graph = new Map<string, readonly string[]>();
    for (const id of nodes) {
      // An orphan registration row — installed, no manifest — declares nothing
      // we can read, so it contributes a node and no edge.
      const declared = this.deps.registry.modules.get(id)?.manifest.dependencies ?? [];
      graph.set(
        id,
        declared.filter((dependency) => nodes.has(dependency)),
      );
    }

    const closed = moduleDependencyCycles(graph).find((members) => members.includes(moduleId));
    if (!closed) return;

    await this.deps.auditLog.record({
      actorAdminUserId: null,
      action: 'module.dependency_blocked',
      objectType: 'module',
      objectId: moduleId,
      stateAfter: { command: 'install', cycle: closed },
    });
    throw new LifecycleError(
      'manifest-cycle',
      `module "${moduleId}" cannot be installed: with it, the modules ` +
        `[${closed.join(', ')}] depend on each other in a loop. Nothing can be ` +
        `installed, migrated or removed before the modules it depends on, so a loop has ` +
        `no order at all. Fix the \`dependencies\` array in one of them.`,
      { moduleId, cycle: closed },
    );
  }

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
   * Ownership comes from an injected {@link MigrationOwnership} — a data-only
   * value, because the orchestrator must never pull in the ORM config — and the
   * migration name is always `cls.name`, which is exactly what
   * `mikro_orm_migrations.name` stores. Ordering is ascending class name, which
   * for a single module is the resolved execution order: `orderMigrations`
   * emits a module's migrations contiguously and in ascending timestamp order,
   * and the timestamp is the head of the name
   * (specs/081-per-module-migration-order/contracts/ordering-algorithm.md,
   * invariants J2 and J3).
   *
   * ## The empty case is two different answers, and only one of them is fine
   *
   * This used to warn and return `[]` whenever the filter came back empty, so
   * an installed extension package — whose migrations reach the order at
   * runtime and never reach the committed core registry (D-119/D-155) — **hard
   * uninstalled to a warning and left its table in the database**. That is data
   * left behind by an operation the operator believes removed it, on precisely
   * the population the mechanism exists for (D-155.3(c)).
   *
   * So the two are separated at the seam that knows the difference:
   * `migrationNamesFor` answers `[]` for *"this module owns no migration"* —
   * ordinary, and 39 core modules are in it — and `null` for *"the registry I
   * was handed cannot answer for this module"*. The first is logged; the second
   * throws, because reverting nothing and reporting success is the one outcome
   * a hard uninstall may not have.
   *
   * A failing revert still stops the loop rather than widening the gap.
   */
  /**
   * The lifecycle participants this operation must run — or a refusal.
   *
   * The same two-answers distinction {@link revertMigrationsFor} makes, on the
   * other half of the same operation. `[]` is *"I enumerated the modules and
   * none keeps a projection of the manifest set"* and is an ordinary answer a
   * fixture registry gives; `null` is *"I cannot enumerate them"*, and an
   * install performed on that answer reconciles nothing and reports success —
   * which is precisely the shape this task closed on the CLI side, so it is not
   * re-introduced here as a default.
   */
  private participantsOrRefuse(
    operation: string,
    moduleId: string,
  ): readonly LoadedLifecycleParticipant<EntityManager>[] {
    const participants = this.deps.registry.participants;
    if (participants === null) {
      throw new Error(
        `[${operation}] refusing to ${operation} "${moduleId}": the manifest registry this ` +
          `orchestrator was given cannot enumerate the lifecycle participants, so it cannot ` +
          `refresh the projections the manifest set drives — the module's translation bundles ` +
          `and its command-palette actions. Performing the operation anyway would report ` +
          `success for an install that installed no bundle, or for a hard uninstall that left ` +
          `rows nothing will ever remove. Build the registry with buildStaticRegistry() or ` +
          `discoverManifests(), both of which collect participants; a registry literal must ` +
          `say \`participants: []\` when it deliberately carries none.`,
      );
    }
    return participants as readonly LoadedLifecycleParticipant<EntityManager>[];
  }

  private async revertMigrationsFor(moduleId: string): Promise<string[]> {
    const ownership = this.deps.migrationOwnership;
    if (ownership === undefined) {
      throw new Error(
        `[uninstall] refusing to hard-uninstall "${moduleId}": this orchestrator was given no ` +
          `'migrationOwnership', so it cannot enumerate any module's migration chain and ` +
          `cannot say whether there is anything to revert. Reverting nothing here would drop ` +
          `the module's registration and leave its tables in the database, which is the one ` +
          `outcome a hard uninstall may not have. A composition root passes ` +
          `(await configuredMigrations()).ownership; a platform command that composes nothing ` +
          `passes coreMigrationOwnership() and is then refused for a package module, which is ` +
          `the honest answer — see src/db/configured-migrations.ts.`,
      );
    }
    const names = ownership.migrationNamesFor(moduleId);
    if (names === null) {
      throw new Error(
        `[uninstall] refusing to hard-uninstall "${moduleId}": the migration registry this ` +
          `orchestrator was given covers ${ownership.coveredModuleIds.size} module(s) and not ` +
          `that one, so it cannot enumerate the module's chain and cannot say whether there is ` +
          `anything to revert. Reverting nothing here would drop the module's registration and ` +
          `leave its tables in the database, which is the one outcome a hard uninstall may not ` +
          `have. An installed extension package is the case this happens in: its migrations are ` +
          `discovered at runtime (D-119/D-155), so the orchestrator must be constructed with the ` +
          `merged 'migrationOwnership' — see src/db/configured-migrations.ts.`,
      );
    }
    if (names.length === 0) {
      this.log.warn(
        `[uninstall] module "${moduleId}" owns no registered migration; ` +
          `skipping migration revert. Hard-uninstall relies on the uninstall hook.`,
      );
      return [];
    }
    const migrator = await this.migrator();
    const reverted: string[] = [];
    // Copied before reversing: the ownership value is shared for the process
    // and `reverse()` mutates in place.
    for (const name of [...names].reverse()) {
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

/**
 * The orchestrator's logger, tagged with the participant that is writing.
 *
 * A participant runs on *another* module's install, so an untagged line reads
 * as the installed module's own and sends a reader to the wrong `manifest.ts`.
 */
function taggedLogger(
  log: NonNullable<OrchestratorDeps['log']>,
  moduleId: string,
): NonNullable<OrchestratorDeps['log']> {
  return {
    info: (msg) => log.info(`[${moduleId}] ${msg}`),
    warn: (msg) => log.warn(`[${moduleId}] ${msg}`),
    error: (msg) => log.error(`[${moduleId}] ${msg}`),
  };
}

function consoleLogger(): NonNullable<OrchestratorDeps['log']> {
  return {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };
}
