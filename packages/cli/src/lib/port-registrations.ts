/**
 * Container registrations and port resolutions, read out of TypeScript sources
 * through the compiler API.
 *
 * `check:port-dependencies` and `check:port-shape` both have to answer the same
 * three questions of a module's sources — *which names does it register*, *which
 * ports does it provide* and *which names does it resolve* — and one of those two
 * rules now has two hosts (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6: `backend/scripts/check-port-shape.ts` over this repository, `endora check`
 * over one module package). A predicate three callers share has to live where
 * all three can reach it, which is the package.
 *
 * Everything here is **syntactic only**, deliberately. Whether a name is owned,
 * whether an edge is declared and whether a capture is allowed are questions
 * about a *composition*, and they stay with the checks that know what a
 * composition is: this file says only what a source text spells.
 *
 * Attribution keys on `/src/apps/<deployment>/modules/<id>/`, then on
 * `/src/modules/<id>/`, then on `lib/module-population.ts`' `moduleIdOf` — the
 * same segment reader the population floor uses, with the `hostResident` map for
 * a module whose sources the host owns. A file the walk reads and cannot name is
 * a file every consumer here judges as nobody's and reports clean about, which
 * is issue #215's failure one layer in.
 */
import ts from 'typescript';

import {
  moduleIdOf,
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from './module-population.js';

/**
 * Stand-in recorded when a `lazyPort` name is not a string literal. It is owned
 * by nobody on purpose, so it surfaces as an `unowned-name` violation naming the
 * file and line — the same way a genuinely unregistered name does.
 */
export const NON_LITERAL_PORT_NAME = '<computed>';

/**
 * *When* a resolution happens, which is what the gated-port rule below keys on
 * (feature 072, D-39).
 *
 * `kind` answers "once or per call"; this answers "before or after the platform
 * serves its first request". They are independent — a boot-hook read is
 * genuinely deferred and still fatal — and only this one sees the failure that
 * took the backend down twice:
 *
 *  - `boot` — lexically inside a `ctx.onBoot` hook. `runBootHooks()` does not
 *    consult module presence, so the hook runs whatever the module's effective
 *    state is.
 *  - `wiring` — the body of the `ctx.routes` callback itself. It runs inside
 *    `buildServer`, unconditionally: `defineModuleRoutes` gates *requests*, not
 *    the registration. A read inside a handler is not this — that is `call`.
 *  - `call` — everything else: a request handler, a subscriber, a worker
 *    processor, a method on a service.
 */
export type ResolutionSite = 'boot' | 'wiring' | 'call';

export interface PortResolution {
  readonly moduleId: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  /**
   * How the name is read, which is the whole point of the capture rule below.
   *
   *  - `captured` — destructured from a factory's cradle parameter, so Awilix
   *    resolves it once, when the registration is first constructed.
   *  - `deferred` — read through `ctx.cradle<C>()`, so it resolves at the
   *    moment of use.
   */
  readonly kind: 'captured' | 'deferred';
  /** See {@link ResolutionSite}. */
  readonly site: ResolutionSite;
  /**
   * **Which seam the name was written into**, which is a different question
   * from `kind` and from `site` and is the one `check-port-shape`'s third
   * signal keys on (issue #196, D-98.2).
   *
   *  - `lazyPort` — `lazyPort<T>(ctx, 'name')`, the shape a module uses to
   *    reach a *published* port. The name is a literal a developer copied out
   *    of a contract's doc block, which is exactly why it is checkable against
   *    one.
   *  - `cradle` — every other shape this function reads: a factory's cradle
   *    parameter, `ctx.cradle<C>()`, a module-local alias of either. Those are
   *    **contribution seams**, where a module reads a name a composition root
   *    or the kernel supplies, and where naming a published contract would be
   *    the wrong requirement — four of the five names the two populations
   *    disagree on are of that kind.
   *
   * Recorded here rather than re-derived by the consumer so that "this
   * resolution is a `lazyPort`" is decided in the one place that already
   * decides it. A predicate that exists twice can go half-missing while the
   * check still prints `violations=0`.
   */
  readonly via: 'lazyPort' | 'cradle';
}

/**
 * The owning module id of a source file, over every root a module can live in.
 *
 * Three shapes, in order. The two anchored regexes answer for the application's
 * own trees — a deployment overlay first, then the core module tree — and both
 * key on `/src/`, so they say nothing about a module that has become a
 * **package** (feature 080, T040a). The third is `lib/module-population.ts`'
 * `moduleIdOf`, the same segment reader the population floor uses, and it is
 * what makes a path like `packages/modules/blog/src/services/x.ts` attribute to
 * `blog` instead of to nobody.
 *
 * That fallback is not cosmetic. Without it a package's files are read by the
 * walk, satisfy the floor, and are then attributed to `null` — which for every
 * consumer here means *not a module*, so the check judges none of them and
 * reports clean. That is issue #215's failure one layer in, and it is why
 * `resolveModuleLayout` refuses a package root whose location the segment
 * reader cannot attribute rather than letting it through unnamed.
 *
 * The fourth answer is `hostResident`, the map the layout derives from the
 * manifest index for a module whose sources the host owns and whose directory
 * therefore carries no `modules/<id>/` segment (feature 080, T040b). It is
 * threaded from `main` rather than left to default, for exactly the reason the
 * third shape exists: a file the walk reads and cannot name is a file this
 * check judges as nobody's and reports clean about.
 */
export function moduleOf(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return moduleIdOf(file, hostResident);
}

/** `ctx.di.register` → `di.register`; used to match on the tail, not the receiver name. */
export function calleeTail(node: ts.CallExpression): string {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return '';
  const inner = expression.expression;
  const prefix = ts.isPropertyAccessExpression(inner) ? `${inner.name.text}.` : '';
  return `${prefix}${expression.name.text}`;
}

/** Every registration name a module claims: `di.register` keys plus `di.providePort`. */
export function registeredNames(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const tail = calleeTail(node);
      const [first] = node.arguments;
      if (tail === 'di.register' && first && ts.isObjectLiteralExpression(first)) {
        for (const property of first.properties) {
          if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
          else if (property.name && ts.isStringLiteral(property.name)) names.push(property.name.text);
        }
      }
      if (tail === 'di.providePort' && first && ts.isStringLiteral(first)) {
        names.push(first.text);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/**
 * The names a module registers as **gated ports** (`di.providePort`), which is
 * the subset a composition root must never re-register.
 *
 * The distinction is the whole of the shadowing rule below. `di.register` is
 * how a module declares a *contribution point* — a name it defaults, expecting
 * a root that has something better to override it — so a root registering one
 * of those is the design working. `di.providePort` wraps the resolver in the
 * presence gate, and a root registration replaces the gate with a plain value.
 */
export function providedPortNames(source: string, file: string): string[] {
  return providedPorts(source, file).map((port) => port.name);
}

/** One `ctx.di.providePort<T>('name', …)` call, with the contract it names. */
export interface ProvidedPort {
  /** The container name, always a string literal (a computed one is skipped). */
  readonly name: string;
  /**
   * The published contract the registration is checked against, when the call
   * carries a type argument. `null` for the 53 that do not — those compare
   * nothing (Phase-P unreached-port audit, A12).
   */
  readonly typeName: string | null;
  readonly line: number;
}

/**
 * Every gated registration a file makes, with its type argument.
 *
 * The single expression of "this call is a `providePort`" in the tree.
 * `providedPortNames` above and `check-port-shape`'s container-name signal both
 * come through here rather than each writing the predicate again: a check whose
 * decision exists in two places can go half-missing without its red proof
 * noticing, which is how `check:nul-bytes` kept printing `violations=0` with its
 * rule mutated.
 */
export function providedPorts(source: string, file: string): ProvidedPort[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ports: ProvidedPort[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeTail(node) === 'di.providePort') {
      const [first] = node.arguments;
      if (first && ts.isStringLiteral(first)) {
        const [typeArgument] = node.typeArguments ?? [];
        ports.push({
          name: first.text,
          typeName:
            typeArgument && ts.isTypeReferenceNode(typeArgument) &&
            ts.isIdentifier(typeArgument.typeName)
              ? typeArgument.typeName.text
              : null,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return ports;
}

type FunctionLike =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Is `node` the first argument of a `ctx.<seam>(…)` call? */
function isCallbackOf(seam: string, node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isCallExpression(parent) &&
    calleeTail(parent) === seam &&
    parent.arguments[0] === node
  );
}

/**
 * Where in the module's lifecycle this read happens — see {@link ResolutionSite}.
 *
 * `boot` is lexical and deliberately wide: `lazyPort` defers to the method
 * call, and inside a boot hook that call is two lines down. All seven
 * `emailDefaultsPort` contributors had exactly that shape, and every one of
 * them would have failed the boot had the port stayed gated.
 *
 * `wiring` is narrow on purpose: only the `ctx.routes` callback's own body,
 * because that is what runs during `buildServer`. Anything nested one function
 * deeper — a route handler, an `onRequest` hook, a preHandler — runs per
 * request, where a gate is exactly what should be asked.
 */
export function siteAt(node: ts.Node): ResolutionSite {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (isCallbackOf('onBoot', current)) return 'boot';
  }
  let enclosing: ts.Node | undefined = node.parent;
  while (enclosing && !isFunctionLike(enclosing)) enclosing = enclosing.parent;
  if (enclosing && isCallbackOf('routes', enclosing)) return 'wiring';
  return 'call';
}

/**
 * How a local name that stands for the container cradle is read back.
 *
 *  - `object` — the cradle itself: `const cradle = ctx.cradle<C>()`, or the
 *    first parameter of an `asFunction` factory, which Awilix *is* the cradle.
 *    Reads are written `cradle.name`.
 *  - `accessor` — a zero-argument function returning the cradle:
 *    `const cradle = (): C => ctx.cradle<C>()`. Reads are written
 *    `cradle().name`.
 *
 * Both defer the actual resolution to the property access — the cradle is a
 * proxy, and it resolves a name when that name is read — so the read's own
 * position decides {@link PortResolution.kind} and {@link ResolutionSite}, the
 * same way an inline `ctx.cradle<C>().name` does.
 */
type CradleAliasKind = 'object' | 'accessor';

interface CradleAlias {
  readonly kind: CradleAliasKind;
  /**
   * The node the alias is visible inside. Scoped rather than file-wide on
   * purpose: `cradle` is a common local name, and a flat table would read an
   * unrelated `cradle.x` in another function as a container resolution.
   */
  readonly scope: ts.Node;
}

/** Is this the container-cradle accessor, `ctx.cradle<C>()`? */
function isCradleCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && calleeTail(node).endsWith('cradle');
}

/** The expression a zero-argument function returns, if it returns exactly one. */
function soleReturnedExpression(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Node | null {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return fn.body;
  if (!ts.isBlock(fn.body)) return null;
  const [statement, ...rest] = fn.body.statements;
  if (rest.length > 0 || statement === undefined || !ts.isReturnStatement(statement)) return null;
  return statement.expression ?? null;
}

/**
 * Every local name that stands for the container cradle, with the scope it is
 * visible in.
 *
 * The check used to see two shapes only — a destructured factory parameter and
 * `ctx.cradle<C>()` read inline — and a module that bound the cradle to a local
 * first resolved everything it wanted unseen (issue #90). Nine modules had the
 * object form and six the accessor form, and among them were gated ports read
 * in a `ctx.routes` body: exactly what the wiring rule below exists to refuse.
 */
function collectCradleAliases(sf: ts.SourceFile): Map<string, CradleAlias[]> {
  const aliases = new Map<string, CradleAlias[]>();
  const add = (name: string, alias: CradleAlias): void => {
    const existing = aliases.get(name);
    if (existing) existing.push(alias);
    else aliases.set(name, [alias]);
  };
  /** The block (or file) a `const` is visible in. */
  const blockOf = (node: ts.Node): ts.Node => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (ts.isBlock(current) || ts.isSourceFile(current)) return current;
    }
    return sf;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer;
      const scope = blockOf(node);
      if (isCradleCall(initializer)) {
        add(node.name.text, { kind: 'object', scope });
      } else if (
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        initializer.parameters.length === 0
      ) {
        const returned = soleReturnedExpression(initializer);
        if (returned !== null && isCradleCall(returned)) {
          add(node.name.text, { kind: 'accessor', scope });
        }
      }
    }
    // A factory's first parameter *is* the cradle — that is how Awilix calls
    // it — so a named one resolves exactly as a destructured one does. The
    // destructured form was already read; this is the same seam written with a
    // name, and `delivery_methods` and `payment_methods` use it.
    if (ts.isCallExpression(node) && calleeTail(node).endsWith('asFunction')) {
      const [factory] = node.arguments;
      if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
        const [parameter] = factory.parameters;
        if (parameter && ts.isIdentifier(parameter.name)) {
          add(parameter.name.text, { kind: 'object', scope: factory });
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return aliases;
}

/** Is `node` inside `scope` (or `scope` itself)? */
function isWithin(node: ts.Node, scope: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (current === scope) return true;
  }
  return false;
}

/**
 * Every registration name a module resolves.
 *
 * Three shapes, because those are the ones the kernel offers: the cradle
 * parameter of a factory (`ctx.asFunction(({ a, b }: C) => …)`, destructured or
 * named), the deferred surface (`ctx.cradle<C>()`) read by destructuring or by
 * property access, and either of those bound to a local first — see
 * {@link collectCradleAliases}.
 *
 * **Each shape is read both ways round.** The alias and the destructuring are
 * independent axes, and the check used to see only five of their six
 * combinations: `cradle().a` yes, `const { a } = ctx.cradle<C>()` yes,
 * `const { a } = cradle()` no. That last one is what `catalog`'s
 * asset-reference boot hook is written as, so its two reads were invisible
 * until issue #127 — the eighth time this scanner's *reach*, rather than the
 * rules under it, turned out to be the defect.
 */
export function resolvedNames(
  source: string,
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): PortResolution[] {
  const moduleId = moduleOf(file, hostResident);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: PortResolution[] = [];
  const cradleAliases = collectCradleAliases(sf);

  const record = (
    name: string,
    node: ts.Node,
    kind: PortResolution['kind'],
    site: ResolutionSite = siteAt(node),
    via: PortResolution['via'] = 'cradle',
  ): void => {
    found.push({
      moduleId,
      name,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      site,
      via,
    });
  };

  const recordBindingPattern = (
    pattern: ts.ObjectBindingPattern,
    kind: PortResolution['kind'],
  ): void => {
    for (const element of pattern.elements) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property)) record(property.text, element, kind);
    }
  };

  /**
   * Is this `ctx.cradle()` call evaluated when the registration is built, or
   * when somebody uses it?
   *
   * Walk out to the nearest enclosing function. If that function is the factory
   * handed to `asFunction`, the call runs at construction — a capture. If any
   * other function sits in between (a method, a route registrar, a subscriber
   * handler, an arrow passed to a service), the call runs when that function
   * does — a genuine deferral.
   */
  const readKindAt = (node: ts.Node): PortResolution['kind'] => {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current)
      ) {
        const owner = current.parent;
        const isFactoryOfAsFunction =
          owner !== undefined &&
          ts.isCallExpression(owner) &&
          calleeTail(owner).endsWith('asFunction') &&
          owner.arguments[0] === current;
        return isFactoryOfAsFunction ? 'captured' : 'deferred';
      }
      current = current.parent;
    }
    return 'deferred';
  };

  /**
   * The cradle a read is written against, if the receiver is a local alias
   * visible here — `cradle.x` for an `object` alias, `cradle().x` for an
   * `accessor` one. Innermost declaration wins, so a shadowed name is read in
   * the scope that declared it.
   */
  const aliasReceiverOf = (receiver: ts.Node): CradleAlias | null => {
    const named =
      ts.isIdentifier(receiver) && cradleAliases.has(receiver.text)
        ? { name: receiver.text, wanted: 'object' as CradleAliasKind }
        : ts.isCallExpression(receiver) &&
            receiver.arguments.length === 0 &&
            ts.isIdentifier(receiver.expression) &&
            cradleAliases.has(receiver.expression.text)
          ? { name: receiver.expression.text, wanted: 'accessor' as CradleAliasKind }
          : null;
    if (named === null) return null;
    const candidates = (cradleAliases.get(named.name) ?? []).filter(
      (alias) => alias.kind === named.wanted && isWithin(receiver, alias.scope),
    );
    return candidates.at(-1) ?? null;
  };

  const visit = (node: ts.Node): void => {
    // A read off a local cradle alias. The alias itself resolves nothing — the
    // cradle is a proxy — so the property access is the resolution, and its own
    // position decides both the kind and the site.
    if (ts.isPropertyAccessExpression(node) && aliasReceiverOf(node.expression) !== null) {
      record(node.name.text, node, readKindAt(node));
    } else if (ts.isElementAccessExpression(node) && aliasReceiverOf(node.expression) !== null) {
      // Same rule as `lazyPort`: a literal is a name this check can verify, and
      // anything else must surface rather than pass.
      const argument = node.argumentExpression;
      const name = ts.isStringLiteralLike(argument) ? argument.text : NON_LITERAL_PORT_NAME;
      record(name, node, readKindAt(node));
    }

    // The same alias, destructured instead of read a name at a time:
    // `const { a, b } = cradle()` for an accessor alias, `const { a } = cradle`
    // for an object one. The check saw each half — `cradle().a`, and
    // `const { a } = ctx.cradle<C>()` written inline — and not the two combined,
    // so `catalog`'s asset-reference boot hook resolved two names invisibly
    // (issue #127). The destructuring *is* the resolution, exactly as the
    // property access is, so its own position decides the kind and the site.
    //
    // Keyed on the alias table rather than on the shape, which is what keeps the
    // widening from swallowing the tree: `const { rows } = await list()` is the
    // commonest line in `src/` and resolves nothing. And the receiver must be
    // the alias itself — `const { x } = cradle().service` destructures a
    // *resolved value*, whose fields are not container names.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      aliasReceiverOf(node.initializer) !== null
    ) {
      recordBindingPattern(node.name, readKindAt(node.initializer));
    }

    if (ts.isCallExpression(node)) {
      const tail = calleeTail(node);

      // A factory's cradle parameter.
      if (tail.endsWith('asFunction')) {
        const [factory] = node.arguments;
        if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
          const [parameter] = factory.parameters;
          if (parameter && ts.isObjectBindingPattern(parameter.name)) {
            recordBindingPattern(parameter.name, 'captured');
          }
        }
      }

      // The resolution surface — deferred *only* when the read happens inside a
      // nested function. `ctx.cradle<C>().thing` written straight into a
      // factory body looks deferred and is not: the body runs when Awilix first
      // constructs the registration, so the read is every bit as eager as a
      // destructured parameter. `addresses` had exactly that, and it survived
      // until `dictionaries` turned the name it read into a port.
      if (tail.endsWith('cradle')) {
        const kind = readKindAt(node);
        const parent = node.parent;
        if (parent && ts.isPropertyAccessExpression(parent)) {
          record(parent.name.text, parent, kind);
        } else if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          ts.isObjectBindingPattern(parent.name)
        ) {
          recordBindingPattern(parent.name, kind);
        }
      }

      // `lazyPort<T>(ctx, 'name')` — the shape the conversions were told to
      // prefer, and the one this check could not see until feature 072 wave 3.
      // Every read through it went unchecked: `pim_ergonode` resolved fourteen
      // names this way, several registered by nobody, and the check reported a
      // clean bill while the media pipeline produced no assets.
      //
      // Always `deferred`: the proxy resolves the name on each method call, not
      // when it is constructed. That is the whole point of the helper, and it
      // is why capturing one is safe where capturing a port is not.
      //
      // The same reasoning decides the **site**, and it is why a `lazyPort` is
      // not read positionally like a cradle access. Building one in a
      // `ctx.routes` body resolves nothing — that is the sanctioned fix for the
      // wiring hazard, not an instance of it, so it is a `call`. Building one
      // in a boot hook is different in kind: the whole hook body is pre-request,
      // so the method call it defers to happens at boot too, usually on the next
      // line. All seven `emailDefaultsPort` contributors were exactly that.
      const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : tail;
      if (calleeName === 'lazyPort') {
        const [, nameArgument] = node.arguments;
        const lazySite: ResolutionSite = siteAt(node) === 'boot' ? 'boot' : 'call';
        if (nameArgument !== undefined) {
          if (ts.isStringLiteralLike(nameArgument)) {
            record(nameArgument.text, nameArgument, 'deferred', lazySite, 'lazyPort');
          } else {
            // A name this check cannot read statically must not pass silently.
            // A generic `port(ctx, name)` helper written during T131 hid twelve
            // resolutions behind a variable; the fix is to refuse the shape,
            // not to guess at it.
            record(NON_LITERAL_PORT_NAME, nameArgument, 'deferred', lazySite, 'lazyPort');
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * Every registration name a **composition root** writes into the container.
 *
 * A different spelling from {@link registeredNames} and that is the whole reason
 * it exists: a module writes `ctx.di.register({ … })`, and a root writes
 * `registerValues(container, { … })`, `container.register({ … })` or
 * `composedModules.contribute({ … })` — D-45's contribution window as a method
 * (issue #52). Missing the third would drop nearly every name a root supplies.
 *
 * ## Why the CLI needs it
 *
 * `specs/110-instance-repository/` T138a. The divergence report's second host is
 * a client's instance, where `composeApp` **is** the composition root and comes
 * out of `node_modules`, and `registration-owners.ts`' `rootSuppliedNames` is
 * what tells *"a root registers it"* from *"nobody registers it"*. Its own doc
 * block says what happens without it, and it was measured happening: an overlay
 * module decorating `commandBus` in a real scaffolded instance was reported
 * `unowned-subject` — a finding about the run dressed as one about the tree —
 * because the platform registers it in a root spelling this file did not read.
 *
 * ## It is a **second copy**, knowingly, and here is the whole of that decision
 *
 * `backend/scripts/check-port-dependencies.ts` exports a `rootRegisteredNames`
 * this one is taken from, unchanged. Two derivations of one predicate is the
 * shape this estate refuses, so the copy is **not** the end state: that file's
 * should become an import of this one, which is a one-line change and is
 * deliberately not made in the merge request that adds this, feature 117's
 * Phase 6 holding that file open at the time. Until it is,
 * `backend/test/unit/scripts/check-divergence.test.ts` holds the two to each
 * other over the shapes a root really writes — a divergence between them is red
 * rather than silent, which is what a duplicated predicate otherwise costs.
 *
 * Spread elements are ignored: a name that only exists inside a spread is not a
 * name this analysis can reason about.
 */
export function rootRegisteredNames(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const collect = (literal: ts.ObjectLiteralExpression): void => {
    for (const property of literal.properties) {
      if (!property.name) continue;
      if (ts.isIdentifier(property.name)) names.push(property.name.text);
      else if (ts.isStringLiteral(property.name)) names.push(property.name.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : calleeTail(node);
      if (callee === 'registerValues') {
        const [, second] = node.arguments;
        if (second && ts.isObjectLiteralExpression(second)) collect(second);
      }
      if (
        callee === 'container.register' ||
        callee === 'register' ||
        callee === 'contribute' ||
        callee.endsWith('.contribute')
      ) {
        const [first] = node.arguments;
        if (first && ts.isObjectLiteralExpression(first)) collect(first);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}
