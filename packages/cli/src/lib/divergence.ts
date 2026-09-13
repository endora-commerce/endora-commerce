/**
 * The deployment divergence report — the derivation, the seam classification and
 * the findings (`specs/107-override-report-and-ladder/contracts/divergence-report.md`).
 *
 * ## Why this is in the package, and not in either application
 *
 * The walk is the TypeScript compiler API over a deployment's own overlay tree.
 * It was `backend/scripts/lib/divergence.ts` until
 * `specs/110-instance-repository/` T138a, which no client can reach: a scaffolded
 * instance has an `apps/<deployment>/` tree of its very own — that is what
 * `instance-tree.md` §2.2 writes it for — and no way whatever to render a report
 * over it. That is `docs-artefacts.ts`' story one artefact family over, and
 * R3.5's answer is the same one: *"one generator, one derivation … never a
 * second implementation"*, with the **population** as the parameter.
 *
 * It stayed out of `backend/src/**` for a reason that has not changed:
 * `typescript` is a devDependency and `backend/src/**` is compiled into the
 * production image (D-165), so an analysis imported from there would make the
 * compiler a runtime dependency of every instance. The package has the compiler
 * as a declared `dependency` and is a `devDependency` of the instance, which is
 * where an analysis of a tree belongs.
 *
 * ## Everything in here is pure over its input, and that is what made the move a
 * relocation
 *
 * {@link deriveDivergence} takes the deployment's sources, the route table, the
 * owner map, the declaration and `ModuleContext`'s members. Not one of the five
 * is walked for here. The two hosts differ only in how each is assembled —
 * `backend/scripts/generate-divergence.ts` from this repository's module layout,
 * platform sources and composition roots, `generate/divergence.ts` from the
 * packages an instance installed — and `divergence-artefacts.ts` is where the
 * assembly the two share lives.
 *
 * ## The one absolute rule
 *
 * Every subject is read as a **literal**: a string literal, a template literal
 * with no substitution, an object-literal property name, or a file-local `const`
 * bound to one of those. A subject the analysis cannot resolve is a **finding**,
 * never a skip (FR-016, issue #113).
 *
 * That rule matters more here than anywhere else in the estate, and the reason
 * is measurable: the overlay population in this repository is two modules and
 * one decoration. A walk that silently skipped what it could not read would
 * print `entries=1` over a deployment with fifty, and nothing else in the tree
 * would notice.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 *  - a seam call inside a helper the overlay module imports from **outside**
 *    its own directory. The population is the deployment's own overlay tree
 *    (§3.1), so a `ctx` handed to a function in `admin/` or in a core module is
 *    not read. It is also not a shape a deployment can reach: an overlay module
 *    may not name a file in another module's directory
 *    (`check:module-boundary`), and a helper of the deployment's own lives
 *    inside the overlay module;
 *  - a `ModuleContext` reached through a value the analysis cannot type — the
 *    receiver must be an identifier the file declares with the annotation
 *    `ModuleContext`, which is how every `registerModule` in the tree is
 *    written. A receiver it cannot place contributes no site, and refusal 3
 *    ("no seam call of any kind read") is what stops that from becoming a clean
 *    report over a tree full of them;
 *  - a queue name a worker takes from a value built at run time. `ctx.worker`
 *    takes a **constructed** `Worker`, so the name is read from the
 *    `new Worker('<literal>', …)` the call wraps, directly or through a
 *    file-local binding. Anything else is `computed-subject`.
 */
import { realpathSync } from 'node:fs';

import ts from 'typescript';

import type {
  DivergenceBoundary,
  DivergenceDetail,
  DivergenceEntry,
  DivergenceKind,
  DivergenceReport,
} from '@endora-commerce/contracts';

// ---------------------------------------------------------------------------
// 1. The seam classification — every `ModuleContext` member has exactly one home
// ---------------------------------------------------------------------------

/**
 * What one `ModuleContext` member is, from the ladder's point of view.
 *
 *  - `divergence` — the member produces a report entry of `kind`, on `rung`.
 *  - `own-surface` — the member exists and is a module acting on its **own**
 *    surface, so it is not a divergence from core. `why` is what
 *    {@link DivergenceBoundary.notRecorded} renders.
 *  - `not-a-seam` — a builder or an accessor. `asClass` constructs a
 *    registration; it does not register one.
 */
export type SeamClassification =
  | { readonly verdict: 'divergence'; readonly kind: DivergenceKind; readonly rung: number | null }
  | { readonly verdict: 'own-surface'; readonly why: string }
  | { readonly verdict: 'not-a-seam'; readonly why: string };

/**
 * The rung table, keyed by `ModuleContext`'s own member spelling.
 *
 * **The population is not this map** — it is the members the platform's source
 * declares, read by {@link moduleContextSeams}. A member this map does not name
 * is the `unclassified-seam` finding, which is what stops the eleventh seam
 * arriving unclassified the way `rootPlugin` did.
 *
 * The three `rung: null` entries are the ladder's own table's three `—` rows
 * (`escalation-ladder.md` §2, `data-model.md` §2.3): a registration and a worker
 * are a module contributing its own surface to the container and to the queue,
 * and the ladder ranks ways of changing what **core** does. They are recorded
 * because a deployment adding either is a way its tree differs from core; they
 * carry no rung because there is no cost to core in them.
 */
