import {
  PERMISSION_CATALOGUE,
  type ModuleManifest,
  type PermissionCatalogueEntry,
} from '@b2b/contracts';

export interface PermissionCatalogueServiceOptions {
  registryEntries: ReadonlyArray<{ manifest: ModuleManifest }>;
  getEnabledModuleIds?: () => readonly string[];
}

/**
 * Merges the core `PERMISSION_CATALOGUE` with optional `permissions` arrays
 * from enabled module manifests. Powers `GET /admin/permissions` and role
 * upsert validation (feature 026).
 */
export class PermissionCatalogueService {
  private cached: PermissionCatalogueEntry[] | null = null;
  private getEnabledModuleIds: (() => readonly string[]) | null;

  constructor(private readonly options: PermissionCatalogueServiceOptions) {
    this.getEnabledModuleIds = options.getEnabledModuleIds ?? null;
  }

  /** Wire the lifecycle enabled-set accessor after registry cache starts. */
  setEnabledModuleIdsAccessor(accessor: () => readonly string[]): void {
    this.getEnabledModuleIds = accessor;
    this.invalidate();
  }

  listAssignable(): PermissionCatalogueEntry[] {
    if (this.cached) return this.cached;
    this.cached = this.#build();
    return this.cached;
  }

  listAssignableCodes(): string[] {
    return this.listAssignable().map((e) => e.code);
  }

  invalidate(): void {
    this.cached = null;
  }

  #build(): PermissionCatalogueEntry[] {
    const enabledIds = this.getEnabledModuleIds?.() ?? [];
    // Empty enabled set ⇒ treat every manifest as enabled (tests / pre-lifecycle boot).
    const enabledSet = enabledIds.length > 0 ? new Set(enabledIds) : null;

    const byCode = new Map<string, PermissionCatalogueEntry>();
    for (const row of PERMISSION_CATALOGUE) {
      byCode.set(row.code, { code: row.code, module: row.module, label: row.label });
    }

    for (const { manifest } of this.options.registryEntries) {
      if (!manifest.permissions?.length) continue;
      if (enabledSet && !enabledSet.has(manifest.id)) continue;
      for (const decl of manifest.permissions) {
        if (byCode.has(decl.code)) continue;
        byCode.set(decl.code, {
          code: decl.code,
          module: decl.module ?? manifest.id,
          label: decl.label,
        });
      }
    }

    return [...byCode.values()].sort(
      (a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code),
    );
  }
}

/** Test / CI helper — build assignable codes without wiring composition. */
export function listAssignablePermissionCodes(
  registryEntries: ReadonlyArray<{ manifest: ModuleManifest }>,
  enabledModuleIds?: readonly string[],
): string[] {
  return new PermissionCatalogueService({
    registryEntries,
    ...(enabledModuleIds !== undefined
      ? { getEnabledModuleIds: () => enabledModuleIds }
      : {}),
  }).listAssignableCodes();
}
