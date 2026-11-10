import type { ColumnExtension } from './types.js';

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

const projectionNames = new WeakMap<ColumnExtension, string>();
let active: readonly ColumnExtension[] = [];

/** Recorded by the projection builder. */
export function recordProjectionEntityName(declaration: ColumnExtension, entityName: string): void {
  projectionNames.set(declaration, entityName);
}

/**
 * The entity name of `declaration`'s projection.
 *
 * Throws for a declaration no ORM configuration of this process registered: an
 * accessor over it would query an entity MikroORM does not know, and the error
 * would name a private class instead of the cause.
 */
export function projectionEntityNameOf(declaration: ColumnExtension): string {
  const name = projectionNames.get(declaration);
  if (name === undefined) {
    throw new Error(
      `[schema-extensions] "${declaration.id}" is not registered with this platform's ORM. ` +
        `A declaration is registered when its package's ./backend export lists it in ` +
        `'schemaExtensions' and the package is installed.`,
    );
  }
  return name;
}

/** Recorded by the ORM configuration: every declaration it validated and projected. */
export function recordActiveSchemaExtensions(declarations: readonly ColumnExtension[]): void {
  active = [...declarations];
}

/** Every declaration the ORM configuration of this process registered. */
export function activeSchemaExtensions(): readonly ColumnExtension[] {
  return active;
}
