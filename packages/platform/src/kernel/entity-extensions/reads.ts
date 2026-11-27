import type { EntityManager } from '@mikro-orm/core';
import {
  ENTITY_EXTENSION_INCLUDE_MAX,
  ERROR_CODES,
  EntityExtensionIncludeSchema,
  type EntityExtensionReadOptions,
  type WithEntityExtensions,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModulePresenceReader } from '../schema-extensions/accessor.js';
import { EntityExtensionLoaderOutputError } from './errors.js';
import type { RegisteredEntityExtensionLoader } from './loaders.js';

/**
 * `entityExtensionReads` — side-table values on an extensible host's read
 * ports (`specs/187-side-table-extensions/` FR-054 – FR-057,
 * `contracts/extension-attributes-read-ports.md` §3).
 *
 * A host read port hands the records it is about to return — after its own
 * scope and authorisation — to {@link EntityExtensionReads.attach}, with the
 * caller's `options` and its own entity manager. Without `include` the records
 * come back as given and nothing runs, so a port's answer is byte-identical to
 * what it answered before this feature.
 *
 * Kernel-registered by the composition root beside `schemaExtensionReads`; a
 * host module reads it through {@link lazyEntityExtensionReads}, so a read
 * without `include` never resolves it.
 */
export interface EntityExtensionReads {
  attach<R extends { readonly id: string }>(
    host: string,
    records: readonly R[],
    options: EntityExtensionReadOptions | undefined,
    em: EntityManager,
  ): Promise<readonly WithEntityExtensions<R>[]>;
}

/** What the reads service asks of the loader registry. */
export interface EntityExtensionLoaderLookup {
  loaderFor(moduleId: string, host: string): RegisteredEntityExtensionLoader | undefined;
}

function includedModules(options: EntityExtensionReadOptions | undefined): string[] {
  const include = [...new Set(options?.include ?? [])];
  if (include.length > ENTITY_EXTENSION_INCLUDE_MAX) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      `At most ${ENTITY_EXTENSION_INCLUDE_MAX} extension includes may be named on one read; ${include.length} were.`,
      [{ path: 'include', issue: 'too_many' }],
    );
  }
  const malformed = include.filter((entry) => !EntityExtensionIncludeSchema.safeParse(entry).success);
  if (malformed.length > 0) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      `Only extensions.<moduleId> includes are offered: ${malformed.map((entry) => JSON.stringify(entry)).join(', ')}.`,
      malformed.map((entry) => ({ path: String(entry), issue: 'invalid_include' })),
    );
  }
  return include.map((entry) => entry.slice('extensions.'.length));
}

export function createEntityExtensionReads(deps: {
  readonly registry: EntityExtensionLoaderLookup;
  readonly state: ModulePresenceReader;
}): EntityExtensionReads {
  return {
    async attach(host, records, options, em) {
      // 1 — no include: the records as given, nothing loaded.
      if (options?.include === undefined || options.include.length === 0) return records;
      // 2 — deduplicated, bounded, parsed.
      const moduleIds = includedModules(options);

      // 3 — a claim is a build fact (a loader is registered), never a presence
      // one, so a switched-off module's include is not refused (R-10).
      const loaders: RegisteredEntityExtensionLoader[] = [];
      const unclaimed: string[] = [];
      for (const moduleId of moduleIds) {
        const loader = deps.registry.loaderFor(moduleId, host);
        if (loader === undefined) unclaimed.push(moduleId);
        else loaders.push(loader);
      }
      if (unclaimed.length > 0) {
        throw new HttpError(
          422,
          ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
          `No installed module provides ${unclaimed.map((moduleId) => `"extensions.${moduleId}"`).join(', ')} ` +
            `for ${host}.`,
          unclaimed.map((moduleId) => ({ path: `extensions.${moduleId}`, issue: 'unclaimed' })),
        );
      }

      // 4 — nothing to attach to.
      if (records.length === 0) return records;

      // 5 — off behaves as never installed: key absent, no call, no error.
      const present = loaders.filter((loader) => deps.state.isPresent(loader.moduleId));
      if (present.length === 0) return records;

      // 6 — one call per module, sequentially, on the port's em. No catch: a
      // loader's error is the read's error.
      const ids = records.map((record) => record.id);
      const asked = new Set(ids);
      const values = new Map<string, Map<string, unknown>>();
      for (const loader of present) {
        const loaded = await loader.load(ids, { em });
        const parsed = new Map<string, unknown>();
        for (const [id, value] of loaded) {
          if (!asked.has(id)) continue;
          const result = loader.schema.safeParse(value);
          if (!result.success) {
            throw new EntityExtensionLoaderOutputError({
              moduleId: loader.moduleId,
              host,
              detail:
                `for id "${id}": ` +
                result.error.issues.map((issue) => `${issue.path.join('.') || '(value)'}: ${issue.message}`).join('; '),
            });
          }
          parsed.set(id, result.data);
        }
        values.set(loader.moduleId, parsed);
      }

      // 7 — every record gains the present modules' values, `null` where none.
      return records.map((record) => {
        const extensions: Record<string, unknown> = {};
        for (const loader of present) extensions[loader.moduleId] = values.get(loader.moduleId)?.get(record.id) ?? null;
        return { ...record, extensions };
      });
    },
  };
}

const NO_LOADERS: EntityExtensionLoaderLookup = { loaderFor: () => undefined };

/**
 * The reads service as a host module holds it: resolved only when a read names
 * an `include`, so a read without one costs nothing and needs no registration.
 * `resolve` answering `undefined` — a hand-built service with no composition
 * behind it — reads as a composition with no loader: every include is
 * unclaimed.
 */
export function lazyEntityExtensionReads(resolve: () => EntityExtensionReads | undefined): EntityExtensionReads {
  const none = createEntityExtensionReads({ registry: NO_LOADERS, state: { isPresent: () => false } });
  return {
    attach(host, records, options, em) {
      if (options?.include === undefined || options.include.length === 0) return Promise.resolve(records);
      return (resolve() ?? none).attach(host, records, options, em);
    },
  };
}
