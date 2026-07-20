// Overlay resolution — typed build-time errors. Every one of these MUST fail
// the build (there is no silent divergence — FR-003/FR-007/FR-011/FR-014).

/** Base class so callers can catch any overlay-resolution failure. */
export class OverlayResolutionError extends Error {}

/** Two overlays targeting one core unit (FR-007). No silent last-wins. */
export class OverrideConflictError extends OverlayResolutionError {
  constructor(
    public readonly targetUnitKey: string,
    public readonly contenders: string[],
  ) {
    super(
      `override conflict: ${contenders.length} overlays target the same core unit "${targetUnitKey}": ` +
        contenders.join(', '),
    );
    this.name = 'OverrideConflictError';
  }
}

/** Overlay targets a core file that does not exist — stale/typo (FR-014). */
export class UnknownOverrideTargetError extends OverlayResolutionError {
  constructor(
    public readonly moduleId: string,
    public readonly relPath: string,
  ) {
    super(
      `unknown override target: ${moduleId}/${relPath} does not correspond to an overridable ` +
        `core unit (services/routes/config). Fix the path or remove the overlay file.`,
    );
    this.name = 'UnknownOverrideTargetError';
  }
}

/** Overlay tries to shadow a core entity/migration — out of scope in v1 (FR-011). */
export class SchemaOverrideNotSupportedError extends OverlayResolutionError {
  constructor(
    public readonly moduleId: string,
    public readonly relPath: string,
  ) {
    super(
      `schema override not supported in v1: ${moduleId}/${relPath}. Entities and migrations of a ` +
        `core module cannot be overridden — ship new schema as a client-only overlay module that ` +
        `owns its own tables.`,
    );
    this.name = 'SchemaOverrideNotSupportedError';
  }
}

/** Overlay overrides a service that has no declared core interface (R4/FR-003). */
export class MissingCoreContractError extends OverlayResolutionError {
  constructor(
    public readonly moduleId: string,
    public readonly relPath: string,
  ) {
    super(
      `no core contract declared for ${moduleId}/${relPath}: formalize its interface ` +
        `(a sibling "*.interface.ts" the core class implements) before overriding it.`,
    );
    this.name = 'MissingCoreContractError';
  }
}
