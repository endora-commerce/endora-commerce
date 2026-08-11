import type Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RegistryState } from '@b2b/contracts';
import { ModuleRegistration } from '../entities/module-registration.entity.js';
import { enterSystemScope } from '../../../kernel/scope.js';
import {
  resolveActivation,
  type ModuleActivationDeclaration,
} from './activation-resolver.js';

export const ENABLED_SET_KEY = 'b2b:module:enabled-set';
export const STATE_CHANGED_CHANNEL = 'b2b:module:state-changed';
export const FALLBACK_TTL_MS = 5_000;

/**
 * Per-process cache of module presence. Hot path for the
 * `defineModuleRoutes` / `defineModuleWorker` / `subscribeForModule` /
 * `requireModuleEnabled` wrappers — every request hits it, so the read side
 * MUST stay in-memory after the cold start.
 *
 * It holds **both** presence axes (feature 073):
 *
 *  - platform availability, from `module_registrations`;
 *  - operator activation, from the declared activation `Setting` rows.
 *
 * They are rebuilt in the same refresh so a process that missed a
 * notification cannot hold the two axes in disagreement. Combining them is
 * `ModuleEffectiveState`'s job, not this class's: here they stay separate,
 * because the Admin UI has to tell "not installed here" from "switched off".
 *
 * The cache keeps itself fresh by subscribing to the
 * `b2b:module:state-changed` pub/sub channel. If that connection drops, a
 * background timer re-reads from PostgreSQL every `FALLBACK_TTL_MS` until it
 * recovers — PostgreSQL is the authority and stays reachable during a Redis
 * outage, so degraded means *stale*, not *everything off*.
 */
export class ModuleRegistryCache {
  private enabled = new Set<string>();
  /** Every registry row's state, including the non-installed ones. */
  private platformStates = new Map<string, RegistryState>();
  /** Resolved operator activation, per declaring module. */
  private activation = new Map<string, boolean>();
  private declarations = new Map<string, ModuleActivationDeclaration>();
  private subscriber: Redis | null = null;
  private degraded = false;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private fallbackStopped = false;

  isEnabled(moduleId: string): boolean {
    return this.enabled.has(moduleId);
  }

  enabledIds(): string[] {
    return [...this.enabled].sort();
  }

  /** Platform axis detail for the presence projection. */
  platformStateOf(moduleId: string): RegistryState | 'not-installed' {
    return this.platformStates.get(moduleId) ?? 'not-installed';
  }

  /**
   * Resolved activation for a module that declares a control, or `undefined`
   * when nothing has been resolved for it yet.
   */
  activationValue(moduleId: string): boolean | undefined {
    return this.activation.get(moduleId);
  }

  activationDeclaration(moduleId: string): ModuleActivationDeclaration | undefined {
    return this.declarations.get(moduleId);
  }

  /**
   * The module that declares `settingCode` as its activation control, if any.
   * Used by the settings write guards: an activation code has exactly one
   * legitimate door, and it is not `PUT /settings/:code/value` (FR-009).
   */
  activationDeclarationByCode(settingCode: string): ModuleActivationDeclaration | undefined {
    for (const declaration of this.declarations.values()) {
      if (declaration.settingCode === settingCode) return declaration;
    }
    return undefined;
  }

  /**
   * Install the activation declarations distilled from the manifests. Kept as
   * plain data so the hot path never imports the manifest graph. Refreshing
   * without them resolves the platform axis only, which is exactly the
   * behaviour of a module that has declared no control.
   */
  setActivationDeclarations(declarations: readonly ModuleActivationDeclaration[]): void {
    this.declarations = new Map(declarations.map((d) => [d.moduleId, d]));
  }

  /** Union of everything the registry knows and everything that declared a control. */
  knownModuleIds(): string[] {
    return [...new Set([...this.platformStates.keys(), ...this.declarations.keys()])].sort();
  }

