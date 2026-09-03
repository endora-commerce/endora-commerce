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
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). `backend/scripts/check-port-shape.ts` hosts it over this repository's
 * contracts sources, module walk roots and `./ports` subpaths, and holds both
 * ledgers and the two platform-name sets: each is a statement about *this*
 * composition and none of them travels. `endora check` hosts it over one module
 * package, where the ledgers and the platform sets are empty and signal 3 is
 * declared unevaluated — it asks whether a module resolves a container name no
 * contract publishes, which needs the published surface of every installed peer.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import {
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';
import {
  moduleOf,
  providedPorts,
  registeredNames,
  resolvedNames,
} from '../lib/port-registrations.js';

/** The line every port's doc block carries, and the only marker that finds one. */
/**
 * The doc-block marker that makes an interface a published port
 * (`contracts/port-shape.md` §1.2). Exported because both hosts read it: the
 * marker is part of the rule, not of a host.
 */
export const PORT_DOC_MARKER = 'Container name:';

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
 * `lazyPort<…>(ctx, '<literal>')` in `src/modules/**` and `src/apps

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
  /** The ledger answering for a port with no provider; absent means `{}`. */
  readonly unregisteredLedger?: Readonly<Record<string, string>>;
  /**
   * The ledger answering for signal 3; absent means `{}`, and a fixture
   * overrides it so a red proof over the stale direction does not have to
   * disturb the real one.
   */
  readonly unpublishedResolutionLedger?: Readonly<Record<string, string>>;
  /**
   * Names a **composition root or the kernel** supplies, which signal 3 skips:
   * neither has a contracts file to publish from. Supplied by the host rather
   * than read here, because which names a platform reserves is a fact about a
   * composition and this file says only what a source text spells.
   */
  readonly platformOwnedNames?: ReadonlySet<string>;
  /** Ports a composition root still bridges on their owner's behalf. Same reason. */
  readonly hostRegisteredPorts?: Readonly<Record<string, string>>;
  /**
   * Directories whose files belong to a module no `modules/<id>/` segment names
   * — `lib/module-roots.ts`' `hostResidentModules` (feature 080, T040b).
   * Without it a host-resident module's registrations are owned by nobody, and
   * signal 3 cannot tell its self-resolutions from cross-module ones.
   */
  readonly hostResidentModules?: HostResidentModules;
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
function moduleOfKey(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): string | null {
  return moduleOf(forOwnerLookup(file), hostResident);
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
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
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
    modulePortCount += collect(file, text, moduleOfKey(file, hostResident), (sf) =>
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
        const owner = moduleOfKey(file, hostResident);
        if (owner !== null) gatedModuleOfType.set(port.typeName, owner);
      }
    }
  }
  for (const [file, sf] of moduleScan) {
    const owner = moduleOfKey(file, hostResident);
    if (owner === null) continue;
    for (const name of implementedNames(sf)) {
      const claimed = implementsByModule.get(owner);
      if (claimed) claimed.add(name);
      else implementsByModule.set(owner, new Set([name]));
    }
  }

  const ledger = input.unregisteredLedger ?? {};
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
    const moduleId = moduleOf(lookupKey, hostResident);
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

  const resolutionLedger = input.unpublishedResolutionLedger ?? {};
  const platformOwnedNames = input.platformOwnedNames ?? new Set<string>();
  const hostRegisteredPorts = input.hostRegisteredPorts ?? {};
  const unpublishedResolutions: UnpublishedResolutionFinding[] = [];
  const resolutionLedgerHits = new Set<string>();

  for (const resolution of lazyResolutions) {
    // Platform names are supplied by a composition root or the kernel, neither
    // of which has a contracts file to publish from; `HOST_REGISTERED_PORTS`
    // is the same fact for a port a root still bridges on its owner's behalf.
    if (platformOwnedNames.has(resolution.name)) continue;
    if (hostRegisteredPorts[resolution.name] !== undefined) continue;
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

/**
 * Every TypeScript source under `dir`, with the rule's own prunes applied.
 *
 * Exported because the population is part of the rule: two hosts computing
 * "which files this check reads" two ways is the shape that lets one of them go
 * half-blind.
 */
export function collectPortShapeSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectPortShapeSources(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}
