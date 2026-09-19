/**
 * The platform's **own** schema — its six entity classes and its thirteen
 * migrations — as a value the platform contributes to every composition
 * (`specs/110-instance-repository/` T141).
 *
 * **Every count below is a derived fact written down, so re-derive before you
 * edit one** (D-100). `PLATFORM_ENTITIES.length` and
 * `PLATFORM_MIGRATION_ENTRIES.length` are the two answers, and their sum is what
 * the generated registries name. `platform-schema.test.ts` derives rather than
 * counts, so it does **not** catch this prose going stale — the bare `ls` of
 * `../migrations/` does not either, since that directory also holds `index.ts`
 * and `baseline-migrations.generated.ts`, which are not migrations.
 *
 * ## The defect this closes
 *
 * `configuredEntitiesFrom` and `discoverConfiguredMigrations` take the
 * committed core registry from the host (R7.4), and an instance has none: it
 * ships no generated index and no committed registry, so it passes
 * `coreEntities: []` and `coreEntries: []`. Measured on the first end-to-end run
 * of `endora new instance` (T140), that is not "an instance runs its packages'
 * schema and no more" — it is an instance that runs **none of the platform's
 * own**, because `AuditLogEntry`, `ModuleRegistration`, `SalesChannel`,
 * `SettingGroup`, `SettingValue` and `Setting` live in this package and reach a
 * composition only by being named. The first migration to touch a table
 * `core_foundation_init` creates dies with `relation … does not exist`, and
 * there is nothing a client could write in their own tree to prevent it.
 *
 * ## Why the platform carries it, and why that is not a new principle
 *
 * `../migrations/index.ts` already makes this argument for `BASELINE_MIGRATIONS`
 * and R1.5 rules it: *"it is data about **this platform's** history, a client
 * receives it by installing the platform, and a client receives a correction to
 * it by `pnpm update`"*. The order and the migrations it orders are the same
 * datum one step apart. A client's tree listing our thirteen class names would
 * be a fact about our history held in a repository we cannot grep — exactly what
 * R1.5 refuses — and it went stale on the thirteenth, which has now landed.
 *
 * ## Why merging is safe where a host **does** supply them
 *
 * This repository's own `entities-registry.generated.ts` and
 * `migrations-registry.generated.ts` name all nineteen, by the bare specifiers
 * this package's `exports` map declares. So the host's array and this one hold
 * **the same objects**, and the merge below is an identity de-duplication — not
 * a heuristic, and not a name comparison that could coalesce two different
 * classes. Two *different* objects of one name can only come from two copies of
 * this package in one process, which is D-160.6's failure; it survives the merge
 * as a duplicate name, which `orderMigrations` refuses by its own rule.
 *
 * Nothing is removed from the generated registries in the same breath: they are
 * the host's artefacts, emitted by a tree walk this file cannot reach, and a
 * merge that is exact needs no second edit to be correct.
 */
import type { EntityClassLike } from '../packages/package-runtime.js';
import { AuditLogEntry } from '../kernel/audit/audit-log-entry.entity.js';
import { ModuleRegistration } from '../kernel/lifecycle/module-registration.entity.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { Setting } from '../kernel/settings/setting.entity.js';
import { SettingGroup } from '../kernel/settings/setting-group.entity.js';
import { SettingValue } from '../kernel/settings/setting-value.entity.js';
import {
  Migration20260424T165847CoreFoundationInit,
  Migration20260425T050720CoreCommerceInit,
  Migration20260430T101450CoreSettingsInit,
  Migration20260430T170044CoreSalesChannelsPromote,
  Migration20260506T200657CoreModuleLifecycleInit,
  Migration20260514T111329CoreSettingsGlobalValue,
  Migration20260611T140411CoreSettingsSecretValueType,
  Migration20260611T140419CoreSettingsEnumOptions,
  Migration20260629T090100CoreSettingsHiddenFlag,
  Migration20260717T134752CoreTenantScopeIndexes,
  Migration20260721T011510CoreSettingsCredentialRefValueType,
  Migration20260816T203339CoreRetireCoreActivationSettings,
  Migration20260919T101500CoreModuleRegistrationsBootConverged,
} from '../migrations/index.js';
import type { MigrationRegistryEntry } from './migration-order.js';

/**
 * The cross-cutting pseudo-module owning the platform's own migrations.
 *
 * Declared here, beside the migrations it owns, and re-exported from
 * `./configured-migrations.ts` where it used to live: that file now reads this
 * one, so a constant declared there and read back would be an import cycle
 * evaluated in whichever order a consumer happened to enter it. Five programs
 * need the same literal and a second spelling of a module id is a second answer
 * waiting to disagree.
 */
export const CORE_MODULE_ID = 'core';

/**
 * The entity classes this package persists.
 *
 * Named one per line rather than re-exported from the two barrels that publish
 * them: `./kernel` carries five and `./composition` carries
 * `ModuleRegistration`, and a barrel import here would pull the composition
 * root into every process that only wanted an ORM configuration.
 */
export const PLATFORM_ENTITIES: readonly EntityClassLike[] = [
  AuditLogEntry,
  ModuleRegistration,
  SalesChannel,
  Setting,
  SettingGroup,
  SettingValue,
];

/**
 * The platform's thirteen migrations, owned by the cross-cutting `core`
 * pseudo-module.
 *
 * `origin` is left absent, which {@link MigrationRegistryEntry} documents as
 * meaning `'core'` — these are not an external producer's, and writing the
 * default would be a second spelling of it.
 */
export const PLATFORM_MIGRATION_ENTRIES: readonly MigrationRegistryEntry[] = [
  Migration20260424T165847CoreFoundationInit,
  Migration20260425T050720CoreCommerceInit,
  Migration20260430T101450CoreSettingsInit,
  Migration20260430T170044CoreSalesChannelsPromote,
  Migration20260506T200657CoreModuleLifecycleInit,
  Migration20260514T111329CoreSettingsGlobalValue,
  Migration20260611T140411CoreSettingsSecretValueType,
  Migration20260611T140419CoreSettingsEnumOptions,
  Migration20260629T090100CoreSettingsHiddenFlag,
  Migration20260717T134752CoreTenantScopeIndexes,
  Migration20260721T011510CoreSettingsCredentialRefValueType,
  Migration20260816T203339CoreRetireCoreActivationSettings,
  Migration20260919T101500CoreModuleRegistrationsBootConverged,
].map((cls) => ({ moduleId: CORE_MODULE_ID, cls }));

/**
 * `first`, then every member of `second` whose **identity** is not already in
 * it.
 *
 * `identity` is what a member is compared on, and it is a parameter because the
 * two merges compare different things. An entity set holds the classes
 * themselves, so a member is its own identity. A migration registry holds
 * `{ moduleId, cls }` *wrappers*, and the host builds its own — so comparing
 * the wrappers finds no overlap at all and hands `orderMigrations` twelve
 * duplicate names. The class is the identity there, which is also what the
 * platform persists: `cls.name` is the string `mikro_orm_migrations` records.
 *
 * Order is `first`'s and then `second`'s, so a host that already names these
 * keeps its own positions and an instance receives them in the order declared
 * above. For migrations neither order is the execution order: `orderMigrations`
 * computes that from the baseline and the manifest graph.
 */
export function mergeByIdentity<T>(
  first: readonly T[],
  second: readonly T[],
  identity: (member: T) => unknown = (member) => member,
): T[] {
  const seen = new Set(first.map(identity));
  return [...first, ...second.filter((member) => !seen.has(identity(member)))];
}
