/**
 * CI check — a published port's **shape**: it declares no optional method
 * (D-97.3), the container name in its doc block is the name it is actually
 * registered under (issue #192), a module resolves, cross-module, only a name
 * some contract publishes (issue #196, D-98.2), and an interface a module
 * declares for *another* module to implement is named at that provider's
 * `implements` clause (D-171.1).
 *
 * Four signals over one population, because all four read the same thing: the
 * doc block that makes an interface a published port, and what the module tree
 * does with the name in it.
 *
 * ## The population, and why it is two places rather than one
 *
 * A published port was `packages/contracts/src` and nothing else until D-171.1.
 * That was never the rule — it was the only place a port *could* be published,
 * because a module in `backend/src` has no supported name for anything it
 * declares. D-171 changed that: a module package's `./ports` subpath is contract
 * surface, so an interface declared there is published in exactly the sense this
 * check means — a consumer may name it, and the container name in its doc block
 * is the literal that consumer copies into `lazyPort`.
 *
 * So the population is **every exported `interface` carrying the
 * `Container name:` marker, in `packages/contracts/src` or on a module
 * package's declared `./ports` subpath**. The second half is what
 * {@link RESOLUTIONS_OF_UNPUBLISHED_NAMES}' own entries have named as their
 * retiring condition since T048 — *"this check's own population —
 * `packages/contracts/src` — is what has to widen for the entry to go"* — and
 * widening it retires them as their owners are packaged.
 *
 * **The `exports` map decides membership, not the path**, and the difference is
 * load-bearing rather than pedantic. D-171's designation is derived from the
 * artefact, and *"a `./ports` subpath exists only on a package"*: a module still
 * in the application tree has a `ports/` directory with no supported name, so
 * its interface is not published and a consumer still reaches it relatively —
 * which is the ledger entry that has not yet retired. Reading the directory
 * instead would retire those entries the moment this check widened, recording a
 * repair that had not happened. The path-text alternative is refused for a
 * second reason too: D-171 says `surfaceOf` answers `'port'` for a relative
 * `services/ports/foo.ts`, which is a private file, and that a path heuristic
 * is *"correct for choosing a remedy sentence and wrong as a boundary
 * decision"*.
 *
 * The population is therefore derived in {@link main} and handed in as
 * {@link PortShapeInput.modulePorts}: nothing in the analysis below spells a
 * path, so a fixture enters with the same standing a real run has.
 *
 * ## Signal 4 — an interface declared by one module and implemented by another
 *
 * D-171 §4 used to refuse consumer-side declaration outright, on the ground
 * that `lazyPort<T>` is an unchecked cast. It is, and that is about the wrong
 * seam: conformance is checked at the **provider's** `implements` clause
 * (TS2420) and at its explicitly typed `providePort<T>` registration, whose
 * `Registration<T> = Resolver<T>` puts `T` in return position (TS2345). Both
 * resolve the interface wherever it was declared.
 *
 * D-171.1 therefore licenses the placement — for a mutual pair, on the side the
 * binding manifest `dependencies` edge points to — **against a condition**, and
 * this signal is the condition. What it refuses is
 * `declared-elsewhere-without-implements`: an interface declared in module A's
 * `ports/`, registered by a typed `providePort<T>` in module B ≠ A, which no
 * class in B names at an `implements` clause. That is precisely D-77's rejected
 * alternative — the consumer declares the seam *"in its own file, importing
 * nothing"* and the provider names it **nowhere**, so the only relation between
 * the two types is the cast, which is none.
 *
 * **No ledger, and for signal 1's reason.** An entry could only license the one
 * arrangement the condition exists to refuse.
 *
 * Two limits, in the header rather than discovered later. It asks whether the
 * **provider module** names the interface at an `implements` clause, not
 * whether the class the registration resolves to does: reading the registration
 * argument back to a class declaration is analysis this check does not have,
 * and a provider that implements the interface on a class it does not register
 * passes. And the complementary direction needs no code here — a registration
 * that drops its explicit type argument stops being seen as a registration at
 * all, so its interface lands in {@link PORTS_WITHOUT_A_REGISTRATION}, which is
 * empty and two-way.
 *
 * ## Signal 3 — the resolution side of the same name (issue #196)
 *
 * Signals 2 and 3 are **complements, not overlaps**, and the tree is the proof.
 * Signal 2 reads *contract doc → registration*: it starts at a published port's
 * doc block and asks whether the name it gives is registered and gated. It
 * found and corrected eight wrong doc lines. The three consumers that were
 * resolving the wrong name **stayed wrong**, because nothing walked the other
 * way. Signal 3 is that direction: *consumer resolution → publication*.
 *
 * The rule is **on the name, at the resolution site**, and it has to be,
 * because there is nowhere else it could bite. `lazyPort<T>(ctx, name)` is
 * `new Proxy({} as T, …)` (`src/kernel/lazy-port.ts`): `T` is a free type
 * parameter asserted onto an empty object and `name` is a `string`, so nothing
 * in the language relates the two. `tsc` is not satisfied because the entity
 * happens to be assignable to the record — `tsc` is satisfied because it was
 * never asked. That is why D-98.2 rejected branding the record types: a brand
 * can only bite where the compiler compares a value to the branded type, and
 * at a resolution it never does. What actually happens is that a **string gets
 * copied**, so the string is what this checks.
 *
 * One shape is refused — `resolution-of-unpublished-name` — over the two-way
 * {@link RESOLUTIONS_OF_UNPUBLISHED_NAMES} ledger, which states the population
 * and the two deliberate exclusions in full.
 *
 * ## Signal 2 — the documented container name (issue #192)
 *
 * `port-publication.md` §1.2 makes the container name part of the contract: it
 * is the literal a consumer copies into `lazyPort<T>(ctx, 'thatName')`. Nothing
 * checked it, and on the tree this signal was written against it was wrong six
 * times out of 97 — four naming a container nothing registers, and **two naming
 * the ungated legacy service the port was published to replace**. That second
 * pair is why this is a build failure rather than tidiness: a consumer following
 * `AdminRolePort`'s doc resolved `adminRoleService`, a plain `di.register` with
 * no presence gate, whose `list()` returns `AdminRole` **entities** — and
 * `AdminRole` is structurally assignable to `AdminRoleRecord`, so `tsc` said
 * nothing. A doc that teaches a Principle XVII violation is worse than no doc.
 *
 * Two shapes are refused:
 *
 *  - **`container-name-unregistered`** — the documented name appears in no
 *    `di.register` and no `di.providePort` anywhere under `src/modules` or
 *    `src/apps`. A consumer copying it gets
 *    `[kernel] '…' is not registered in this composition` at first call.
 *  - **`container-name-not-the-gated-registration`** — the port type *is*
 *    registered, by a typed `di.providePort<T>('X', …)`, and the doc names some
 *    other container. Whatever `Y` is, it is not the gate; where it happens to
 *    exist it is the ungated twin, which is the fail-open trap above.
 *
 * The second shape needs the registration's **type argument**, so it sees only
 * the 81 of 134 `providePort` calls that carry one. That is not a weakness of
 * this check but the reason A12 wants `providePort<T>` made non-inferrable: an
 * untyped registration compares nothing, here or in `tsc`.
 *
 * `PORTS_WITHOUT_A_REGISTRATION` is the ledger for the first shape, two-way and
 * empty since D-98.5. It is not a debt list to grow — an entry says why a
 * published interface with no provider is standing, and the check refuses a
 * stale one.
 *
 * ## Signal 1 — why the optional-method rule is a type rule and not advice
 *
 * A consumer that wants to know whether a provider implements something asks
 * the object. Through a port it cannot: `lazyPort` hands back a `Proxy` whose
 * `get` trap answers *every* non-symbol property with a function
 * (`src/kernel/lazy-port.ts`), so `x.maybe`, `!x.maybe` and
 * `typeof x.maybe === 'function'` are all truthy whatever is registered, and
 * `x.maybe?.()` therefore always calls — into a provider that does not
 * implement it, where the forward throws `'…' is not a function`.
 *
 * **And the proxy cannot be repaired.** Making the trap honest means resolving
 * the name at *property-access* time to look at the real object, and for a
 * gated port that turns a `typeof` probe into a `ModuleDisabledError`: a
 * presence check that throws when the module is absent is worse than the hazard
 * it fixes, and deferring resolution to the call is the entire reason `lazyPort`
 * exists. The runtime cannot be made to answer, so the type has to forbid the
 * question.
 *
 * `tsc` is silent on both halves: the member is optional, and `lazyPort<T>`'s
 * `T` is an assertion rather than a check. That is why a check reads the shape.
 *
 * The one occurrence this rule was written from —
 * `catalog`'s `AttributeDefinitionSource`, widening the custom-field read port
 * with `publishInvalidate?` — fired its recovery branch on every integrity
 * error and turned a benign, self-healing cache window into a 500 on the
 * attribute screens. D-97.1 deleted it, so this check is born green with red
 * proofs behind it and **no ledger**: there is nothing to drain, and an entry
 * would be a licence to re-open the only hole the rule has ever had.
 *
 * ## What it reads
 *
 *  1. **Published ports** — an exported `interface` in `packages/contracts/src`
 *     **or on a module package's declared `./ports` subpath** (D-171.1) whose
 *     doc block carries the `Container name:` line every port in the tree is
 *     introduced by. One parse, `portDocOf`, answers both "is this a port?" and
 *     "which container does it name?", so the signals cannot come to disagree
 *     about the population.
 *  2. **Interfaces extending one** — an `interface X extends <port>` anywhere in
 *     `backend/src/modules` or `backend/src/apps`, or in the contracts package
 *     itself. A widening is the shape that actually happened; refusing it only
 *     at the published type would refuse the tidy half.
 *  3. **Registrations** — `di.register` keys and `di.providePort` names in the
 *     same module sources, read through `check-port-dependencies.ts`'s
 *     `registeredNames` / `providedPorts`. Imported rather than re-derived: a
 *     second expression of "this call is a registration" is a rule that can go
 *     half-missing while the check still prints `violations=0`.
 *
 * A member is an optional method when it is a `foo?(…): T` signature **or** a
 * `foo?: (…) => T` property, because those are the same promise written twice.
 * Optional *parameters* and optional *data properties* are untouched — all 34
 * optional members across the tree's ports are of that kind, and none is
 * affected.
 *
 * Usage: `tsx scripts/check-port-shape.ts [--list]`
 * Exit 0 = clean; exit 1 = at least one finding, of any signal;
 * exit 2 = nothing was read. Six conditions, one per input any signal could be
 * silently missing (issue #113), because a green must never be able to mean
 * "not looking": no sources; no port type in the contracts package; **no
 * registration in the module scan** — an empty registration map would report
 * every published port as unregistered, and a reader who "fixed" that by
 * widening the ledger would have turned the whole check off; **no published
 * container name** — signal 3 compares a consumer's literal against that set,
 * and an empty one makes every cross-module resolution in the tree a finding;
 * **no `lazyPort` resolution at all** — signal 3's population, whose emptiness
 * would otherwise read as a clean bill; and **no module-declared port**, which
 * is signal 4's whole population and the half of signal 3's the widening added.
 * That last one is the one to understand: the widening is what retires the
 * resolution ledger's entries, so a walk that stopped producing module ports
 * would report those entries stale and invite an author to delete them — the
 * exact inverse of the repair.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  HOST_REGISTERED_PORTS,
  PLATFORM_OWNED_NAMES,
  moduleOf,
  providedPorts,
  registeredNames,
  resolvedNames,
} from './check-port-dependencies.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CONTRACTS_SRC = join(HERE, '..', '..', 'packages', 'contracts', 'src');

/** The line every port's doc block carries, and the only marker that finds one. */
const PORT_DOC_MARKER = 'Container name:';

