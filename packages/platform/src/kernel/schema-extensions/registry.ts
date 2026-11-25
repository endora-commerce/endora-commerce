import type { ColumnExtension } from './types.js';
import type { ExtensibleHostSet } from './extensible-hosts.js';
import type { MigrationOwnership } from '../../lifecycle/services/migration-ownership.js';

/**
 * What the platform's ORM configuration resolved about declared extensions, for
 * the readers that run after it (`specs/178-extensible-columns/` FR-032,
 * FR-033, FR-051).
 *
 * The projection is built in `db/` — the one place that configures the ORM —
 * and reached from `kernel/` (the accessor, the reads service) only through the
 * entity name recorded here, keyed by the declaration object. That is what
 * keeps the projection's entity name private: nothing exports it, and a module
 * holding a declaration that is not its own is a `check:module-boundary`
 * finding before it is anything here.
 */

/**
 * The projection's entity name, and the entity itself. MikroORM 7 (#1866)
 * refuses an entity named by string on the entity manager, so the accessor
 * queries the recorded entity; the name stays for the readers that report it.
 */
const projections = new WeakMap<ColumnExtension, { readonly name: string; readonly entity: object }>();

/** What the verifier needs beside the declarations: who owns each host, and their chains. */
export interface SchemaExtensionContext {
  readonly declarations: readonly ColumnExtension[];
  readonly hosts: ExtensibleHostSet;
  readonly ownership: MigrationOwnership | null;
}

let active: SchemaExtensionContext = { declarations: [], hosts: new Map(), ownership: null };

/** Recorded by the projection builder. */
export function recordProjectionEntityName(declaration: ColumnExtension, entityName: string, entity: object): void {
  projections.set(declaration, { name: entityName, entity });
}

/**
 * The entity name of `declaration`'s projection.
 *
 * Throws for a declaration no ORM configuration of this process registered: an
 * accessor over it would query an entity MikroORM does not know, and the error
 * would name a private class instead of the cause.
 */
export function projectionEntityNameOf(declaration: ColumnExtension): string {
  return projectionOf(declaration).name;
}

/** The entity of `declaration`'s projection — what an entity manager is handed. Throws as {@link projectionEntityNameOf}. */
export function projectionEntityOf(declaration: ColumnExtension): object {
  return projectionOf(declaration).entity;
}

function projectionOf(declaration: ColumnExtension): { readonly name: string; readonly entity: object } {
  const projection = projections.get(declaration);
  if (projection === undefined) {
    throw new Error(
      `[schema-extensions] "${declaration.id}" is not registered with this platform's ORM. ` +
        `A declaration is registered when its package's ./backend export lists it in ` +
        `'schemaExtensions' and the package is installed.`,
    );
  }
  return projection;
}

let recorded = false;

/** Recorded by the ORM configuration: every declaration it validated and projected. */
export function recordActiveSchemaExtensions(context: SchemaExtensionContext): void {
  active = { ...context, declarations: [...context.declarations] };
  recorded = true;
}

/**
 * Whether any ORM configuration of this process recorded its declarations. The
 * initial empty context is not a statement that nothing is declared, so a
 * reader that would *act* on "nothing declared" asks this first (review
 * finding 8).
 */
export function schemaExtensionContextRecorded(): boolean {
  return recorded;
}

/** Every declaration the ORM configuration of this process registered. */
export function activeSchemaExtensions(): readonly ColumnExtension[] {
  return active.declarations;
}

/** The declarations plus the host and ownership facts the verifier reads. */
export function activeSchemaExtensionContext(): SchemaExtensionContext {
  return active;
}