  /**
   * Cold-start the cache from the registry table and arm the pub/sub
   * subscriber. Safe to call multiple times — subsequent calls re-read
   * the registry but do not re-subscribe.
   */
  async start(opts: {
    redis: Redis;
    redisSubscriber: Redis;
    em: () => EntityManager;
    /** Activation declarations from the loaded manifests (feature 073). */
    activationDeclarations?: readonly ModuleActivationDeclaration[];
  }): Promise<void> {
    if (opts.activationDeclarations) {
      this.setActivationDeclarations(opts.activationDeclarations);
    }
    await this.refreshFromDb(opts.em);
    if (this.subscriber) return;
    this.subscriber = opts.redisSubscriber;
    await this.subscriber.subscribe(STATE_CHANGED_CHANNEL);
    this.subscriber.on('message', (channel) => {
      if (channel !== STATE_CHANGED_CHANNEL) return;
      void this.refreshFromDb(opts.em).catch((err) => {
        // Slip into degraded mode; the fallback timer keeps re-reading.
        this.enterDegradedMode(opts.em);

        console.warn(
          `[module-lifecycle] registry-cache refresh failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    });
    this.subscriber.on('end', () => {
      this.enterDegradedMode(opts.em);
    });
    // Mirror to Redis SET so other processes can warm-read on cold start.
    await opts.redis.del(ENABLED_SET_KEY);
    if (this.enabled.size > 0) {
      await opts.redis.sadd(ENABLED_SET_KEY, ...this.enabled);
    }
  }

  /**
   * Test seam — replaces both axes without touching Redis or the database.
   * `ids` seeds platform availability; `opts.deactivated` seeds the operator
   * axis to off, which is the axis an operator actually drives.
   */
  __setEnabledForTesting(
    ids: readonly string[],
    opts?: { deactivated?: readonly string[] },
  ): void {
    this.enabled = new Set(ids);
    this.platformStates = new Map(ids.map((id) => [id, 'installed' as RegistryState]));
    this.activation = new Map(ids.map((id) => [id, true]));
    for (const id of opts?.deactivated ?? []) {
      this.activation.set(id, false);
    }
  }

  /**
   * Test seam — re-resolve the **operator** axis from the database, leaving the
   * seeded platform axis alone.
   *
   * The shared test harness never populates `module_registrations`; it seeds
   * the enabled-set directly through `__setEnabledForTesting`. A full
   * `refreshFromDb` there would find an empty registry table and take every
   * gated route down mid-run, so a test that has just written an activation
   * value needs this narrower refresh to observe it.
   *
   * Production never calls it: a partial refresh is exactly how the two axes
   * would drift apart in a process that missed a notification, which is why
   * `refreshFromDb` rebuilds both together.
   */
  async __refreshActivationForTesting(em: () => EntityManager): Promise<void> {
    this.activation = await resolveActivation(em(), [...this.declarations.values()]);
  }

  /** True when the pub/sub side is unhealthy and the cache is TTL-refreshing. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** Refresh both axes from the source-of-truth tables. Idempotent. */
  async refreshFromDb(em: () => EntityManager): Promise<void> {
    const fork = em();
    const rows = await fork.find(ModuleRegistration, {});
    const freshEnabled = new Set<string>();
    const freshStates = new Map<string, RegistryState>();
    for (const r of rows) {
      freshStates.set(r.moduleId, r.state);
      if (r.state === 'installed') freshEnabled.add(r.moduleId);
    }
    const freshActivation = await resolveActivation(fork, [...this.declarations.values()]);
    this.enabled = freshEnabled;
    this.platformStates = freshStates;
    this.activation = freshActivation;
    this.clearDegradedMode();
  }

  /**
   * Degraded-mode refresh. Runs on a timer rather than at the seam: the
   * wrappers' check must stay synchronous (FR-004), so a lazy
   * `await maybeRefresh()` on the hot path is not available.
   *
   * Refreshing from PostgreSQL rather than blanking the sets is deliberate.
   * Fail-closed applies to *unresolved* state, not to stale state; treating a
   * Redis blip as "every module is off" would take the platform down, and the
   * database — the actual authority — is still reachable.
   */
  private enterDegradedMode(em: () => EntityManager): void {
    this.degraded = true;
    // A disconnecting ioredis client keeps emitting `'end'` while it retries,
    // so without this an explicitly stopped cache re-arms itself and outlives
    // its owner — polling a closed EntityManager for the rest of the process.
    if (this.fallbackStopped) return;
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      // Feature 072 (T034) — the degraded refresh reads `module_registrations`
      // from a timer, with no caller to inherit a context from.
      void enterSystemScope('_lifecycle: degraded registry refresh', () =>
        this.refreshFromDb(em),
      ).catch((err) => {
        console.warn(
          `[module-lifecycle] degraded refresh failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Stay degraded and try again on the next tick.
        this.degraded = true;
      });
    }, FALLBACK_TTL_MS);
    // Do not hold the process open for the sake of a cache refresh.
    this.fallbackTimer.unref?.();
  }

  private clearDegradedMode(): void {
    this.degraded = false;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Stop the degraded-mode timer for good. Used by tests and by process
   * shutdown: after this the cache will not re-arm, so tearing down the
   * database behind it produces no background noise.
   */
  stopFallbackRefresh(): void {
    this.fallbackStopped = true;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

/** Module-internal singleton consumed by the wrappers. */
export const registryCache = new ModuleRegistryCache();

/**
 * Publish a state-change notification. Called by the orchestrator on
 * every successful install / uninstall / enable / disable.
 */
export async function publishStateChanged(
  redis: Redis,
  payload: { moduleId: string; newState: string },
): Promise<void> {
  await redis.publish(STATE_CHANGED_CHANNEL, JSON.stringify(payload));
}