export type PortShapeFindingKind =
  /** The optional method is on the published port type itself. */
  | 'optional-method-on-port'
  /** The optional method is on an interface that `extends` a published port. */
  | 'optional-method-on-port-extension';

export interface PortShapeFinding {
  /** Path as the caller keyed it. */
  readonly file: string;
  readonly line: number;
  /** The interface the member is declared on. */
  readonly typeName: string;
  /** The published port the type is, or extends. */
  readonly portName: string;
  readonly member: string;
  readonly kind: PortShapeFindingKind;
}

export type PortNameFindingKind =
  /** The documented container name is registered nowhere. */
  | 'container-name-unregistered'
  /**
   * The port type is registered by a typed `providePort<T>`, under a name the
   * doc block does not give. Where the documented name exists at all it is the
   * ungated twin, and that is the fail-open half of this signal.
   */
  | 'container-name-not-the-gated-registration';

export interface PortNameFinding {
  /** Contract file, as the caller keyed it. */
  readonly file: string;
  readonly line: number;
  /** The published port type. */
  readonly portName: string;
  /** The container name the doc block gives. */
  readonly documented: string;
  /**
   * The name the port is really registered under, for
   * `container-name-not-the-gated-registration`; `null` for the unregistered
   * shape, where there is nothing to point at.
   */
  readonly registered: string | null;
  /**
   * How the documented name *is* registered, when it is: `'plain'` for a
   * `di.register` key, `'gated'` for a `di.providePort`. `null` when nothing
   * registers it. A `'plain'` here is the trap — an ungated registration behind
   * a name the contract advertises.
   */
  readonly documentedRegistrationKind: 'plain' | 'gated' | null;
  readonly kind: PortNameFindingKind;
}

