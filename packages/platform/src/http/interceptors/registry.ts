import type {
  InterceptorListItem,
  InterceptorRegistration,
  ResolvedRegistration,
} from './types.js';

const TARGET_RE = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS) \/\S+$/;

export interface ApiInterceptorRegistryOptions {
  /**
   * Lifecycle gate consulted per execution. Composition wires this to the
   * `_lifecycle` enabled-set cache; the registry itself never imports the
   * lifecycle module (Principle I). Defaults to always-enabled (unit tests,
   * bare harnesses).
   */
  isModuleEnabled?: (moduleId: string) => boolean;
}

interface PhaseIndex {
  pre: ResolvedRegistration[];
  post: ResolvedRegistration[];
}

/**
 * Central registration point for API interceptors (feature 060).
 *
 * One instance per composed application. Modules receive the handle through
 * their plugin factory options (core) or `OverlayModuleContext` (overlay) and
 * call `register()` during composition. `buildServer` seals the registry in
 * an `onReady` hook after boot validation — the dispatch index is immutable
 * once traffic can flow.
 */
export class ApiInterceptorRegistry {
  readonly isModuleEnabled: (moduleId: string) => boolean;

  #registrations: ResolvedRegistration[] = [];
  #keys = new Set<string>();
  #sealed = false;
  #index = new Map<string, PhaseIndex>();

  constructor(options: ApiInterceptorRegistryOptions = {}) {
    this.isModuleEnabled = options.isModuleEnabled ?? (() => true);
  }

  register(registration: InterceptorRegistration): void {
    if (this.#sealed) {
      throw new Error(
        `[api-interceptor] registry is sealed — module '${registration.module}' tried to register ` +
          `interceptor '${registration.id}' after app.ready(). Register during composition.`,
      );
    }
    const key = `${registration.module}\0${registration.id}`;
    if (this.#keys.has(key)) {
      throw new Error(
        `[api-interceptor] duplicate registration: module '${registration.module}' interceptor ` +
          `'${registration.id}' is already registered.`,
      );
    }
    const rawTargets = Array.isArray(registration.target)
      ? registration.target
      : [registration.target];
    if (rawTargets.length === 0) {
      throw new Error(
        `[api-interceptor] module '${registration.module}' interceptor '${registration.id}' declares no target.`,
      );
    }
    const targets = rawTargets.map((t) => normalizeTarget(registration, t));
    this.#keys.add(key);
    this.#registrations.push({
      module: registration.module,
      id: registration.id,
      phase: registration.phase,
      order: registration.order ?? 0,
      targets,
      handler: registration.handler,
    });
  }

  /** All raw registrations — consumed by boot validation. */
  registrations(): readonly ResolvedRegistration[] {
    return this.#registrations;
  }

  /**
   * Freeze the registry and build the per-identity dispatch index.
   * Called once from `buildServer`'s onReady hook after boot validation.
   * Idempotent so repeated `app.ready()` calls are harmless.
   */
  seal(): void {
    if (this.#sealed) return;
    this.#sealed = true;
    for (const reg of this.#registrations) {
      for (const target of reg.targets) {
        let entry = this.#index.get(target);
        if (!entry) {
          entry = { pre: [], post: [] };
          this.#index.set(target, entry);
        }
        entry[reg.phase].push(reg);
      }
    }
    for (const entry of this.#index.values()) {
      entry.pre.sort(executionOrder);
      entry.post.sort(executionOrder);
    }
  }

  /** Pre-phase entries for an identity, in execution order. Empty before seal. */
  preFor(identity: string): readonly ResolvedRegistration[] {
    return this.#index.get(identity)?.pre ?? EMPTY;
  }

  /** Post-phase entries for an identity, in execution order. Empty before seal. */
  postFor(identity: string): readonly ResolvedRegistration[] {
    return this.#index.get(identity)?.post ?? EMPTY;
  }

  /**
   * The execution plan: one row per (target, registration), sorted by target,
   * then phase (pre before post), then execution order. Serves the read-only
   * admin diagnostics endpoint and tests.
   */
  list(): InterceptorListItem[] {
    const items: InterceptorListItem[] = [];
    const targets = [...this.#index.keys()].sort();
    for (const target of targets) {
      const entry = this.#index.get(target);
      if (!entry) continue;
      for (const phase of ['pre', 'post'] as const) {
        for (const reg of entry[phase]) {
          items.push({ target, phase, order: reg.order, module: reg.module, id: reg.id });
        }
      }
    }
    return items;
  }
}

const EMPTY: readonly ResolvedRegistration[] = Object.freeze([]);

function executionOrder(a: ResolvedRegistration, b: ResolvedRegistration): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.module !== b.module) return a.module < b.module ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function normalizeTarget(
  registration: Pick<InterceptorRegistration, 'module' | 'id'>,
  raw: string,
): string {
  const spaceIdx = raw.indexOf(' ');
  const candidate =
    spaceIdx > 0 ? `${raw.slice(0, spaceIdx).toUpperCase()}${raw.slice(spaceIdx)}` : raw;
  if (!TARGET_RE.test(candidate)) {
    throw new Error(
      `[api-interceptor] module '${registration.module}' interceptor '${registration.id}' has a ` +
        `malformed target '${raw}' — expected '<METHOD> /path/pattern', e.g. 'POST /api/v1/orders'.`,
    );
  }
  return candidate;
}
