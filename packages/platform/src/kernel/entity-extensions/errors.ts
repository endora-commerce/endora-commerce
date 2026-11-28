/**
 * The refusals of side-table entity extensions
 * (`specs/187-side-table-extensions/`, D-294; `data-model.md` §6).
 *
 * Plain `Error` subclasses, as D2's are (`../schema-extensions/errors.ts`):
 * every one but the loader-output error is raised at manifest composition, at
 * ORM discovery, at `migrate` or at boot — a developer's or an operator's
 * refusal, never a buyer's.
 */

/** Where the declaring module came from. Carried into messages and list rows; read by no rule (FR-005). */
export type EntityExtensionOrigin = 'core' | 'package' | 'overlay';

/** Every rule a side-table finding can name (`data-model.md` §6). */
export type EntityExtensionRule =
  // Static (manifest) — `contracts/entity-extension-declaration.md` §3.
  | 'declaration-shape'
  | 'host-not-extensible'
  | 'host-not-a-dependency'
  | 'self-extension'
  | 'duplicate-table'
  // Metadata (discovered entities) — `contracts/verification-rules.md` §2 – §3.
  | 'host-binding-mismatch'
  | 'table-not-owned'
  | 'primary-key-not-single'
  | 'primary-key-type-mismatch'
  | 'tenancy-mismatch'
  | 'host-scope-not-offered'
  // Physical (catalog) — `contracts/verification-rules.md` §4.
  | 'table-missing'
  | 'foreign-key-missing'
  | 'foreign-key-not-cascade'
  | 'undeclared-entity-extension'
  | 'unowned-entity-extension'
  // Loader registration — Phase B1.
  | 'loader-without-extension'
  | 'duplicate-loader'
  | 'registration-after-seal'
  // Admin reads — `specs/193-admin-form-extensions/` FR-015.
  | 'loader-and-columns-on-one-host';

export interface EntityExtensionInvalidDetails {
  readonly rule: EntityExtensionRule;
  /** `null` only for M0, which is about a host binding rather than a declaration. */
  readonly moduleId: string | null;
  readonly origin: EntityExtensionOrigin | null;
  readonly table: string;
  /** The declaration's host reference, `<ownerModuleId>.<EntityClassName>`, as written. */
  readonly entity: string;
  /** What is wrong and what to do — the remedy is part of the sentence. */
  readonly detail: string;
}

function who(moduleId: string | null, origin: EntityExtensionOrigin | null): string {
  if (moduleId === null) return 'the platform';
  return `module "${moduleId}"${origin === null ? '' : ` (${origin})`}`;
}

/**
 * `entity_extension_invalid` — a declaration (or, for M0, a host binding) the
 * platform refuses at composition or discovery.
 */
export class EntityExtensionInvalidError extends Error {
  readonly code = 'entity_extension_invalid';
  readonly rule: EntityExtensionRule;
  readonly moduleId: string | null;
  readonly origin: EntityExtensionOrigin | null;
  readonly table: string;
  readonly entity: string;
  readonly detail: string;

  constructor(details: EntityExtensionInvalidDetails) {
    super(
      `[entity-extensions] entity_extension_invalid (${details.rule}): ${who(details.moduleId, details.origin)}, ` +
        `side table "${details.table}" on ${details.entity} — ${details.detail}`,
    );
    this.name = 'EntityExtensionInvalidError';
    this.rule = details.rule;
    this.moduleId = details.moduleId;
    this.origin = details.origin;
    this.table = details.table;
    this.entity = details.entity;
    this.detail = details.detail;
  }
}

/** One physical finding of the catalog verification (`contracts/verification-rules.md` §4). */
export interface EntityExtensionFinding {
  readonly rule: EntityExtensionRule;
  /** `null` for `unowned-entity-extension`: no composed module maps the table. */
  readonly moduleId: string | null;
  readonly origin: EntityExtensionOrigin | null;
  readonly table: string;
  /** The host reference, `<ownerModuleId>.<EntityClassName>`. */
  readonly host: string;
  readonly detail: string;
}

/** Render one finding as the line `migrate`, boot and the warning log all print. */
export function describeEntityExtensionFinding(finding: EntityExtensionFinding): string {
  return (
    `${finding.rule}: ${who(finding.moduleId, finding.origin)}, table "${finding.table}" on ${finding.host} — ` +
    finding.detail
  );
}

/**
 * The database does not carry a declared side table as declared (or, under the
 * `refuse` policy, carries an undeclared one): fails a `migrate` run — which
 * rolls back — and a boot. Every finding of the run is reported at once.
 */
export class EntityExtensionDriftError extends Error {
  constructor(readonly findings: readonly EntityExtensionFinding[]) {
    super(
      `[entity-extensions] ${findings.length} declared side table finding(s) refuse this database:\n` +
        findings.map((finding) => `  - ${describeEntityExtensionFinding(finding)}`).join('\n'),
    );
    this.name = 'EntityExtensionDriftError';
  }
}

/**
 * A loader returned a value its declared schema refuses (FR-057). A 500: the
 * defect is the extension module's, and nothing is silently dropped.
 */
export class EntityExtensionLoaderOutputError extends Error {
  readonly statusCode = 500;
  readonly moduleId: string;
  readonly host: string;

  constructor(details: { readonly moduleId: string; readonly host: string; readonly detail: string }) {
    super(
      `[entity-extensions] the extension loader of module "${details.moduleId}" on ${details.host} ` +
        `returned a value its schema refuses: ${details.detail}`,
    );
    this.name = 'EntityExtensionLoaderOutputError';
    this.moduleId = details.moduleId;
    this.host = details.host;
  }
}