/**
 * Published interfaces with no registration behind them, and why each stands.
 *
 * **Two-way**: an entry whose port has gained a registration, or whose port no
 * longer exists, fails the check as stale. This is not a queue to add to — a
 * port nobody provides is what `@endora-commerce/contracts` would publish to the outside
 * world at F4, so an entry is a decision that has been taken and recorded, not
 * one deferred.
 *
 * **Empty, which is the state this ledger should be in.** Its one entry was
 * `ModuleManifestReadPort`, standing unprovided while Q2 of the Phase-P
 * unreached-port audit was open; D-98.5 answered it — module manifests are
 * platform-owned and the interface is deleted — by the retirement condition
 * that entry itself named.
 */
export const PORTS_WITHOUT_A_REGISTRATION: Readonly<Record<string, string>> = {};

/**
 * Signal 3 — a cross-module `lazyPort` resolution of a container name **no
 * contract publishes** (issue #196, D-98.2).
 */
export type UnpublishedResolutionKind = 'resolution-of-unpublished-name';

export interface UnpublishedResolutionFinding {
  /** The resolving module. */
  readonly moduleId: string;
  /** The module whose `backend.ts` registers the name. */
  readonly owner: string;
  /** The container name, as the literal is written. */
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly kind: UnpublishedResolutionKind;
}

/**
 * Cross-module resolutions of a name nothing publishes, keyed
 * `<consumer>:<name>`, each with the reason it still stands.
 *
 * **Two-way and meant to drain.** An unledgered resolution fails the build; an
 * entry whose site has gone, or now resolves a published name, fails it too.
 *
 * The rule the ledger defends: **a module may resolve, cross-module, only a
 * container name some contract publishes.** Nothing else in the tree can see a
 * breach of it. `check:port-shape`'s signal 2 reads *contract doc →
 * registration*, so it catches a doc pointing at the wrong thing; this reads
 * *consumer resolution → publication*, and catches a consumer pointing at the
 * wrong thing. MR !698 corrected eight doc blocks and the three consumers that
 * were resolving the wrong name stayed wrong — that is the existence proof
 * that one direction does not imply the other.
 *
 * It is a rule about the **name**, not about the type. `lazyPort<T>` is
 * `new Proxy({} as T, …)` (`src/kernel/lazy-port.ts`): `T` is asserted and
 * `name` is a string, and nothing in the language relates the two. That is why
 * D-98.2 rejected branded record types — a brand can only bite where the
 * compiler compares a value to the branded type, and here it never does. What
 * actually happens is that a string gets copied, so the string is what gets
 * checked.
 *
 * Population, stated so an entry cannot quietly widen it: every
 * `lazyPort<…>(ctx, '<literal>')` in `src/modules/**` and `src/apps/**` whose
 * name is registered by a **different** module and is not platform-owned. A
 * self-resolution is not a finding — a module naming its own registration is
 * not reaching across a boundary. A **cradle** read is not a finding either,
 * and that is a decision rather than an omission: a cradle name is a
 * contribution seam a composition root or the kernel supplies, where "name a
 * published contract" would be the wrong requirement. `PortResolution.via`
 * carries the distinction from the one function that decides it.
 *
 * **Publication is the `./ports` subpath *and* the `Container name:` marker, and
 * an entry can stand on either half being absent.** Since D-171.1 an owner that
 * has been packaged publishes its interface, so the entry goes — that is what
 * retired `carts`, `invoices`, `inventory` and `custom_fields`, whose consumers
 * had already been converted to name the subpath and whose entries only this
 * check could not see were spent. Three of the entries left have packaged
 * owners and stand anyway, because their `ports/` declarations name the
 * container in **prose** rather than in the marker line `portDocOf` reads
 * (`creditLimitService`, `promotionUsageFinalizer`,
 * `personalOrganizationProvisionApi`). That is an omission rather than a
 * decision, and it is recorded rather than repaired here: adding a marker
 * publishes a name, which is signal 2's subject and the owner's call.
 */
