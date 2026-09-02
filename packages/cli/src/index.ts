/**
 * `@endora-commerce/cli` — the programmatic surface of the `endora` command.
 *
 * The argv layer is `src/bin/endora.ts` and is deliberately not exported: a
 * caller that wants the scaffold wants {@link runNewModule}, not a parser.
 */
export {
  runNewModule,
  type NewModuleOptions,
  type NewModuleResult,
} from './new-module/index.js';
export {
  bundleEntries,
  emitModuleFiles,
  entityClassOf,
  entityFileOf,
  migrationClassOf,
  migrationFileOf,
  portInterfaceOf,
  portNameOf,
  tableNameOf,
  type EmittedFile,
} from './new-module/emit.js';
export {
  BASELINE_THROUGH,
  buildScaffoldSpec,
  camelOf,
  camelOfActionId,
  formatStamp,
  manifestObjectFor,
  migrationStampFor,
  npmNameFor,
  pascalOf,
  ScaffoldHostError,
  ScaffoldInputError,
  segmentOf,
  slugOf,
  TENANT_SCOPE_DECORATORS,
  TENANT_SCOPES,
  type ModuleScaffoldSpec,
  type ScaffoldAction,
  type ScaffoldActivation,
  type ScaffoldInput,
  type ScaffoldLayers,
  type ScaffoldPermission,
  type TenantScope,
} from './new-module/spec.js';
export {
  defaultModulesRootOf,
  findRepoRoot,
  resolveHost,
  workspaceGlobs,
  workspaceScopeOf,
  type ScaffoldHost,
} from './new-module/host.js';
