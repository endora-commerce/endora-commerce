import type { ResolvedEntityExtension } from './declarations.js';
import type { EntityExtensionOrigin } from './errors.js';

/**
 * What the platform's ORM configuration resolved about side-table extensions,
 * for the readers that run after it — the physical verifier at `migrate` and at
 * boot, and `module:schema-extensions list` (`specs/187-side-table-extensions/`
 * `contracts/verification-rules.md` §1).
 *
 * Recorded the way D2's context is (`../schema-extensions/registry.ts`): the
 * configuration records the declarations it resolved, and discovery adds who
 * maps each table once MikroORM has named them. A process-global for the same
 * reason D2's is — the readers run in other files, after the ORM opens — and
 * replaced as a whole on each record, never merged.
 */

/** Who maps one table, as discovery found it. */
export interface EntityExtensionTableOwner {
  /** `null` when no composed module contributes the class. */
  readonly moduleId: string | null;
  readonly origin: EntityExtensionOrigin | null;
  readonly className: string;
}

/** table → its one owning (non-projection) entity. */
export type EntityExtensionTableFacts = ReadonlyMap<string, EntityExtensionTableOwner>;

export interface EntityExtensionContext {
  readonly extensions: readonly ResolvedEntityExtension[];
  /** `null` until an ORM initialised from the recording configuration has discovered its entities. */
  readonly tables: EntityExtensionTableFacts | null;
}

let active: EntityExtensionContext = { extensions: [], tables: null };
let recorded = false;

/** Recorded by the ORM configuration, with `tables: null`; and again by discovery, with them. */
export function recordActiveEntityExtensions(context: EntityExtensionContext): void {
  active = { extensions: [...context.extensions], tables: context.tables };
  recorded = true;
}

/** Whether any ORM configuration of this process recorded its side-table declarations. */
export function entityExtensionContextRecorded(): boolean {
  return recorded;
}

/** The declarations and table facts the verifier and the list read. */
export function activeEntityExtensionContext(): EntityExtensionContext {
  return active;
}