export const RESOLUTIONS_OF_UNPUBLISHED_NAMES: Readonly<Record<string, string>> = {
  // The two D-94.5 ports, and they are one entry written twice: each is an
  // interface the **owner** declares beside its implementation, deliberately
  // outside `@endora-commerce/contracts`, because its signature carries the caller's
  // MikroORM `EntityManager` and FR-034 keeps a MikroORM type out of that
  // package. Both are held there by a foreign key rather than by a convention
  // — `credit_limit_reservations_order_fk` and `promotion_usages_order_fk`,
  // both `on delete restrict` — so the reservation and the usage row must be
  // written inside the placement's own transaction.
  //
  // They are `permanent: true` entries in `orders`' cross-module-imports shard
  // for exactly that reason, and they retire the same way that shard says they
  // do: F4 package entry points, not a port and not a doc block. Publishing
  // either shape today would mean publishing an `EntityManager`.
  'orders:creditLimitService':
    'D-94.5 — `CreditLimitPort` is declared by `credit_limits` beside its ' +
    'implementation and stays out of `@endora-commerce/contracts` because `reserve` takes the ' +
    "caller's `EntityManager` (FR-034); `credit_limit_reservations_order_fk` is what " +
    'holds it co-transactional. Retired by F4 package entry points, as the matching ' +
    "`permanent: true` entry in `orders`' cross-module-imports shard says.",
  'orders:promotionUsageFinalizer':
    'D-94.5 — the twin of the entry above and the same shape: `PromotionUsageFinalizer` ' +
    'is `promotions`\' own interface, kept out of `@endora-commerce/contracts` because ' +
    '`finalizeUsage` takes the placement transaction, and held there by ' +
    '`promotion_usages_order_fk`. Retired by F4 package entry points.',
  // Feature 080's T048, and the same shape twice more: an owner's own
  // `EntityManager`-taking interface, kept out of `@endora-commerce/contracts`
  // because FR-034 keeps a MikroORM type out of a package `admin` and
  // `storefront` both compile, and held co-transactional by a foreign key
  // rather than by a convention. Each replaces a reach into that owner's
  // **entity class**, which D-168 leaves a packaged module no supported
  // spelling for — so the entries are not new debt, they are the same seam
  // spelled in the shape D-169 mandates, and each is a `permanent: true` entry
  // in its consumer's cross-module-imports shard.
  //
  // **This family opened with five and is down to two, and the three that went
  // are what D-171.1's widening measures.** `carts`, `invoices` and `inventory`
  // are packages now, so their interfaces sit on a declared `./ports` subpath,
  // their consumers name that subpath, and the names are published in exactly
  // the sense this check means — the seams were repaired and only this check
  // could not see it. The two below are the mutual pair, whose owners are still
  // in the application tree: there `ports/` is a directory with no supported
  // name, so the entries stand until T040b packages them.
  'orders:paymentPlacementApplyPort':
    'T048 / D-169 / D-179 — the last of the family, and the mirror of the entry below: ' +
    "`PaymentPlacementApplyPort` is `payments`' own interface, kept out of " +
    '`@endora-commerce/contracts` because both methods take the placement transaction ' +
    '(FR-034), and held there by `payments_order_fk` (`on delete restrict`) — the payment ' +
    'row cannot exist before the order does, and the order does not commit until placement ' +
    'returns. It replaces the `Payment` entity import `orders` held, which was the last ' +
    "cross-module entity-class reach in the tree, and is a `permanent: true` entry in " +
    "`orders`' cross-module-imports shard. This name and the one below are the same two " +
    'modules seen from either end, so the pair retires together, with F4 package entry ' +
    'points.',
  'payments:orderPaymentStatusApplyPort':
    'T048 / D-169 — the same shape walked the other way: `OrderPaymentStatusApplyPort` is ' +
    "`orders`' own interface, kept out of `@endora-commerce/contracts` because " +
    '`applyPaymentStatus` takes the settlement transaction, and held there by ' +
    '`payments_order_fk` (`on delete restrict`) — the payment row and the order`s ' +
    '`payment_status` land together or not at all. It replaces the `Order` entity import ' +
    "`payments` held, and is a `permanent: true` entry in `payments`' " +
    'cross-module-imports shard. Retired by F4 package entry points.',
  // D-178's seam, and the same shape once more: an interface the owner declares
  // beside its implementation, kept out of `@endora-commerce/contracts` because
  // its signature carries the caller's `EntityManager`, held co-transactional by
  // a foreign key.
  'customer_accounts:personalOrganizationProvisionApi':
    'D-178 — `PersonalOrganizationProvisionApi` is declared by `organizations` beside its ' +
    'implementation and stays out of `@endora-commerce/contracts` because `provisionFor` takes ' +
    "the caller's `EntityManager` (FR-034). What holds it co-transactional is " +
    '`customer_accounts_organization_fk` (`on delete restrict`) over a column D-178 makes ' +
    '`NOT NULL`: the account row cannot be inserted before its Organization exists, and a ' +
    'second transaction cannot satisfy a foreign key against a row it cannot see. Splitting ' +
    'the two reopens the window that ruling closed — a committed account with no tenant, and ' +
    'nothing that retries. The **read**-shaped half of the same capability is published, as ' +
    "`PersonalOrganizationPort`; this name answers only the write. Retired by F4 package " +
    "entry points, as the matching `permanent: true` entries in this module's " +
    'cross-module-imports shard say.',
};

/**
 * Signal 4 — an interface one module declares for another to implement, where
 * the provider names it at no `implements` clause (D-171.1).
 */
export type DeclaredElsewhereKind = 'declared-elsewhere-without-implements';

export interface DeclaredElsewhereFinding {
  /** The port interface, as declared. */
  readonly portName: string;
  /** Where it is declared, as the caller keyed it. */
  readonly file: string;
  readonly line: number;
  /** The module whose `ports/` directory declares it. */
  readonly declaringModule: string;
  /** The module whose typed `providePort<T>` registers it. */
  readonly providingModule: string;
  /** The container name that registration gives. */
  readonly container: string;
  readonly kind: DeclaredElsewhereKind;
}

export interface PortShapeInput {
  /** Contract sources, keyed however the caller likes (the key is reported). */
  readonly contracts: ReadonlyMap<string, string>;
  /** Module sources — `src/modules/**`, `src/apps/**`. */
  readonly modules: ReadonlyMap<string, string>;
  /**
   * The sources behind a module package's declared `./ports` subpath — the
   * second half of the published population since D-171.1. Keyed like
   * {@link PortShapeInput.modules}, and the module id is read off the key by the
   * same `moduleOf` everything else here uses. Derived in {@link main} from the
   * packages' `exports` maps, so no path shape is spelled below and a fixture
   * enters where a real run does.
   */
  readonly modulePorts?: ReadonlyMap<string, string>;
  /** Defaults to {@link PORTS_WITHOUT_A_REGISTRATION}; a fixture overrides it. */
  readonly unregisteredLedger?: Readonly<Record<string, string>>;
  /**
   * Defaults to {@link RESOLUTIONS_OF_UNPUBLISHED_NAMES}; a fixture overrides
   * it, so a red proof over the stale direction does not have to disturb the
   * real one.
   */
  readonly unpublishedResolutionLedger?: Readonly<Record<string, string>>;
}

