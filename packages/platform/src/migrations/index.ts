/**
 * `./migrations` — the platform's seventh subpath, and the platform's own claim
 * about its schema history.
 *
 * ## What is on it
 *
 * {@link BASELINE_MIGRATIONS}: the frozen historical prefix, as an ordered list
 * of migration class names.
 * `specs/110-instance-repository/contracts/instance-migration-order.md` is
 * normative and §1 is where every alternative to it is refused with the reason.
 *
 * The short version. The order a migration corpus is applied in is a frozen
 * historical prefix — the pre-065 block, whose order is history and which the
 * manifest graph contradicts in 37 places — followed by the modules, module by
 * module, in a topological order of that graph. Membership of the prefix used
 * to be `origin === 'core' && timestamp <= BASELINE_THROUGH`: *"came out of
 * this repository's build"*. That is a different question from *"is one of the
 * migrations whose order is history"*, and the two coincide exactly while every
 * module is compiled into the application. Measured over the real registry the
 * moment they come apart: the prefix falls from **112** entries to **11**, 181
 * of 182 positions move, and six migrations — three of them `core`'s — land
 * before the migration that creates a table they touch. An instance installing
 * the same modules could not migrate a fresh database at all, failing at
 * `Migration20260505T102206AssetsLibraryInit` with
 * `relation "cms_pages" does not exist`.
 *
 * So membership is by **identity**, and the identities are here.
 *
 * ## Why the platform carries it
 *
 * R1.5. It is data about *this platform's* history, a client receives it by
 * installing the platform, and a client receives a correction to it by
 * `pnpm update`. The alternative — an instance carrying the order — makes a
 * fact about our history the client's to hold, in a tree we cannot grep.
 *
 * ## Why no module may name it
 *
 * It is declared by the `exports` map and carried by no published barrel, which
 * is D-160.14's third state: `node` and `tsc` resolve it, and
 * `check:platform-surface` gives a module reaching it a finding of its own
 * (`host-internal-subpath`). The reader is the host's ORM configuration, which
 * is the one program that composes an execution order. A module's own
 * `./migrations` subpath is the other side of the same conversation and is
 * unaffected: it publishes that module's classes, and this publishes the order
 * the platform applies them in.
 */
export { BASELINE_MIGRATIONS } from './baseline-migrations.generated.js';

// --- the platform's own thirteen migrations -------------------------------
//
// Named exports and no `migrations` array, and the asymmetry with a module
// package's `./migrations` barrel is deliberate. That array exists because
// `packages/package-runtime.ts` reads it out of an **installed** package's
// export and refuses the package when it is absent; the platform is not a
// module package and is discovered by nothing, so an array here would be a
// claim nothing reads. What is read is each class **by name**, by
// `backend/src/db/migrations-registry.generated.ts`, which the generator emits
// against this specifier — and a migration class name is contract in a way an
// entity class name is not: `mikro_orm_migrations` persists it, so it is a
// string every already-migrated database holds. A class that is in neither this
// barrel nor the registry is a migration that does not run.
export { Migration20260424T165847CoreFoundationInit } from './20260424T165847_core_foundation_init.js';
export { Migration20260425T050720CoreCommerceInit } from './20260425T050720_core_commerce_init.js';
export { Migration20260430T101450CoreSettingsInit } from './20260430T101450_core_settings_init.js';
export { Migration20260430T170044CoreSalesChannelsPromote } from './20260430T170044_core_sales_channels_promote.js';
export { Migration20260506T200657CoreModuleLifecycleInit } from './20260506T200657_core_module_lifecycle_init.js';
export { Migration20260514T111329CoreSettingsGlobalValue } from './20260514T111329_core_settings_global_value.js';
export { Migration20260611T140411CoreSettingsSecretValueType } from './20260611T140411_core_settings_secret_value_type.js';
export { Migration20260611T140419CoreSettingsEnumOptions } from './20260611T140419_core_settings_enum_options.js';
export { Migration20260629T090100CoreSettingsHiddenFlag } from './20260629T090100_core_settings_hidden_flag.js';
export { Migration20260717T134752CoreTenantScopeIndexes } from './20260717T134752_core_tenant_scope_indexes.js';
export { Migration20260721T011510CoreSettingsCredentialRefValueType } from './20260721T011510_core_settings_credential_ref_value_type.js';
export { Migration20260816T203339CoreRetireCoreActivationSettings } from './20260816T203339_core_retire_core_activation_settings.js';
export { Migration20260919T101500CoreModuleRegistrationsBootConverged } from './20260919T101500_core_module_registrations_boot_converged.js';