export const SEAM_CLASSIFICATION: Readonly<Record<string, SeamClassification>> = {
  'di.register': { verdict: 'divergence', kind: 'registration', rung: null },
  'di.providePort': { verdict: 'divergence', kind: 'port-provided', rung: 3 },
  'di.decorate': { verdict: 'divergence', kind: 'decoration', rung: 4 },
  subscribe: { verdict: 'divergence', kind: 'subscription', rung: 1 },
  interceptors: { verdict: 'divergence', kind: 'interceptor', rung: 2 },
  rootPlugin: { verdict: 'divergence', kind: 'root-plugin', rung: 4 },
  worker: { verdict: 'divergence', kind: 'worker', rung: null },

  routes: {
    verdict: 'own-surface',
    why: 'a route an overlay module registers is its own route, gated on its own module — not a change to what core serves',
  },
  ungatedRoutes: {
    verdict: 'own-surface',
    why: "the module's own route, outside the module's own gate; the reason string is required at the call and is read there, and it removes no other module's gate",
  },
  onBoot: {
    verdict: 'own-surface',
    why: "the module's own boot hook, run inside its own system scope; it contributes nothing another module resolves",
  },

  module: { verdict: 'not-a-seam', why: 'the module identity the context was built for' },
  asClass: { verdict: 'not-a-seam', why: 'a registration builder — it constructs a registration, it does not register one' },
  asFunction: { verdict: 'not-a-seam', why: 'a registration builder' },
  asValue: { verdict: 'not-a-seam', why: 'a registration builder' },
  cradle: {
    verdict: 'not-a-seam',
    why: 'the deferred resolution surface; a cross-module read through it is recorded as `port-consumed` from the `lazyPort` call that spells the name',
  },
  log: { verdict: 'not-a-seam', why: "the platform's logger, bound to this module" },
};

/**
 * The `ModuleContext` members the platform's source declares — the population
 * the table above is held against.
 *
 * Read from source text so a fixture enters at the top of the analysis, and read
 * as the interface's own members rather than as a list: `di`'s three methods are
 * returned dotted (`di.register`), because that is how {@link calleeTailOf}
 * spells a call on them and a check whose two halves spell one thing differently
 * cannot reconcile them.
 */
export function moduleContextSeams(source: string): string[] {
  const sf = ts.createSourceFile('module-context.ts', source, ts.ScriptTarget.Latest, true);
  const members: string[] = [];

  const nameOf = (member: ts.TypeElement): string | null =>
    member.name !== undefined && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
      ? member.name.text
      : null;

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'ModuleContext') {
      for (const member of node.members) {
        const name = nameOf(member);
        if (name === null) continue;
        // `di` is a property whose type is an inline object literal of three
        // **methods**, and its members are the seams — so it contributes them
        // and never itself.
        //
        // The expansion is keyed on the members being callable, not on the type
        // being a literal: `module` is also an inline object literal, of two
        // `string` properties, and expanding it would report `ctx.module.id` and
        // `ctx.module.version` as seams the ladder does not classify. A property
        // is a fact the context carries; a method is something a module *does*.
        const type = ts.isPropertySignature(member) ? member.type : undefined;
        if (type !== undefined && ts.isTypeLiteralNode(type)) {
          const callable = type.members.filter(
            (inner) => ts.isMethodSignature(inner) && nameOf(inner) !== null,
          );
          if (callable.length > 0) {
            for (const inner of callable) members.push(`${name}.${nameOf(inner) ?? ''}`);
            continue;
          }
        }
        members.push(name);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return members;
}

// ---------------------------------------------------------------------------
// 2. The walk
// ---------------------------------------------------------------------------

/** One source the walk read, keyed the way the report keys it. */
export interface OverlaySource {
  /** The overlay module that owns the file. */
  readonly moduleId: string;
  /** Repo-relative path, POSIX separators — for a message a reader can act on. */
  readonly file: string;
  readonly text: string;
}

/** One seam call the walk found, resolved or not. */
export interface SeamSite {
  readonly moduleId: string;
  readonly file: string;
  readonly line: number;
  /** The `ModuleContext` member spelling — `di.decorate`, `interceptors`, … */
  readonly seam: string;
  /** The call as written, truncated — so a `computed-subject` names the call. */
  readonly text: string;
  /**
   * The literal subject, or `null` when the analysis could not resolve one.
   * `null` is the `computed-subject` finding and never a skip.
   */
  readonly subject: string | null;
  /** Kind-specific facts, where the kind has any. */
  readonly interceptor?: {
    readonly phase: 'pre' | 'post';
    readonly order: number;
    readonly id: string;
  };
  readonly declaredReason?: string;
}

/** `ctx.di.register` → `di.register`; `ctx.subscribe` → `subscribe`. */
export function calleeTailOf(node: ts.CallExpression): string {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return '';
  const inner = expression.expression;
  const prefix = ts.isPropertyAccessExpression(inner) ? `${inner.name.text}.` : '';
  return `${prefix}${expression.name.text}`;
}

/** The identifier a seam call is written on, or `null`. */
function receiverOf(node: ts.CallExpression): ts.Identifier | null {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const inner = expression.expression;
  if (ts.isIdentifier(inner)) return inner;
  if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression)) {
    return inner.expression;
  }
  return null;
}

/**
 * The identifiers this file declares as a `ModuleContext`.
 *
 * A parameter annotation is how every `registerModule` in the tree is written,
 * and a `const` annotation is how a test writes one. Both are read; anything
 * else is a receiver the analysis cannot place, and refusal 3 is what keeps that
 * from reading as "this deployment uses no seam".
 */
function contextBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const declaresContext = (type: ts.TypeNode | undefined): boolean =>
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'ModuleContext';

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && declaresContext(node.type)) {
      names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      declaresContext(node.type)
    ) {
      names.add(node.name.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/** File-local `const x = '<literal>'` bindings, for a subject written once above. */
function literalBindings(sf: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const literal = plainLiteral(node.initializer);
      if (literal !== null) bindings.set(node.name.text, literal);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bindings;
}

/** A string literal or a template with no substitution; nothing else. */
function plainLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** A literal, or a file-local `const` that is one. Never a computation. */
function resolveSubject(
  node: ts.Node | undefined,
  bindings: ReadonlyMap<string, string>,
): string | null {
  if (node === undefined) return null;
  const literal = plainLiteral(node);
  if (literal !== null) return literal;
  if (ts.isIdentifier(node)) return bindings.get(node.text) ?? null;
  return null;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

/** The queue name a `new Worker('<name>', …)` names, directly or one hop back. */
function queueNameOf(
  argument: ts.Node | undefined,
  bindings: ReadonlyMap<string, string>,
  workers: ReadonlyMap<string, string>,
): string | null {
  if (argument === undefined) return null;
  if (ts.isNewExpression(argument)) {
    return resolveSubject(argument.arguments?.[0], bindings);
  }
  if (ts.isIdentifier(argument)) return workers.get(argument.text) ?? null;
  return null;
}

/** File-local `const w = new Worker('<name>', …)` bindings. */
function workerBindings(sf: ts.SourceFile, bindings: ReadonlyMap<string, string>): Map<string, string> {
  const workers = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isNewExpression(node.initializer)
    ) {
      const name = resolveSubject(node.initializer.arguments?.[0], bindings);
      if (name !== null) workers.set(node.name.text, name);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return workers;
}

const CALL_TEXT_LIMIT = 120;

function callText(node: ts.Node, sf: ts.SourceFile): string {
  const text = node.getText(sf).replace(/\s+/g, ' ');
  return text.length > CALL_TEXT_LIMIT ? `${text.slice(0, CALL_TEXT_LIMIT)}…` : text;
}

/**
 * Every seam call in one deployment's overlay tree.
 *
 * The fixture enters here as source text, which is the top of this analysis:
 * every classification below — the receiver, the seam spelling, the literal
 * resolution — runs over it.
 */
export function deriveSeamSites(sources: readonly OverlaySource[]): SeamSite[] {
  const sites: SeamSite[] = [];

  for (const source of sources) {
    const sf = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true);
    const contexts = contextBindings(sf);
    const bindings = literalBindings(sf);
    const workers = workerBindings(sf, bindings);
    const lineOf = (node: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const push = (node: ts.Node, seam: string, rest: Omit<SeamSite, 'moduleId' | 'file' | 'line' | 'seam' | 'text'>): void => {
      sites.push({
        moduleId: source.moduleId,
        file: source.file,
        line: lineOf(node),
        seam,
        text: callText(node, sf),
        ...rest,
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        // `lazyPort<T>(ctx, 'name')` — a helper over the cradle rather than a
        // `ModuleContext` member, and the only kind that records a module
        // *reaching* rather than *contributing*.
        if (ts.isIdentifier(node.expression) && node.expression.text === 'lazyPort') {
          push(node, 'lazyPort', { subject: resolveSubject(node.arguments[1], bindings) });
        }

        const receiver = receiverOf(node);
        if (receiver !== null && contexts.has(receiver.text)) {
          const seam = calleeTailOf(node);
          const [first, second] = node.arguments;
          switch (seam) {
            case 'di.register': {
              if (first !== undefined && ts.isObjectLiteralExpression(first)) {
                for (const property of first.properties) {
                  const name =
                    property.name !== undefined &&
                    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                      ? property.name.text
                      : null;
                  push(property, seam, { subject: name });
                }
                // An empty object literal is a call that registers nothing; it
                // is still a site, so the run's `sites` count matches the calls
                // it examined.
                if (first.properties.length === 0) push(node, seam, { subject: null });
              } else {
                push(node, seam, { subject: null });
              }
              break;
            }
            case 'di.providePort':
            case 'di.decorate':
            case 'subscribe': {
              push(node, seam, { subject: resolveSubject(first, bindings) });
              break;
            }
            case 'rootPlugin': {
              const reason = resolveSubject(first, bindings);
              push(node, seam, {
                subject: reason,
                ...(reason === null ? {} : { declaredReason: reason }),
              });
              break;
            }
            case 'worker': {
              push(node, seam, { subject: queueNameOf(first, bindings, workers) });
              break;
            }
            case 'interceptors': {
              if (first !== undefined && ts.isArrayLiteralExpression(first)) {
                for (const element of first.elements) {
                  if (!ts.isObjectLiteralExpression(element)) {
                    push(element, seam, { subject: null });
                    continue;
                  }
                  const target = resolveSubject(propertyOf(element, 'target'), bindings);
                  const phaseText = resolveSubject(propertyOf(element, 'phase'), bindings);
                  const idText = resolveSubject(propertyOf(element, 'id'), bindings);
                  const orderNode = propertyOf(element, 'order');
                  const order =
                    orderNode !== undefined && ts.isNumericLiteral(orderNode)
                      ? Number(orderNode.text)
                      : 0;
                  // `phase` and `id` are required by the registration type, so a
                  // missing one is a `tsc` error rather than this check's
                  // business; an unreadable one makes the whole entry a
                  // `computed-subject`, because its key carries the phase.
                  if (target === null || phaseText === null || idText === null) {
                    push(element, seam, { subject: null });
                    continue;
                  }
                  push(element, seam, {
                    subject: target,
                    interceptor: {
                      phase: phaseText === 'post' ? 'post' : 'pre',
                      order,
                      id: idText,
                    },
                  });
                }
                if (first.elements.length === 0) push(node, seam, { subject: null });
              } else {
                push(node, seam, { subject: null });
              }
              break;
            }
            default: {
              // `routes`, `ungatedRoutes`, `onBoot`, the builders and `cradle`
              // are classified `own-surface` / `not-a-seam` above; they are
              // deliberately not sites, because a site is a divergence
              // candidate and those are not.
              if (second !== undefined) break;
              break;
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  return sites;
}

/** One source the route sweep reads, with the module it belongs to. */
export interface RouteSource {
  readonly file: string;
  readonly text: string;
  /** The module that registers what this file registers, or `null`. */
  readonly moduleId: string | null;
}

/**
 * "Has this population already got this file?" — the guard that keeps a file two
 * roots both reach from entering the population twice.
 *
 * The environment this check builds is a **union** of several walks, and two of
 * them legitimately overlap: a module walk root can sit *inside* the platform's
 * source root, in which case that module's files are reached once as the
 * module's and once as the platform's. `files` is then the size of a multiset
 * rather than of a population, and it is the one instrument this estate has for
 * spotting a walk that has gone blind — a number wrong for a reason nobody knows
 * is worse than a number that is missing.
 *
 * Three properties, each of them the design and not a detail.
 *
 *  - **By real path, never by the spelling.** Two roots reaching one file reach
 *    it under two path strings whenever either root is a symlink, and a string
 *    comparison would let both through — which is the case a `git worktree` and
 *    a linked `node_modules` both produce.
 *  - **First claim wins**, so the *narrower* walk's attribution survives: the
 *    passes run most-specific first, and a file inside a module is that module's
 *    however wide a root also covers it. `routeIdentities` already resolves the
 *    same contest the same way for a route it sees twice.
 *  - **It is not keyed on any package, root or name.** The next pair of roots
 *    that overlaps for some other reason is handled by this same guard, because
 *    what it knows about is a file it has already been given.
 *
 * A path `realPathOf` cannot resolve — a file deleted between the walk and the
 * read — falls back to the spelling rather than throwing: this guard's job is to
 * collapse a duplicate, and refusing a run is the caller's decision to take.
 */
export function claimFileOnce(
  realPathOf: (file: string) => string = (file) => realpathSync.native(file),
): (file: string) => boolean {
  const claimed = new Set<string>();
  return (file: string): boolean => {
    // The fallback lives here rather than inside the default resolver so that it
    // holds for an injected one too: the guarantee is the guard's, and a resolver
    // that throws must not take out a walk that has already read the file.
    let key: string;
    try {
      key = realPathOf(file);
    } catch {
      key = file;
    }
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  };
}

/**
 * Every `"<METHOD> <path>"` a route registration in the composition serves, and
 * the module that owns it.
 *
 * `ctx.interceptors`' target is that identity, and the registry accepts one no
 * route matches **silently** — the interceptor simply never runs. So the report
 * reconciles the two, which is the `unmatched-interceptor-target` finding, and
 * the same sweep answers the entry's `owner`: an intercepted endpoint's owner is
 * the module that registered the route, not the module that registered a
 * container name of the same spelling.
 *
 * Deliberately not `check:action-route-permissions`' `findAdminRoutes`: that one
 * filters to `/api/v1/admin/**`, and an interceptor may target any endpoint any
 * module owns.
 */
export function routeIdentities(sources: Iterable<RouteSource>): Map<string, string | null> {
  const identities = new Map<string, string | null>();
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

  const claim = (identity: string, moduleId: string | null): void => {
    // First registration wins, and a named owner beats an unnamed one: a route
    // registered inside a module is that module's, whatever a later file in the
    // application's own tree spells.
    const known = identities.get(identity);
    if (known === undefined || (known === null && moduleId !== null)) {
      identities.set(identity, moduleId);
    }
  };

  for (const source of sources) {
    if (!source.text.includes('/api/')) continue;
    const sf = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true);
    const bindings = literalBindings(sf);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        methods.has(node.expression.name.text)
      ) {
        const path = resolveSubject(node.arguments[0], bindings);
        if (path !== null && path.startsWith('/')) {
          const method = node.expression.name.text.toUpperCase();
          const verbs =
            method === 'ALL'
              ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
              : [method];
          for (const verb of verbs) claim(`${verb} ${path}`, source.moduleId);
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return identities;
}

// ---------------------------------------------------------------------------
// 3. The findings
// ---------------------------------------------------------------------------

export type DivergenceFindingKind =
  /** A subject the analysis cannot resolve to a literal (FR-016). */
  | 'computed-subject'
  /** A decorated or consumed name no module in the composition registers. */
  | 'unowned-subject'
  /** An interceptor target no route registration matches. */
  | 'unmatched-interceptor-target'
  /** A derived entry with no reason in the deployment's declaration. */
  | 'undeclared-divergence'
  /** A reason keyed to no derived entry. */
  | 'stale-reason'
  /** A `ModuleContext` member no rung classifies (FR-031). */
  | 'unclassified-seam'
  /** An order entry naming a registration no two overlay modules decorate. */
  | 'stale-decoration-order'
  /** An order entry naming a module that is not one of this deployment's. */
  | 'foreign-order-member'
  /** An order entry naming fewer modules than decorate that name. */
  | 'incomplete-order';

export interface DivergenceFinding {
  readonly kind: DivergenceFindingKind;
  readonly deployment: string;
  /** Repo-relative, or the declaration's own path; never a line-keyed identity. */
  readonly where: string;
  readonly detail: string;
}

/** What each finding means and what to do about it. */
export const DIVERGENCE_REMEDIES: Readonly<Record<DivergenceFindingKind, string>> = {
  'computed-subject':
    'A seam subject — a decoration name, an interceptor target, an event, a port, a queue or a\n' +
    'registration key — is not a literal, so the report cannot say what this deployment changed.\n' +
    'Reading it as "no divergence" is the direction that agrees with the defect (issue #113), so it\n' +
    'is a finding. Write the subject as a string literal, or as a `const` in the same file.',
  'unowned-subject':
    'The name this deployment decorates or consumes is registered by no module in the composition.\n' +
    'Composition throws for it at boot; this is the same refusal in a better place — the merge\n' +
    'request that wrote it. Check the spelling against the owner module’s `ctx.di.register` /\n' +
    '`ctx.di.providePort` call, or the port’s doc block, which names its container name.',
  'unmatched-interceptor-target':
    'An interceptor names an endpoint identity no route registration matches. The registry accepts\n' +
    'it silently — the interceptor simply never runs — so nothing else in the platform would tell\n' +
    'you. The identity is `"<METHOD> <route pattern>"`, the pattern exactly as the owner registers\n' +
    'it (`/api/v1/orders/:id`, not `/api/v1/orders/123`).',
  'undeclared-divergence':
    'This deployment diverges from core here and its declaration says nothing about it. Add the\n' +
    'entry’s key to `reasons` in `backend/src/apps/<deployment>/divergence.ts`, with a sentence\n' +
    'naming what core does and what this deployment does instead — "we do not need it" is not a\n' +
    'reason (D-101).',
  'stale-reason':
    'A reason describes a divergence the tree no longer holds. That is how a deployment silently\n' +
    'reacquires a hazard it once declared (D-101’s own reasoning, applied to a wider subject).\n' +
    'Delete the key, or restore the divergence it describes.',
  'unclassified-seam':
    '`ModuleContext` declares a member the escalation ladder does not classify. Every seam has\n' +
    'exactly one rung, one `own-surface` reason or one `not-a-seam` reason\n' +
    '(`contracts/escalation-ladder.md` §3.1), and a member with none would be a way to diverge that\n' +
    'the report cannot see. Classify it in `SEAM_CLASSIFICATION` and give the ladder its rung.',
  'stale-decoration-order':
    'A `decorationOrder` entry names a registration that no two of this deployment’s overlay\n' +
    'modules decorate. It changes nothing today and will describe the wrong thing the next time a\n' +
    'decoration is added — which is how a deployment silently reacquires an ambiguity it resolved.',
  'foreign-order-member':
    'A `decorationOrder` entry names a module that is not one of this deployment’s overlay modules.\n' +
    'Only an overlay module may decorate a name it does not own (D-156.4), so there is no ordering\n' +
    'this entry can resolve — the composer would ignore it.',
  'incomplete-order':
    'A `decorationOrder` entry names fewer modules than decorate that registration. A partial order\n' +
    'refuses the composition at boot (`AmbiguousDecorationError`) rather than ordering it, so the\n' +
    'entry reads as a decision and behaves as a comment.',
};

/**
 * What the report does not cover, with a reason each (FR-018).
 *
 * `hostNotRecorded` is how a **host** states its own narrowing, and it is the
 * whole answer to the question T138a had to settle: this repository derives the
 * owner map from module *sources* and from a bridging table its composition
 * roots carry, and a client's instance has neither. The kinds are identical —
 * all nine are derived from the deployment's own overlay tree, which is the one
 * population the two hosts share exactly — but the **attribution** differs, and
 * a report that was silently narrower would be worse than no report at all,
 * because a deployment's divergence is exactly the thing a client is asked to
 * trust. So the sentences go in the artefact, in the field FR-018 already has
 * for making silence readable, rather than into a release note nobody reads
 * beside the report. This repository passes none and its six committed
 * artefacts are byte-identical.
 */
export function divergenceBoundary(
  classification: Readonly<Record<string, SeamClassification>> = SEAM_CLASSIFICATION,
  hostNotRecorded: ReadonlyArray<{ readonly seam: string; readonly why: string }> = [],
): DivergenceBoundary {
  const recorded = [
    ...new Set(
      Object.values(classification)
        .filter((entry): entry is Extract<SeamClassification, { verdict: 'divergence' }> =>
          entry.verdict === 'divergence',
        )
        .map((entry) => entry.kind),
    ),
  ];
  // `port-consumed` is a kind with no `ModuleContext` member — it comes from
  // `lazyPort` over the cradle — and `omission` comes from the declaration and
  // from no seam at all. Both are recorded, so both are named here.
  for (const kind of ['port-consumed', 'omission'] as const) {
    if (!recorded.includes(kind)) recorded.push(kind);
  }
  recorded.sort();

  const notRecorded = Object.entries(classification)
    .filter((entry): entry is [string, Extract<SeamClassification, { verdict: 'own-surface' }>] =>
      entry[1].verdict === 'own-surface',
    )
    .map(([seam, entry]) => ({ seam: `ctx.${seam}`, why: entry.why }))
    .sort((a, b) => a.seam.localeCompare(b.seam));

  notRecorded.push({
    seam: 'manifest.ts declarations (permissions, palette actions, i18n bundles, CLI commands)',
    why: 'each is a module declaring its own surface, and each is already swept by the instrument that owns it — the permission inventory, the bundle-shape test, the action-route check',
  });

  // Appended rather than merged into the sort above: the seam entries are the
  // classification's and are ordered by it, and a host's own narrowing is a
  // different claim — it is about this *run*, not about `ModuleContext`.
  notRecorded.push(...hostNotRecorded);

  return {
    recorded,
    notRecorded,
    runtimeOnly: [
      {
        fact: "an installed extension package's interceptors and subscriptions",
        why: 'a package is discovered at run time and ships compiled output; what it registers is a fact about a process, not about this tree. An installed package cannot decorate at all (D-156.3), which is what keeps the highest-value seam inside this artefact',
      },
      {
        fact: "the operator's activation choices",
        why: 'presence is the conjunction of two orthogonal axes (Principle XVII), and activation is a Setting in the store. Whether a divergence recorded here is live is the running instance’s answer, and a build-time artefact gating on it would be the shape D-67/D-68 refuse',
      },
      {
        fact: 'whether each decoration applied, and at what depth',
        why: 'depth is a fact about a composition rather than about a tree: which wrap went innermost is what `decorationOrder` and the composer’s emission order decide together. `detail.depth` is `null` here rather than guessed',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. The derivation, as one function
// ---------------------------------------------------------------------------

export interface DivergenceInput {
  /** Deployment name, or `'core'` for the bare-core build. */
  readonly deployment: string;
  /** The overlay root read, repo-relative; `null` for bare core. */
  readonly overlayRoot: string | null;
  /** The overlay module ids this deployment adds, as the directory walk found them. */
  readonly overlayModules: readonly string[];
  /** The deployment's own overlay sources. */
  readonly sources: readonly OverlaySource[];
  /** Every `"<METHOD> <path>"` the composition serves, and who owns it. */
  readonly routes: ReadonlyMap<string, string | null>;
  /** Container name → the module that registers it. A root-supplied name is absent. */
  readonly owners: ReadonlyMap<string, string>;
  /** Names a composition root supplies, which no module owns. */
  readonly rootSupplied: ReadonlySet<string>;
  /** The deployment's declaration. */
  readonly declaration: {
    readonly omittedModules: ReadonlyArray<{ readonly moduleId: string; readonly reason: string }>;
    readonly decorationOrder: Readonly<Record<string, readonly string[]>>;
    readonly reasons: Readonly<Record<string, string>>;
  };
  /** `ModuleContext`'s own members, from the platform's source. */
  readonly seams: readonly string[];
  readonly classification?: Readonly<Record<string, SeamClassification>>;
  /**
   * What **this host** could not derive, each with a reason — see
   * {@link divergenceBoundary}. Empty for this repository.
   */
  readonly hostNotRecorded?: ReadonlyArray<{ readonly seam: string; readonly why: string }>;
}

export interface DivergenceResult {
  readonly report: DivergenceReport;
  readonly findings: readonly DivergenceFinding[];
  /** Every seam call examined, resolved or not — the run's `sites`. */
  readonly sites: readonly SeamSite[];
}

/** `<kind>:<module>:<subject>`, with an interceptor's `#<phase>`. */
export function divergenceKeyOf(entry: {
  kind: DivergenceKind;
  module: string;
  subject: string;
  detail: DivergenceDetail;
}): string {
  const phase = entry.detail.kind === 'interceptor' ? `#${entry.detail.phase}` : '';
  return `${entry.kind}:${entry.module}:${entry.subject}${phase}`;
}

const SEAM_TO_KIND = (
  classification: Readonly<Record<string, SeamClassification>>,
  seam: string,
): DivergenceKind | null => {
  if (seam === 'lazyPort') return 'port-consumed';
  const entry = classification[seam];
  return entry !== undefined && entry.verdict === 'divergence' ? entry.kind : null;
};

const RUNG_OF = (
  classification: Readonly<Record<string, SeamClassification>>,
  seam: string,
): number | null => {
  if (seam === 'lazyPort') return 3;
  const entry = classification[seam];
  return entry !== undefined && entry.verdict === 'divergence' ? entry.rung : null;
};

/**
 * The whole derivation: one report, and every finding it raised producing it.
 *
 * Pure over its input, so a fixture deployment enters at the top of the analysis
 * (issue #130) and the acceptance instrument (SC-008) needs no tree on disk.
 */
export function deriveDivergence(input: DivergenceInput): DivergenceResult {
  const classification = input.classification ?? SEAM_CLASSIFICATION;
  const findings: DivergenceFinding[] = [];
  const overlayModules = [...input.overlayModules].sort();
  const overlaySet = new Set(overlayModules);

  const note = (kind: DivergenceFindingKind, where: string, detail: string): void => {
    findings.push({ kind, deployment: input.deployment, where, detail });
  };

  // FR-031 — every `ModuleContext` member the platform declares has exactly one
  // classification. A member with none is a way to diverge the report cannot
  // see, which is what let `rootPlugin` arrive unclassified.
  for (const seam of input.seams) {
    if (classification[seam] === undefined) {
      note(
        'unclassified-seam',
        'packages/platform/src/kernel/module-context.ts',
        `\`ctx.${seam}\` is a ModuleContext member the escalation ladder does not classify`,
      );
    }
  }

  const sites = deriveSeamSites(input.sources);
  const entries: DivergenceEntry[] = [];

  for (const site of sites) {
    const kind = SEAM_TO_KIND(classification, site.seam);
    // A site whose seam is classified `own-surface` or `not-a-seam` produces no
    // entry by construction — `deriveSeamSites` pushes none for those — so a
    // `null` here is an unclassified member, already reported above.
    if (kind === null) continue;

    if (site.subject === null) {
      note(
        'computed-subject',
        `${site.file}:${site.line}`,
        `\`ctx.${site.seam}\` names a subject the analysis cannot resolve to a literal: ${site.text}`,
      );
      continue;
    }

    const detail = detailFor(kind, site, input.routes);
    if (detail.kind === 'interceptor' && !detail.targetMatched) {
      note(
        'unmatched-interceptor-target',
        `${site.file}:${site.line}`,
        `interceptor '${detail.id}' targets '${site.subject}', which no route registration matches`,
      );
    }

    // Who owns the subject is a per-kind question, because the subjects are not
    // one namespace: a decoration and a port name a **container registration**,
    // an interceptor names an **endpoint**, and a subscription names an
    // **event** — for which the platform publishes no catalogue at all
    // (`escalation-ladder.md` rung 1's stated gap), so its owner is honestly
    // unknown rather than absent.
    let owner: string | null = null;
    if (kind === 'decoration' || kind === 'port-consumed') {
      const registered = input.owners.get(site.subject);
      if (registered === undefined && !input.rootSupplied.has(site.subject)) {
        note(
          'unowned-subject',
          `${site.file}:${site.line}`,
          `'${site.subject}' is registered by no module in the composition`,
        );
        continue;
      }
      owner = registered ?? null;
    } else if (kind === 'interceptor') {
      owner = input.routes.get(site.subject) ?? null;
    } else if (kind === 'subscription') {
      owner = null;
    } else {
      owner = input.owners.get(site.subject) ?? null;
    }

    const key = divergenceKeyOf({ kind, module: site.moduleId, subject: site.subject, detail });
    entries.push({
      key,
      kind,
      module: site.moduleId,
      subject: site.subject,
      owner,
      rung: RUNG_OF(classification, site.seam),
      detail,
      reason: input.declaration.reasons[key] ?? '',
    });
  }

  // The omissions, from the declaration and from no seam at all. They are the
  // one kind the declaration supplies the population for, and it is D-101's
  // ruling that it does: the boot refuses an omission that is not declared, so
  // the declaration and the composed set are already two-way against each other
  // in the place that can see the composed set.
  for (const omission of input.declaration.omittedModules) {
    const detail: DivergenceDetail = { kind: 'omission' };
    entries.push({
      key: divergenceKeyOf({
        kind: 'omission',
        module: 'core',
        subject: omission.moduleId,
        detail,
      }),
      kind: 'omission',
      module: 'core',
      subject: omission.moduleId,
      owner: omission.moduleId,
      rung: null,
      detail,
      reason: omission.reason,
    });
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));

  const declarationPath =
    input.deployment === 'core'
      ? '(no deployment)'
      : `backend/src/apps/${input.deployment}/divergence.ts`;

  // FR-004, both directions. An omission carries its reason inline, so it is
  // never `undeclared-divergence`; every other kind reads the `reasons` map.
  const derivedKeys = new Set(entries.map((entry) => entry.key));
  for (const entry of entries) {
    if (entry.kind === 'omission') continue;
    if (entry.reason.length === 0) {
      note(
        'undeclared-divergence',
        declarationPath,
        `no reason for \`${entry.key}\` — ${describeEntry(entry)}`,
      );
    }
  }
  for (const key of Object.keys(input.declaration.reasons).sort()) {
    if (!derivedKeys.has(key)) {
      note('stale-reason', declarationPath, `\`${key}\` describes no divergence in this tree`);
    }
  }

  // P3's three build-time findings. The other two — an undeclared ambiguity and
  // a declared order that disagrees with the composition — stay at boot, because
  // an ambiguity is a correctness question and a stale entry is not
  // (`deployment-declaration.md` §3.4).
  const decoratorsOf = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.kind !== 'decoration') continue;
    const modules = decoratorsOf.get(entry.subject) ?? new Set<string>();
    modules.add(entry.module);
    decoratorsOf.set(entry.subject, modules);
  }
  for (const [name, declared] of Object.entries(input.declaration.decorationOrder).sort()) {
    const applied = decoratorsOf.get(name) ?? new Set<string>();
    if (applied.size < 2) {
      note(
        'stale-decoration-order',
        declarationPath,
        `\`decorationOrder['${name}']\` orders ${applied.size} decorating module(s); an order resolves an ambiguity between two or more`,
      );
    }
    for (const member of declared) {
      if (!overlaySet.has(member)) {
        note(
          'foreign-order-member',
          declarationPath,
          `\`decorationOrder['${name}']\` names '${member}', which is not one of this deployment's overlay modules`,
        );
      }
    }
    const missing = [...applied].filter((module) => !declared.includes(module)).sort();
    if (applied.size >= 2 && missing.length > 0) {
      note(
        'incomplete-order',
        declarationPath,
        `\`decorationOrder['${name}']\` omits ${missing.map((id) => `'${id}'`).join(', ')}, which also decorate it`,
      );
    }
  }

  findings.sort((a, b) =>
    a.kind === b.kind ? a.where.localeCompare(b.where) : a.kind.localeCompare(b.kind),
  );

  return {
    report: {
      deployment: input.deployment,
      generatedFrom: { overlayRoot: input.overlayRoot },
      overlayModules,
      entries,
      boundary: divergenceBoundary(classification, input.hostNotRecorded ?? []),
    },
    findings,
    sites,
  };
}

function detailFor(
  kind: DivergenceKind,
  site: SeamSite,
  routes: ReadonlyMap<string, string | null>,
): DivergenceDetail {
  switch (kind) {
    case 'decoration':
      return { kind: 'decoration', depth: null };
    case 'interceptor': {
      const facts = site.interceptor ?? { phase: 'pre' as const, order: 0, id: '' };
      return {
        kind: 'interceptor',
        phase: facts.phase,
        order: facts.order,
        id: facts.id,
        targetMatched: site.subject !== null && routes.has(site.subject),
      };
    }
    case 'root-plugin':
      return { kind: 'root-plugin', declaredReason: site.declaredReason ?? '' };
    case 'subscription':
      return { kind: 'subscription' };
    case 'port-provided':
      return { kind: 'port-provided' };
    case 'port-consumed':
      return { kind: 'port-consumed' };
    case 'registration':
      return { kind: 'registration' };
    case 'worker':
      return { kind: 'worker' };
    case 'omission':
      return { kind: 'omission' };
  }
}

/** One sentence naming the divergence, for a finding a reader can act on. */
export function describeEntry(entry: DivergenceEntry): string {
  const owner = entry.owner === null ? 'a composition root' : `'${entry.owner}'`;
  switch (entry.kind) {
    case 'decoration':
      return `'${entry.module}' wraps '${entry.subject}', which ${owner} registers`;
    case 'interceptor':
      return `'${entry.module}' runs ${entry.detail.kind === 'interceptor' ? entry.detail.phase : ''} on '${entry.subject}'`;
    case 'subscription':
      return `'${entry.module}' subscribes to '${entry.subject}'`;
    case 'port-consumed':
      return `'${entry.module}' resolves the port '${entry.subject}', owned by ${owner}`;
    case 'port-provided':
      return `'${entry.module}' publishes the port '${entry.subject}'`;
    case 'registration':
      return `'${entry.module}' registers '${entry.subject}'`;
    case 'root-plugin':
      return `'${entry.module}' mounts a plugin at the server root`;
    case 'worker':
      return `'${entry.module}' consumes the queue '${entry.subject}'`;
    case 'omission':
      return `this deployment does not ship '${entry.subject}'`;
  }
}

// ---------------------------------------------------------------------------
// 5. The refusals
// ---------------------------------------------------------------------------

/**
 * Why this run may not report on a deployment's divergence at all.
 *
 * `contracts/divergence-report.md` §5 lists seven, and **three of them are not
 * here**, deliberately: refusal 2 (a discovered overlay module the walk opened no
 * source for) is the `overlay-modules` coverage the shared read-size reporter
 * refuses as a short walk, refusal 5 (a registered module contributing no source)
 * is `refuseVacuousModulePopulation`, and refusal 7 (a stale or unpairable
 * emitted manifest) is `refuseStaleEmittedArtefacts`. Each of those is a
 * question the estate already answers in one place, and answering it a second
 * time here is two answers waiting to disagree.
 *
 * The four below are this rule's own, and each names an input whose absence would
 * make a predicate vacuously clean. The dangerous silence here is **not** an
 * empty walk: with two overlay modules in this repository, almost every partial
 * failure produces a small number that looks exactly like a small tree.
 *
 * Pure, over the record the check hands in — the top of this analysis — so a red
 * proof enters where a real run enters (issue #130).
 */
export type DivergenceRefusalKind =
  /** §5.1 — the population is gone while the artefacts describing it are not. */
  | 'no-deployment-with-committed-artefact'
  /** §5.3 — the load-bearing one: the resolver stopped recognising a call shape. */
  | 'no-seam-call-read'
  /** §5.4 — an owner map that resolved no name; every subject reads as unowned. */
  | 'no-owner-resolved'
  /** §5.6 — the rung table classifies nothing, so §3.4 passes vacuously. */
  | 'no-seam-classified';

export interface DivergenceRefusal {
  readonly kind: DivergenceRefusalKind;
  readonly message: string;
}

export interface DivergenceRefusalInput {
  /** Deployments discovered under `src/apps/`. */
  readonly deployments: readonly string[];
  /** Committed deployment reports on disk, whatever the walk found. */
  readonly committedDeploymentArtefacts: readonly string[];
  /** Seam calls examined across the whole walk, resolved or not. */
  readonly sites: number;
  /** Does the overlay source text spell a seam call at all? */
  readonly overlaySpellsASeamCall: boolean;
  /** Container names the owner map resolved. */
  readonly ownersResolved: number;
  /** `ModuleContext` members the rung table classifies. */
  readonly seamsClassified: number;
}

export function divergenceRefusal(input: DivergenceRefusalInput): DivergenceRefusal | null {
  if (input.seamsClassified <= 0) {
    return {
      kind: 'no-seam-classified',
      message:
        'the rung table classifies no seam, so every ModuleContext member would pass ' +
        'unclassified and the ladder would rank nothing; refusing to report a vacuous pass',
    };
  }
  if (input.deployments.length === 0 && input.committedDeploymentArtefacts.length > 0) {
    return {
      kind: 'no-deployment-with-committed-artefact',
      message:
        `no deployment on disk under src/apps/, while ` +
        `${input.committedDeploymentArtefacts.length} committed deployment report(s) name ` +
        'one; the population this run judges is gone, not clean',
    };
  }
  if (input.ownersResolved <= 0) {
    return {
      kind: 'no-owner-resolved',
      message:
        'the port→owner map resolved no container name anywhere in the tree, so every ' +
        'decoration and every consumed port would read as owned by nobody — a finding about ' +
        'the run dressed as one about the tree; refusing to report a vacuous pass',
    };
  }
  if (input.sites <= 0 && input.overlaySpellsASeamCall) {
    return {
      kind: 'no-seam-call-read',
      message:
        'no seam call of any kind was read across the overlay walk, while the overlay ' +
        'sources spell one — a resolver that stopped recognising `ctx.di.decorate` prints a ' +
        'clean report over a tree full of decorations; refusing to report a vacuous pass',
    };
  }
  return null;
}