export interface PortShapeResult {
  /** Every published port type found, by name. Empty means "not looking". */
  readonly portTypes: readonly string[];
  readonly findings: readonly PortShapeFinding[];
  /** Signal 2 — the documented container name against the registered one. */
  readonly nameFindings: readonly PortNameFinding[];
  /**
   * How many distinct container names the module scan saw. Zero means the scan
   * read nothing, which the CLI turns into exit 2 rather than into 97 findings.
   */
  readonly registeredNameCount: number;
  /** Ledger entries whose port is registered now, or no longer published. */
  readonly staleLedgerEntries: readonly string[];
  /** Signal 3 — a cross-module resolution of a name no contract publishes. */
  readonly unpublishedResolutions: readonly UnpublishedResolutionFinding[];
  /**
   * How many distinct container names the contract scan found published. Zero
   * means the doc convention was not read, which the CLI turns into exit 2
   * rather than into a finding per cross-module resolution in the tree.
   */
  readonly publishedContainerCount: number;
  /**
   * How many `lazyPort` resolutions the module scan saw, before any filtering.
   * Zero means the population came back empty, which is "not looking" rather
   * than "clean" (issue #113).
   */
  readonly lazyPortResolutionCount: number;
  /** `<consumer>:<name>` entries no resolution in the tree answers to. */
  readonly staleUnpublishedResolutions: readonly string[];
  /** Signal 4 — a port declared for another module, implemented by nothing. */
  readonly declaredElsewhere: readonly DeclaredElsewhereFinding[];
  /**
   * How many published ports came out of the **module** half of the population.
   * Zero means the widening D-171.1 rests on read nothing, which the CLI turns
   * into exit 2 — signal 4 would have no population at all, and signal 3 would
   * report the resolution ledger's retired entries as live findings again.
   */
  readonly modulePortCount: number;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/**
 * What a port's doc block declares.
 *
 * `containers` is **a list**, not one name, because a published shape may have
 * more than one provider: `OrderStatusRegistry` is registered by
 * `payment_methods` as `paymentOrderStatusRegistry` and by `delivery_methods`
 * as `shippingOrderStatusRegistry`, in the same words, and the interface is
 * declared once precisely so the two cannot drift. A doc block naming only the
 * first left the second unpublished, and signal 3 below reported the consumer
 * that resolved it. Empty means the block carries the marker but no parseable
 * name.
 */
interface PortDoc {
  readonly containers: readonly string[];
}

/**
 * The declaration's port doc block, or `null` when it has none.
 *
 * The single answer to "is this a published port?" — signal 1 asks it to build
 * the population, signal 2 asks it for the name and signal 3 asks it for the
 * set of published names, so none of the three can drift into its own idea of
 * what a port is.
 */
function portDocOf(node: ts.InterfaceDeclaration, text: string): PortDoc | null {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  const block = ranges
    .map((range) => text.slice(range.pos, range.end))
    .find((comment) => comment.includes(PORT_DOC_MARKER));
  if (block === undefined) return null;
  const containers = [...block.matchAll(/Container name:\s*`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  return { containers };
}

function interfaces(sf: ts.SourceFile): ts.InterfaceDeclaration[] {
  const found: ts.InterfaceDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) found.push(node);
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * Every interface name a class in this file names at an `implements` clause.
 *
 * Signal 4's evidence, and the one `tsc` acts on: `implements` is resolved
 * against the type wherever it was declared, so a missing member is TS2420
 * whichever package the interface came from. A class `extends` clause is
 * deliberately not read — it is not a conformance claim about an interface.
 */
function implementedNames(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/**
 * The module a source key belongs to.
 *
 * `moduleOf` keys on `/src/modules/<id>/` and falls back to the first
 * `modules/<id>/` segment, while this function's inputs are keyed however the
 * caller likes — so the key is normalised for it and the caller's own key is
 * what gets reported. Normalising is not re-deciding: the id still comes from
 * the one function that owns that question.
 */
function moduleOfKey(file: string): string | null {
  return moduleOf(forOwnerLookup(file));
}

/** The key spelling `moduleOf`, `registeredNames` and `resolvedNames` expect. */
function forOwnerLookup(file: string): string {
  return file.includes('/src/') ? file : `/src/${file.replace(/^\/+/, '')}`;
}

/** The names an interface extends, as written (type arguments dropped). */
function extendedNames(node: ts.InterfaceDeclaration): string[] {
  const names: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
    }
  }
  return names;
}

/**
 * The optional **methods** of an interface.
 *
 * Both spellings, because they are one promise: `foo?(): void` is a
 * `MethodSignature` with a question token, `foo?: () => void` a
 * `PropertySignature` whose type is a function. A `foo?: string` is a data
 * property and is deliberately outside the population.
 */
function optionalMethods(node: ts.InterfaceDeclaration): ts.TypeElement[] {
  return node.members.filter((member) => {
    if (member.questionToken === undefined) return false;
    if (ts.isMethodSignature(member)) return true;
    if (ts.isPropertySignature(member) && member.type !== undefined) {
      return ts.isFunctionTypeNode(member.type);
    }
    return false;
  });
}

function memberName(member: ts.TypeElement): string {
  const name = member.name;
  if (name === undefined) return '(computed)';
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

/**
 * Every published port, and every optional method on one or on a widening
 * of one.
 *
 * The input is **source text**, so a fixture enters exactly where a real run
 * does (issue #130): nothing above this function classifies anything.
 */
export function checkPortShape(input: PortShapeInput): PortShapeResult {
  const parsedContracts = new Map<string, ts.SourceFile>();
  const portTypes = new Set<string>();
  /** Every published port, with where it is declared and what it documents. */
  const published: Array<{
    readonly portName: string;
    readonly file: string;
    readonly line: number;
    readonly containers: readonly string[];
    /**
     * The module whose `ports/` directory declares it; `null` for a port in the
     * contracts package, which belongs to no module. Signal 4's subject.
     */
    readonly declaringModule: string | null;
  }> = [];

  /**
   * One sweep for both halves of the population — the contracts package and the
   * modules' own `ports/` directories. `portDocOf` decides membership in both,
   * so the two cannot come to disagree about what a published port is.
   */
  const collect = (
    file: string,
    text: string,
    declaringModule: string | null,
    remember: (sf: ts.SourceFile) => void,
  ): number => {
    const sf = parse(file, text);
    remember(sf);
    let found = 0;
    for (const node of interfaces(sf)) {
      const doc = portDocOf(node, text);
      if (doc === null) continue;
      found += 1;
      portTypes.add(node.name.text);
      published.push({
        portName: node.name.text,
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        containers: doc.containers,
        declaringModule,
      });
    }
    return found;
  };

  for (const [file, text] of input.contracts) {
    collect(file, text, null, (sf) => parsedContracts.set(file, sf));
  }

  const modulePorts = input.modulePorts ?? new Map<string, string>();
  const parsedModulePorts = new Map<string, ts.SourceFile>();
  let modulePortCount = 0;
  for (const [file, text] of modulePorts) {
    modulePortCount += collect(file, text, moduleOfKey(file), (sf) =>
      parsedModulePorts.set(file, sf),
    );
  }

  const findings: PortShapeFinding[] = [];
  const scan = (file: string, sf: ts.SourceFile): void => {
    for (const node of interfaces(sf)) {
      const own = portTypes.has(node.name.text);
      const extended = extendedNames(node).find((name) => portTypes.has(name));
      if (!own && extended === undefined) continue;
      // A port type declaring an optional method is the stronger finding, so a
      // type that is both a port and an extension is reported as the port.
      const kind: PortShapeFindingKind = own
        ? 'optional-method-on-port'
        : 'optional-method-on-port-extension';
      const portName = own ? node.name.text : (extended as string);
      for (const member of optionalMethods(node)) {
        findings.push({
          file,
          line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
          typeName: node.name.text,
          portName,
          member: memberName(member),
          kind,
        });
      }
    }
  };

  for (const [file, sf] of parsedContracts) scan(file, sf);
  // A ports file is walked by both halves of a real run — it is a module source
  // and it is a port declaration — so signal 1 scans the union keyed by file,
  // never the concatenation, which would report an optional method twice.
  const moduleScan = new Map<string, ts.SourceFile>();
  for (const [file, text] of input.modules) moduleScan.set(file, parse(file, text));
  for (const [file, sf] of parsedModulePorts) if (!moduleScan.has(file)) moduleScan.set(file, sf);
  for (const [file, sf] of moduleScan) scan(file, sf);

  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  // --- signal 2: the documented container name -------------------------------
  //
  // Both registration readers come from `check-port-dependencies.ts`, which owns
  // the "this call is a registration" predicate. `registeredNames` already
  // covers `providePort` names, so `plainNames` is derived by subtraction rather
  // than by a second parse deciding the same thing differently.
  const allNames = new Set<string>();
  const gatedNames = new Set<string>();
  /** Container name a typed `providePort<T>` gives each port type. */
  const gatedNameOfType = new Map<string, string>();
  /** The module that typed registration sits in — signal 4's other half. */
  const gatedModuleOfType = new Map<string, string>();
  /** Module id → every interface name a class in it `implements`. */
  const implementsByModule = new Map<string, Set<string>>();
  for (const [file, text] of input.modules) {
    for (const name of registeredNames(text, file)) allNames.add(name);
    for (const port of providedPorts(text, file)) {
      gatedNames.add(port.name);
      if (port.typeName !== null && !gatedNameOfType.has(port.typeName)) {
        gatedNameOfType.set(port.typeName, port.name);
        const owner = moduleOfKey(file);
        if (owner !== null) gatedModuleOfType.set(port.typeName, owner);
      }
    }
  }
  for (const [file, sf] of moduleScan) {
    const owner = moduleOfKey(file);
    if (owner === null) continue;
    for (const name of implementedNames(sf)) {
      const claimed = implementsByModule.get(owner);
      if (claimed) claimed.add(name);
      else implementsByModule.set(owner, new Set([name]));
    }
  }

  const ledger = input.unregisteredLedger ?? PORTS_WITHOUT_A_REGISTRATION;
  const nameFindings: PortNameFinding[] = [];
  const ledgerHits = new Set<string>();

  const registrationKindOf = (container: string): 'gated' | 'plain' | null =>
    gatedNames.has(container) ? 'gated' : allNames.has(container) ? 'plain' : null;

  for (const port of published) {
    if (port.containers.length === 0) continue;
    const gatedName = gatedNameOfType.get(port.portName);
    const unregistered = port.containers.filter((name) => registrationKindOf(name) === null);

    // "No registration behind this published interface at all" is the shape the
    // ledger answers for, so it is asked once per port and not once per
    // documented name: a port with two providers where one is missing is a
    // wrong doc line, not an unprovided port.
    if (unregistered.length === port.containers.length) {
      if (ledger[port.portName] !== undefined) {
        ledgerHits.add(port.portName);
        continue;
      }
    }

    for (const documented of unregistered) {
      nameFindings.push({
        file: port.file,
        line: port.line,
        portName: port.portName,
        documented,
        registered: gatedName ?? null,
        documentedRegistrationKind: null,
        kind: 'container-name-unregistered',
      });
    }

    // The gated-registration shape asks whether the doc names the gate **at
    // all**. With two providers only one of them can be the typed
    // `providePort<T>` this map records, so requiring every documented name to
    // be it would refuse the two-provider shape rather than the defect.
    if (gatedName !== undefined && !port.containers.includes(gatedName)) {
      const documented = port.containers[0] as string;
      nameFindings.push({
        file: port.file,
        line: port.line,
        portName: port.portName,
        documented,
        registered: gatedName,
        documentedRegistrationKind: registrationKindOf(documented),
        kind: 'container-name-not-the-gated-registration',
      });
    }
  }

  nameFindings.sort((a, b) => a.portName.localeCompare(b.portName));
  const staleLedgerEntries = Object.keys(ledger)
    .filter((portName) => !ledgerHits.has(portName))
    .sort();

  // --- signal 4: the condition D-171.1 licenses the placement against ---------
  //
  // Only a port a **module** declares can be in this population: a port in
  // `packages/contracts` belongs to no module, so "declared elsewhere" has no
  // meaning for it. And only where the typed registration is in a *different*
  // module — the ordinary case, where the owner declares and implements its own
  // interface, is what D-171 §4 already describes and is untouched.
  const declaredElsewhere: DeclaredElsewhereFinding[] = [];
  for (const port of published) {
    if (port.declaringModule === null) continue;
    const provider = gatedModuleOfType.get(port.portName);
    if (provider === undefined || provider === port.declaringModule) continue;
    if (implementsByModule.get(provider)?.has(port.portName) === true) continue;
    declaredElsewhere.push({
      portName: port.portName,
      file: port.file,
      line: port.line,
      declaringModule: port.declaringModule,
      providingModule: provider,
      container: gatedNameOfType.get(port.portName) as string,
      kind: 'declared-elsewhere-without-implements',
    });
  }
  declaredElsewhere.sort((a, b) => a.portName.localeCompare(b.portName));

  // --- signal 3: the resolution side of the same name ------------------------
  //
  // Signal 2 above walks contract doc -> registration. This walks consumer
  // resolution -> publication, which is a different edge in the other
  // direction, and the one nothing in the tree could see: !698 corrected six
  // doc blocks while three consumers went on resolving the class name.
  //
  // Every predicate it needs already exists. "Which module registers this
  // name" is `registeredNames` + `moduleOf`; "this is a `lazyPort` resolution"
  // is `resolvedNames`, through the `via` field it records; "this name is
  // published" is `portDocOf`, the same parse signals 1 and 2 use. Nothing here
  // decides any of those a second time.
  const publishedContainers = new Set<string>();
  for (const port of published) for (const name of port.containers) publishedContainers.add(name);

  /** Container name -> the module whose sources register it. */
  const ownerOfName = new Map<string, string>();
  const lazyResolutions: Array<{
    readonly moduleId: string;
    readonly name: string;
    readonly file: string;
    readonly line: number;
  }> = [];
  for (const [file, text] of input.modules) {
    // `moduleOf` and `resolvedNames` read the module id out of the path, and
    // they key on `/src/modules/<id>/` — while this function's inputs are keyed
    // however the caller likes, which is what lets a fixture enter at the top.
    // So the path is normalised for them and the caller's own key is what gets
    // reported. Normalising is not re-deciding: the module id still comes from
    // the one function that owns that question.
    const lookupKey = forOwnerLookup(file);
    const moduleId = moduleOf(lookupKey);
    if (moduleId === null) continue;
    for (const name of registeredNames(text, lookupKey)) ownerOfName.set(name, moduleId);
    for (const resolution of resolvedNames(text, lookupKey)) {
      if (resolution.via !== 'lazyPort') continue;
      lazyResolutions.push({
        moduleId: resolution.moduleId,
        name: resolution.name,
        file,
        line: resolution.line,
      });
    }
  }

  const resolutionLedger =
    input.unpublishedResolutionLedger ?? RESOLUTIONS_OF_UNPUBLISHED_NAMES;
  const unpublishedResolutions: UnpublishedResolutionFinding[] = [];
  const resolutionLedgerHits = new Set<string>();

  for (const resolution of lazyResolutions) {
    // Platform names are supplied by a composition root or the kernel, neither
    // of which has a contracts file to publish from; `HOST_REGISTERED_PORTS`
    // is the same fact for a port a root still bridges on its owner's behalf.
    if (PLATFORM_OWNED_NAMES.has(resolution.name)) continue;
    if (HOST_REGISTERED_PORTS[resolution.name] !== undefined) continue;
    const owner = ownerOfName.get(resolution.name);
    // A name nothing registers is `check-port-dependencies`' `unowned-name`,
    // and reporting it here as well would give one defect two voices.
    if (owner === undefined) continue;
    // A module naming its own registration crosses no boundary.
    if (owner === resolution.moduleId) continue;
    if (publishedContainers.has(resolution.name)) continue;
    const key = `${resolution.moduleId}:${resolution.name}`;
    if (resolutionLedger[key] !== undefined) {
      resolutionLedgerHits.add(key);
      continue;
    }
    unpublishedResolutions.push({
      moduleId: resolution.moduleId,
      owner,
      name: resolution.name,
      file: resolution.file,
      line: resolution.line,
      kind: 'resolution-of-unpublished-name',
    });
  }

  unpublishedResolutions.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  const staleUnpublishedResolutions = Object.keys(resolutionLedger)
    .filter((key) => !resolutionLedgerHits.has(key))
    .sort();

  return {
    portTypes: [...portTypes].sort(),
    findings,
    nameFindings,
    registeredNameCount: allNames.size,
    staleLedgerEntries,
    unpublishedResolutions,
    publishedContainerCount: publishedContainers.size,
    lazyPortResolutionCount: lazyResolutions.length,
    staleUnpublishedResolutions,
    declaredElsewhere,
    modulePortCount,
  };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every module's own `ports/` directory, and the package manifests that say
 * which of them must exist.
 *
 * **"The module's own directory", never "a path with a `ports` segment in
 * it".** D-171 is explicit that `surfaceOf` answers `'port'` for a relative
 * `services/ports/foo.ts`, which is a private file, and that a path-text
 * heuristic is *"correct for choosing a remedy sentence and wrong as a boundary
 * decision"*. So the directory is reached from the module's own location, which
 * `module-roots.ts` derives, and the two source layouts are **probed**: a module
 * in the application tree keeps its sources at its directory, a module package
 * one level in, under the source root its build compiles from. `existsSync`
 * answers rather than a rule, so a package arranged differently is followed
 * rather than silently missed.
 *
 * `declaredPortsSubpaths` is the independent second author (issue #244): a
 * package's `exports` map declares `./ports` or it does not, and that is
 * written by the manifest generator from the file's presence — a different
 * derivation of the same fact, so a walk that stopped seeing ports directories
 * disagrees with it in the same run.
 */
function modulePortsPopulation(layout: ModuleTreeLayout): {
  readonly files: string[];
  readonly packagesDeclaringPorts: number;
  readonly packagesWalked: number;
} {
  const files: string[] = [];
  let packagesDeclaringPorts = 0;
  let packagesWalked = 0;

  for (const root of layout.moduleRoots) {
    if (root.origin !== 'workspace-package') continue;
    const manifestPath = join(root.directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    if (manifest.exports?.['./ports'] === undefined) continue;
    packagesDeclaringPorts += 1;
    // The declaration is the publication; the location is a probe. A package
    // keeps its sources under the root its build compiles from, which is `src`
    // for every package the generator renders — so `existsSync` answers, and a
    // package arranged differently contributes nothing rather than being
    // guessed at.
    const portsDir = join(root.directory, 'src', 'ports');
    const found = existsSync(portsDir) ? walk(portsDir) : [];
    if (found.length > 0) packagesWalked += 1;
    files.push(...found);
  }

  return { files, packagesDeclaringPorts, packagesWalked };
}

/** Absolute paths → sources, keyed by the layout's own spelling (T040a). */
function keyed(files: readonly string[], keyOf: (file: string) => string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) sources.set(keyOf(file), readFileSync(file, 'utf8'));
  return sources;
}

function read(root: string, files: string[], prefix: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(`${prefix}${relative(root, file).split('\\').join('/')}`, readFileSync(file, 'utf8'));
  }
  return sources;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');

  // Every root a module's source can live in, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[port-shape]');
  const contractFiles = walk(CONTRACTS_SRC);
  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  if (contractFiles.length === 0) {
    console.error(
      '[port-shape] no sources under packages/contracts/src — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  // The module half of that pair was an emptiness test, and emptiness is the
  // one case a moved module tree does not produce (issue #215): `src/apps`
  // survives it, and the three floors below are each satisfied by a single
  // surviving registration or resolution. The floor is per registered module.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[port-shape]',
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const ports = modulePortsPopulation(layout);
  const input: PortShapeInput = {
    contracts: read(CONTRACTS_SRC, contractFiles, 'contracts/'),
    modules: keyed(moduleFiles, layout.keyOf),
    modulePorts: keyed(ports.files, layout.keyOf),
  };
  const result = checkPortShape(input);

  if (result.portTypes.length === 0) {
    console.error(
      `[port-shape] no published port found in ${contractFiles.length} contract files — ` +
        `the '${PORT_DOC_MARKER}' doc convention changed, and a green here would mean ` +
        `"not looking" rather than "clean"`,
    );
    process.exit(2);
  }

  if (result.registeredNameCount === 0) {
    console.error(
      `[port-shape] the scan of ${moduleFiles.length} module files found no container ` +
        `registration at all — every published port would read as unregistered, so this ` +
        `is "not looking" rather than a result (issue #113)`,
    );
    process.exit(2);
  }

  if (result.publishedContainerCount === 0) {
    console.error(
      `[port-shape] not one of the ${result.portTypes.length} published ports names a ` +
        `container — the '${PORT_DOC_MARKER}' line is what signal 3 compares a consumer's ` +
        `\`lazyPort\` literal against, so every cross-module resolution in the tree would ` +
        `read as unpublished (issue #113)`,
    );
    process.exit(2);
  }

  if (result.lazyPortResolutionCount === 0) {
    console.error(
      `[port-shape] the scan of ${moduleFiles.length} module files found no \`lazyPort\` ` +
        `resolution at all — signal 3's population is empty, which is "not looking" rather ` +
        `than "clean" (issue #113)`,
    );
    process.exit(2);
  }

  if (result.modulePortCount === 0) {
    console.error(
      `[port-shape] the walk of ${ports.files.length} module \`ports/\` files found no ` +
        `published port — D-171.1 widened this check's population to a module's own ` +
        `\`ports/\` directory, and a walk that produces none has turned signal 4 off ` +
        `entirely and reported the resolution ledger's retired entries as stale, which ` +
        `invites deleting the record of a repair that did not happen (issue #113)`,
    );
    process.exit(2);
  }

  if (listMode) {
    for (const name of result.portTypes) console.log(`PORT ${name}`);
    console.log('');
  }

  const violations =
    result.findings.length +
    result.nameFindings.length +
    result.staleLedgerEntries.length +
    result.unpublishedResolutions.length +
    result.staleUnpublishedResolutions.length +
    result.declaredElsewhere.length;
  // What was read, in the shared grammar (issue #244). `files` is both walks —
  // the contracts package and the module tree — and `sites` is the union of the
  // two unit kinds this check judges: the published ports (signals 1 and 2) and
  // the cross-module resolutions (signal 3). Each has a floor of its own above;
  // the union is what the ratchet watches for a silent halving.
  reportReadSize({
    prefix: '[port-shape]',
    files: contractFiles.length + moduleFiles.length + ports.files.length,
    sites: result.portTypes.length + result.lazyPortResolutionCount,
    coverage: [
      coverage,
      // The second author for the half of the population D-171.1 added: a
      // module package's `exports` map declares `./ports` because the generator
      // saw the file, so a walk that stopped finding ports directories
      // disagrees with the manifests in the same run.
      {
        source: 'ports-subpaths',
        expected: ports.packagesDeclaringPorts,
        covered: ports.packagesWalked,
      },
    ],
  });
  console.log(
    `[port-shape] ports=${result.portTypes.length} ` +
      `module-declared-ports=${result.modulePortCount} ` +
      `contract-files=${contractFiles.length} module-files=${moduleFiles.length} ` +
      `module-port-files=${ports.files.length} ` +
      `registered-names=${result.registeredNameCount} ` +
      `published-container-names=${result.publishedContainerCount} ` +
      `lazy-port-resolutions=${result.lazyPortResolutionCount} ` +
      `ledgered-unregistered=${Object.keys(PORTS_WITHOUT_A_REGISTRATION).length} ` +
      `ledgered-unpublished-resolutions=` +
      `${Object.keys(RESOLUTIONS_OF_UNPUBLISHED_NAMES).length} ` +
      `violations=${violations}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA published port declares an optional method, so a consumer can neither detect it\n' +
        'nor safely call it: `lazyPort`\'s proxy answers every property with a function, and\n' +
        'the forward throws when the provider has none (D-97.3).\n' +
        'Make the method required, or ask a question the provider can always answer — the\n' +
        'freshness guarantee `listForEntityFresh` replaced `publishInvalidate?` with is the\n' +
        'worked example.\n',
    );
    for (const finding of result.findings) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.typeName}.${finding.member}?() ` +
          `[${finding.kind}, port ${finding.portName}]`,
      );
    }
  }

