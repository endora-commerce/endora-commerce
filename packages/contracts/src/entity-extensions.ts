import { z } from 'zod';

/**
 * Extension attributes on aggregate read ports (`specs/187-side-table-extensions/`
 * FR-050 – FR-058, `contracts/extension-attributes-read-ports.md` §1).
 *
 * A module that keeps a declared side table on an extensible host (the
 * manifest's `extends`) may register one bulk loader for that host; a caller of
 * the host's read port asks for its values with
 * `include: ['extensions.<moduleId>']`, and each returned record carries them
 * under `extensions.<moduleId>`. Without `include` a read port answers exactly
 * what it answered before this feature.
 *
 * The value type of one module's extension is that module's contract, never a
 * core one: a consumer narrows `extensions[moduleId]` with the schema the
 * extending module publishes.
 */

/** `extensions.<moduleId>` — the one include family offered. */
export const EntityExtensionIncludeSchema = z.string().regex(/^extensions\.(_?[a-z][a-z0-9_]*)$/);

export type EntityExtensionInclude = `extensions.${string}`;

/** How many distinct includes one read may name; more is a `422 VALIDATION_FAILED`. */
export const ENTITY_EXTENSION_INCLUDE_MAX = 8;

export interface EntityExtensionReadOptions {
  /** At most {@link ENTITY_EXTENSION_INCLUDE_MAX}, deduplicated by the platform. Absent or empty: nothing is loaded. */
  readonly include?: readonly EntityExtensionInclude[];
}

/** A host record as a read port returns it when `include` was given. */
export type WithEntityExtensions<R> = R & {
  /** Present only when `include` named at least one present module. Values per module: `T | null`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
};

/** The module id an include addresses: `extensions.acme_links` → `acme_links`. */
export function entityExtensionModuleOf(include: EntityExtensionInclude): string {
  return include.slice('extensions.'.length);
}
