/**
 * The refusals of declared extension columns (`specs/178-extensible-columns/`).
 *
 * Plain `Error` subclasses, not HTTP errors: every one of them is raised at
 * discovery, at migrate or at boot — a developer's or an operator's refusal —
 * or by the accessor inside a module's own Command, which decides what its
 * caller sees.
 */

/** The rule a declaration broke (`contracts/column-extension-declaration.md` §3). */
export type SchemaExtensionRule =
  | 'module-id'
  | 'host-not-extensible'
  | 'key'
  | 'not-null-without-default'
  | 'type'
  | 'type-params'
  | 'default-type'
  | 'index'
  | 'name-length'
  | 'module-mismatch'
  | 'host-not-a-dependency'
  | 'duplicate-declaration'
  | 'not-offered-yet'
  | 'not-a-declaration'
  | 'workspace-module'
  | 'overlay-module';

/** `schema_extension_invalid` — a declaration the platform refuses, naming module, key and rule. */
export class SchemaExtensionInvalidError extends Error {
  readonly code = 'schema_extension_invalid';

  constructor(
    readonly rule: SchemaExtensionRule,
    readonly moduleId: string,
    readonly key: string | null,
    detail: string,
  ) {
    super(
      `[schema-extensions] schema_extension_invalid (${rule}): module "${moduleId}"` +
        `${key === null ? '' : `, key "${key}"`} — ${detail}`,
    );
    this.name = 'SchemaExtensionInvalidError';
  }
}

export type SchemaExtensionReconcileReason =
  | 'non-additive-change'
  | 'unledgered-column-mismatch'
  | 'element-conflict';

/** A reconcile the generated migration step refuses; it rolls the whole run back. */
export class SchemaExtensionReconcileError extends Error {
  constructor(
    readonly reason: SchemaExtensionReconcileReason,
    message: string,
  ) {
    super(`[schema-extensions] ${reason}: ${message}`);
    this.name = 'SchemaExtensionReconcileError';
  }
}

/** One declared element the database does not carry as declared. */
export interface SchemaExtensionDrift {
  readonly moduleId: string;
  readonly key: string;
  readonly host: string;
  readonly physicalName: string;
  readonly kind: 'missing-column' | 'column-mismatch' | 'missing-index';
  readonly detail: string;
  /** "last executed migration of `<owner>`: …" — research R-6. */
  readonly ownerLastMigration: string;
}

/** Drift between declarations and the database: fails a migrate run and a boot (FR-025, FR-026). */
export class SchemaExtensionDriftError extends Error {
  constructor(readonly drift: readonly SchemaExtensionDrift[]) {
    super(
      `[schema-extensions] the database does not carry ${drift.length} declared extension ` +
        `element(s):\n` +
        drift
          .map(
            (d) =>
              `  - module "${d.moduleId}", key "${d.key}": ${d.kind} "${d.physicalName}" on ` +
              `"${d.host}" (${d.detail}); ${d.ownerLastMigration}`,
          )
          .join('\n'),
    );
    this.name = 'SchemaExtensionDriftError';
  }
}

/** `set` on an id the host table does not hold. Nothing is inserted (US2 scenario 2). */
export class ExtensionHostRowNotFoundError extends Error {
  constructor(
    readonly host: string,
    readonly id: string,
  ) {
    super(`[schema-extensions] no "${host}" row with id "${id}" is visible to this write`);
    this.name = 'ExtensionHostRowNotFoundError';
  }
}

/** A write outside a transaction — no Command, no hook (Constitution XIII; US2 scenario 3). */
export class ExtensionWriteOutsideCommandError extends Error {
  constructor(readonly declarationId: string) {
    super(
      `[schema-extensions] "${declarationId}" was written outside a transaction. Extension ` +
        `columns are written inside a Command (CommandBus.run) or a command hook, so the write ` +
        `is audited with the rest of it.`,
    );
    this.name = 'ExtensionWriteOutsideCommandError';
  }
}

/** An INSERT or DELETE through a projection: the host owns its rows (FR-032). */
export class ExtensionProjectionWriteError extends Error {
  constructor(
    readonly host: string,
    readonly operation: 'insert' | 'delete',
  ) {
    super(
      `[schema-extensions] an extension projection of "${host}" may not ${operation} rows; the ` +
        `host module owns them. Extension columns are only ever updated.`,
    );
    this.name = 'ExtensionProjectionWriteError';
  }
}

/** Stored JSON its declared schema refuses — never silently returned. */
export class ExtensionValueCorruptError extends Error {
  constructor(
    readonly declarationId: string,
    readonly key: string,
    readonly id: string,
  ) {
    super(
      `[schema-extensions] the stored value of "${key}" of "${declarationId}" on row "${id}" ` +
        `does not match its declared schema`,
    );
    this.name = 'ExtensionValueCorruptError';
  }
}

/** A table mapped by more than one entity outside the sanctioned projections (FR-031). */
export class DuplicateTableMappingError extends Error {
  constructor(
    readonly table: string,
    readonly classNames: readonly string[],
    detail: string,
  ) {
    super(
      `[schema-extensions] table "${table}" is mapped by ${classNames.length} entities ` +
        `(${classNames.join(', ')}): ${detail}`,
    );
    this.name = 'DuplicateTableMappingError';
  }
}