  if (result.nameFindings.length > 0) {
    console.error(
      "\nA published port's doc block names a container that is not the registration\n" +
        '(port-publication.md §1.2). The name is what a consumer copies into\n' +
        "`lazyPort<T>(ctx, 'thatName')`, and nothing else in the tree checks it: an\n" +
        'unregistered name fails at first call, and a name that resolves to the ungated\n' +
        'legacy service does not fail at all — it hands the class across with no\n' +
        '`MODULE_DISABLED` gate, and `tsc` is satisfied by the structural match.\n' +
        'Correct the doc block, or register the name it gives.\n',
    );
    for (const finding of result.nameFindings) {
      const target =
        finding.registered === null
          ? 'registered by nothing'
          : `registered as \`${finding.registered}\``;
      const documented =
        finding.documentedRegistrationKind === null
          ? 'nothing registers it'
          : `that name is a ${finding.documentedRegistrationKind} registration`;
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.portName} documents ` +
          `\`${finding.documented}\` — ${documented}; the port is ${target} ` +
          `[${finding.kind}]`,
      );
    }
  }

  if (result.unpublishedResolutions.length > 0) {
    console.error(
      '\nA module resolves, cross-module, a container name **no contract publishes**\n' +
        '(D-98.2). The name is the whole of the promise a port makes — `lazyPort<T>` is\n' +
        '`new Proxy({} as T, …)`, so `T` is asserted and nothing compares it to what is\n' +
        'registered. A consumer that copies the owner\'s *class* registration instead of\n' +
        'its published port therefore compiles, and receives the entity.\n' +
        'Either the owner publishes the name — a contract type with a `Container name:`\n' +
        'doc block — or the consumer resolves the published name instead. Both are\n' +
        'ordinary repairs; a ledger entry is for a name that cannot be published, and it\n' +
        'has to say why and what retires it.\n',
    );
    for (const finding of result.unpublishedResolutions) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.moduleId} resolves ` +
          `\`${finding.name}\`, registered by \`${finding.owner}\` and published by no ` +
          `contract [${finding.kind}]`,
      );
    }
  }

  if (result.staleUnpublishedResolutions.length > 0) {
    console.error(
      '\nA `RESOLUTIONS_OF_UNPUBLISHED_NAMES` entry no longer describes the tree: the\n' +
        'site has gone, or the name it resolves is published now. Delete the entry — a\n' +
        'draining ledger that keeps its drained entries stops being a measurement.\n',
    );
    for (const key of result.staleUnpublishedResolutions) console.error(`  - ${key}`);
  }

  if (result.staleLedgerEntries.length > 0) {
    console.error(
      '\nA `PORTS_WITHOUT_A_REGISTRATION` entry no longer describes the tree: the port has\n' +
        'gained a registration, or it is no longer published. Delete the entry.\n',
    );
    for (const portName of result.staleLedgerEntries) console.error(`  - ${portName}`);
  }

  if (result.declaredElsewhere.length > 0) {
    console.error(
      '\nAn interface one module declares is registered by another, which names it at no\n' +
        '`implements` clause (D-171.1). Declaring a port on the consumer side is licensed\n' +
        'only against that condition: `lazyPort<T>` is an unchecked cast and verifies\n' +
        'nothing, so everything `tsc` checks happens on the provider — TS2420 at the\n' +
        '`implements` clause, TS2345 at the explicitly typed `providePort<T>`, whose\n' +
        '`Registration<T> = Resolver<T>` puts `T` in return position. With neither, the\n' +
        'only relation between the two types is the cast, which is D-77`s rejected\n' +
        'alternative and stays refused.\n' +
        'Add the `implements` clause to the class the provider registers.\n',
    );
    for (const finding of result.declaredElsewhere) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.portName} is declared by ` +
          `\`${finding.declaringModule}\` and registered as \`${finding.container}\` by ` +
          `\`${finding.providingModule}\`, which implements it nowhere [${finding.kind}]`,
      );
    }
  }

  process.exit(violations > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
