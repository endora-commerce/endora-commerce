import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RegistryState } from '@b2b/contracts';
import { ModuleRegistration } from './module-registration.entity.js';
import { enterSystemScope } from '../scope.js';
import {
  resolveActivation,
  type ModuleActivationDeclaration,
} from './activation-resolver.js';

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
 *
 * **Loading and watching are two different things** (feature 072, D-38), and
 * conflating them is what kept the backend from booting:
 *
 *  - {@link load} is awaited, fatal and PostgreSQL-only. It runs as a kernel
 *    step inside `composeApp()`, before the first module registers, because a
 *    boot hook resolving a gated port asks this cache and a composition-time
 *    answer of "off" is indistinguishable from "nobody has read the database
 *    yet".
 *  - {@link watch} is armed after composition, is Redis-only and can never fail
 *    a boot: losing the notification channel means *stale*, which is the
 *    degraded mode above.
 *
 * Before a load there is no answer, and asking for one throws
 * {@link ModulePresenceNotLoadedError} rather than being answered `false`. It
 * is a wiring defect, and the one thing it must not do is look like data.
 */

/**
 * A presence read reached the cache before anything loaded it.
 *
 * Not fail-open and not fail-closed — *loud*. Both of the other answers are
 * answers to a question nobody has asked the database yet: `false` takes a
 * correctly-installed platform down at boot (which is exactly what it did), and
 * `true` runs a switched-off module's workers and subscribers.
 */
export class ModulePresenceNotLoadedError extends Error {
  constructor(readonly read: string) {
    super(
      `[module-lifecycle] module presence was read (${read}) before it was loaded. ` +
        `\`loadModulePresence()\` runs as a composition step in \`composeApp()\`, ` +
        `before the first module registers; a read earlier than that is a wiring defect.`,
    );
    this.name = 'ModulePresenceNotLoadedError';
  }
}

export class ModuleRegistryCache {
  /**
   * The third state. `false` means "nothing has read the database", which is
   * neither of the two answers a presence read can be given.
   */
  private loaded = false;
  private enabled = new Set<string>();
  /** Every registry row's state, including the non-installed ones. */
  private platformStates = new Map<string, RegistryState>();
  /** Resolved operator activation, per declaring module. */
  private activation = new Map<string, boolean>();
  private declarations = new Map<string, ModuleActivationDeclaration>();
  /**
   * Content hash of the two axes, and the counter that moves with it.
   *
   * Issue #225 — a consumer that memoises anything derived from presence needs
   * to know **when the presence it read from was replaced**, and a pub/sub
   * message cannot tell it: the message announces a change whose effect on this
   * cache is still a PostgreSQL round-trip away, so a snapshot rebuilt on the
   * message is rebuilt from the pre-change maps and then kept. The version is
   * the answer to that, and it is a *pull*: no registration, therefore no
   * listener order to get wrong, and a consumer constructed after a refresh
   * still reads the right number.
   *
   * It moves on **content**, not on refresh count. Every state-changed message
   * refreshes every process and the degraded-mode timer refreshes every five
   * seconds; a counter bumped per refresh would drop a consumer's cache each
   * time and make it worthless during a Redis outage, for a presence that did
   * not move. The hash costs one pass over ~70 entries, once per refresh, and
   * never on the read path.
   */
  private presenceSignature = '';
  private presenceVersionCounter = 0;
  private subscriber: Redis | null = null;
  private degraded = false;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private fallbackStopped = false;

  /** True once {@link load} — or the test seam that stands in for it — has run. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Monotonic counter over the *content* of both axes. It changes exactly when
   * a load has installed presence that differs from the presence before it, so
   * a consumer that caches a projection of presence can drop that cache by
   * comparing the number it built under with the current one.
   *
   * Synchronous and allocation-free, like every other read here: it is meant to
   * be asked on a request path.
   */
  presenceVersion(): number {
    return this.presenceVersionCounter;
  }

  /**
   * Re-sign both axes and bump the counter when the signature moved. Called at
   * the end of every path that installs presence — the real refresh and the
   * three test seams alike, because a seam that swaps presence without moving
   * the version would leave a consumer serving the presence before it.
   */
  private restamp(): void {
    const parts: string[] = [];
    for (const moduleId of [...this.platformStates.keys()].sort()) {
      parts.push(`p:${moduleId}=${this.platformStates.get(moduleId) ?? ''}`);
    }
    for (const moduleId of [...this.activation.keys()].sort()) {
      parts.push(`a:${moduleId}=${this.activation.get(moduleId) === true ? '1' : '0'}`);
    }
    const signature = createHash('sha1').update(parts.join('\n')).digest('hex');
    if (signature === this.presenceSignature) return;
    this.presenceSignature = signature;
    this.presenceVersionCounter += 1;
  }

