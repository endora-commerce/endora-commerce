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
export {
  runNewInstance,
  type NewInstanceOptions,
  type NewInstanceResult,
} from './new-instance/index.js';
// The deployment examples' two axes. `Topology` is exported because `PlanInput`
// carries one and a caller that cannot name the type cannot build the input;
// `TOPOLOGIES` and `assertTopology` are exported because a caller offering the
// flag needs the vocabulary and the refusal rather than a second copy of both.
export {
  assertTopology,
  deployFiles,
  DEFAULT_TOPOLOGY,
  TOPOLOGIES,
  type DeployFile,
  type DeployInput,
  type Topology,
} from './new-instance/deploy.js';
export {
  InstanceHostError,
  InstanceInputError,
  resolveInstanceHost,
  scopeOfPackageName,
  type InstanceHost,
  type ResolvedPackage,
} from './new-instance/host.js';
export {
  loadModuleCandidates,
  requiredModuleIds,
  resolveModuleSet,
  type ModuleCandidate,
  type ModuleSetResolution,
} from './new-instance/modules.js';
export {
  assertDeploymentName,
  assertWorkspaceName,
  devDependenciesFor,
  envExample,
  GENERATED_ARTEFACTS,
  GENERATED_TREES,
  planInstance,
  wiringLineCount,
  type FileKind,
  type InstancePlan,
  type MemberName,
  type PlanInput,
  type PlannedFile as PlannedInstanceFile,
  type PlannedOmission,
} from './new-instance/template.js';
export {
  artefactIsCurrent,
  findInstanceRoot,
  generateReport,
  GenerateHostError,
  GenerateInputError,
  runGenerate,
  type GeneratedArtefact,
  type GenerateOptions,
  type GenerateResult,
} from './generate/index.js';
export {
  runNewStorefront,
  storefrontDeclaredInputs,
  type NewStorefrontOptions,
  type NewStorefrontResult,
} from './new-storefront/index.js';
// The flag spelling is derived from the variable's name and never written down,
// so a caller that builds an `endora new storefront` command line takes the
// derivation rather than re-deriving it — see `storefrontDeclaredInputs`.
export { flagFor } from './inputs/resolve.js';
export {
  addressVariables,
  backendAddressVariablesOf,
  declaredVariablesOf,
  storefrontAddressVariablesOf,
  STOREFRONT_DECLARATION_EXPORT,
  ENV_EXAMPLE_FILE,
  envExampleDeclarations,
  envExampleDeclarationsOf,
  outwardReferences,
  resolveReference,
  StorefrontHostError,
  StorefrontInputError,
  trackedFiles,
  workspaceRanges,
  type OutwardReference,
  type StorefrontReference,
  type WorkspaceRange,
} from './new-storefront/reference.js';
export {
  authKeys,
  installedScopes,
  normalizeRegistry,
  npmrcContent,
  TOKEN_VARIABLE,
} from './new-storefront/npmrc.js';
export {
  cutForeignImports,
  cutForeignJsonPaths,
  packageManagerFor,
  planStorefront,
  publishedRange,
  retargetPackageGlob,
  testRoots,
  UnclassifiedReferenceError,
  type PlannedFile,
  type PlanOptions,
  type RangeRewrite,
  type StorefrontPlan,
} from './new-storefront/rewrite.js';