  private assertLoaded(read: string): void {
    if (!this.loaded) throw new ModulePresenceNotLoadedError(read);
  }

  isEnabled(moduleId: string): boolean {
    this.assertLoaded('isEnabled');
    return this.enabled.has(moduleId);
  }

  enabledIds(): string[] {
    this.assertLoaded('enabledIds');
    return [...this.enabled].sort();
  }

  /** Platform axis detail for the presence projection. */
  platformStateOf(moduleId: string): RegistryState | 'not-installed' {
    this.assertLoaded('platformStateOf');
    return this.platformStates.get(moduleId) ?? 'not-installed';
  }

  /**
   * Resolved activation for a module that declares a control, or `undefined`
   * when nothing has been resolved for it yet.
   */
  activationValue(moduleId: string): boolean | undefined {
    this.assertLoaded('activationValue');
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
    this.assertLoaded('knownModuleIds');
    return [...new Set([...this.platformStates.keys(), ...this.declarations.keys()])].sort();
  }

  /**
   * Load both axes from PostgreSQL. **Awaited, fatal, no Redis.**
   *
   * The composition root calls this before the first module registers, so a
   * boot hook, a plugin body and a worker registration all read a cache that
   * has an answer. Idempotent: a second call re-reads the tables.
   *
   * Fatal is not a new failure mode. `composeApp()` opens with `initOrm()` and
   * MikroORM connects eagerly, so a backend whose database is unreachable
   * already cannot boot; this adds one round-trip to a boot that makes several.
   */
  async load(opts: {
    em: () => EntityManager;
    /** Activation declarations from the loaded manifests (feature 073). */
    activationDeclarations?: readonly ModuleActivationDeclaration[];
  }): Promise<void> {
    if (opts.activationDeclarations) {
      this.setActivationDeclarations(opts.activationDeclarations);
    }
    await this.refreshFromDb(opts.em);
  }

  /**
   * Arm the pub/sub subscriber that keeps the loaded state fresh. **Not fatal,
   * no PostgreSQL read of its own.** Safe to call multiple times — a second
   * call does not re-subscribe.
   *
   * A Redis outage must never fail a boot: the channel is a freshness
   * optimisation over an authority that is still reachable, which is the whole
   * argument for the degraded mode below. So a failing subscribe enters that
   * mode instead of propagating.
   */
  async watch(opts: { redisSubscriber: Redis; em: () => EntityManager }): Promise<void> {
    if (this.subscriber) return;
    this.subscriber = opts.redisSubscriber;
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
    try {
      await this.subscriber.subscribe(STATE_CHANGED_CHANNEL);
    } catch (err) {
      this.enterDegradedMode(opts.em);
      console.warn(
        `[module-lifecycle] registry-cache could not subscribe to ${STATE_CHANGED_CHANNEL} — ` +
          `serving the loaded state and re-reading PostgreSQL every ${FALLBACK_TTL_MS}ms: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
    }
    // No Redis mirror of the enabled set (feature 073, T140). One existed —
    // `b2b:module:enabled-set` — written here and read by nothing: a cold start
    // reads `module_registrations`, which is the authority, and every later
    // refresh is triggered by the pub/sub notification above. A second copy of
    // presence that nothing consults can only be a thing to keep in sync and a
    // thing to mislead whoever finds it.
  }

  /**
   * Test seam — replaces both axes without touching Redis or the database.
   * `ids` seeds platform availability; `opts.deactivated` seeds the operator
   * axis to off, which is the axis an operator actually drives.
   *
   * It counts as a {@link load}: it is "the load, without a database", and a
   * harness that seeds it has answered the question the tri-state asks.
   */
  __setEnabledForTesting(
    ids: readonly string[],
    opts?: { deactivated?: readonly string[] },
  ): void {
    this.loaded = true;
    this.enabled = new Set(ids);
    this.platformStates = new Map(ids.map((id) => [id, 'installed' as RegistryState]));
    this.activation = new Map(ids.map((id) => [id, true]));
    for (const id of opts?.deactivated ?? []) {
      this.activation.set(id, false);
    }
    this.restamp();
  }

  /**
   * Test seam — return the cache to the unloaded state, which is the one state
   * a test cannot otherwise reach: the suite shares one process, so by the time
   * a file runs, some earlier file has almost certainly seeded the singleton.
   * The invariant "a presence read before the load is an error" is not testable
   * without it.
   */
  __resetForTesting(): void {
    this.loaded = false;
    this.enabled = new Set();
    this.platformStates = new Map();
    this.activation = new Map();
    this.declarations = new Map();
    this.restamp();
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
    this.restamp();
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
    this.loaded = true;
    this.restamp();
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
      void enterSystemScope(
        '_lifecycle: degraded registry refresh',
        () => this.refreshFromDb(em),
        { entryPoint: 'interval' },
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
