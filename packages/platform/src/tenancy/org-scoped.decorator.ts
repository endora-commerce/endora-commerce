import { Filter } from '@mikro-orm/core';
import { ORG_FILTER, CUSTOMER_FILTER, orgFilterCond, customerFilterCond } from './filters.js';

/**
 * Per-entity tenant-scope classification (feature 050, FR-006).
 *
 * Exactly one decorator MUST be applied to every persisted entity. `@OrgScoped`
 * and `@CustomerScoped` also attach a default-on MikroORM global filter, so the
 * data-layer guard applies automatically. The other three record classification
 * only (enforcement is via `derived-scope.ts` or, for globals, none).
 *
 * The `check-entity-tenant-classification.ts` CI check reads the source to prove
 * the classification is total; the runtime registry here supports introspection
 * and tests.
 */

export type ScopeClass = 'org' | 'customer' | 'global' | 'transitive' | 'rule';

// A class constructor; `unknown[]` args keep the decorator usable on any entity.
type EntityClass = new (...args: never[]) => object;

export interface ClassificationMeta {
  readonly target: EntityClass;
  readonly className: string;
  readonly scope: ScopeClass;
  /** Tenant-key column for `org` / `customer`. */
  readonly key?: string;
  /**
   * Parent-aggregate class name + FK for `transitive` — see
   * {@link TransitivelyScoped} for why the parent is a name and not a class.
   */
  readonly parentClassName?: string;
  readonly fk?: string;
}

const registry: ClassificationMeta[] = [];

/** All classified entities registered at import time. */
export function tenantClassifications(): readonly ClassificationMeta[] {
  return registry;
}

function applyMikroFilter(
  target: EntityClass,
  name: string,
  cond: () => Record<string, unknown>,
): void {
  // MikroORM's `Filter` is a class decorator; apply it programmatically.
  // `args: false` — the cond reads the ambient context from AsyncLocalStorage at
  // query time, so no per-fork `setFilterParams` is needed (fork-independent).
  (Filter({ name, cond: () => cond(), default: true, args: false }) as (t: EntityClass) => void)(target);
}

/** Direct `organizationId` column. Filtered by the `org` global filter. */
export function OrgScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'org', key: 'organizationId' });
    applyMikroFilter(target, ORG_FILTER, orgFilterCond);
  };
}

/** Direct `customerAccountId` column, no org column. Filtered by the `customerAccount` filter. */
export function CustomerScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'customer', key: 'customerAccountId' });
    applyMikroFilter(target, CUSTOMER_FILTER, customerFilterCond);
  };
}

/** Platform-global, exempt from all tenant filters. */
export function GlobalEntity(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'global' });
  };
}

/**
 * Scoped through a parent aggregate's org (e.g. Invoice → Order). No own column.
 *
 * **The parent is named by its class name, not by the class** (feature 080,
 * T049; ruling D-169). Both of this platform's transitive chains cross a module
 * boundary — `Invoice` → `Order` and `KsefSubmission` → `Invoice` — and D-168
 * says a module that has become a package publishes an `entities` array and no
 * named entity class, so the symbol the old `() => Order` thunk closed over is
 * one the child cannot import. Those two lines were the whole reason `invoices`
 * and `ksef` could not be packaged. Nothing else in the tree took the thunk
 * form, so there is one form and not two (Constitution IV).
 *
 * **Why the class name and not the table name.** {@link ClassificationMeta}
 * already keys every row by `className`, so the lookup needs no second index
 * and no per-module token registry; MikroORM refuses two entities sharing a
 * class name at discovery (`MetadataValidator`), so the name is a
 * platform-wide unique key the ORM already enforces rather than an assumption
 * written down here; and no reader of this registry — `filters.ts`,
 * `derived-scope.ts`, `kernel/scope.ts`, `check-entity-tenant-classification`
 * — asks for a table. Resolving a table name would mean re-deriving it through
 * the naming strategy or reading `MetadataStorage`, which is only populated
 * after ORM discovery, i.e. later than the moment this has to answer.
 *
 * The name is resolved lazily by {@link resolveTransitiveParent}: entity
 * classes register in import order and a child is routinely imported before its
 * parent, so resolving here would refuse a chain that is perfectly good.
 */
export function TransitivelyScoped(
  parentClassName: string,
  fk: string,
): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'transitive', parentClassName, fk });
  };
}

/**
 * A `@TransitivelyScoped` chain from which no tenant can be read.
 *
 * It is an error and never a fallback. A transitively scoped entity carries no
 * tenant column of its own, so an unresolved parent leaves it reachable with no
 * tenant predicate at all — Principle XI (non-negotiable) defeated by a silence,
 * which is exactly the failure mode a name-addressed parent would otherwise
 * introduce. Resolution therefore has two outcomes and no third: the one
 * classified entity carrying that name, or this.
 *
 * **It is also the error for a chain that resolves at every step and grounds
 * nowhere** (D-170): a `global` or `rule` terminus, a cycle, and a run of
 * transitives reaching no keyed classification. **One error class, deliberately.**
 * A caller can do nothing different about "your parent does not exist" and "your
 * parent has no tenant to give you" — both are boot failures with the same
 * remedy, a decorator to open — and a second class would invite a `catch` that
 * distinguishes them, which is the beginning of a degraded mode. The degraded
 * mode is an untenanted read.
 */
export class UnresolvableTenantParentError extends Error {
  constructor(detail: string) {
    super(`Unresolvable @TransitivelyScoped parent — ${detail}`);
    this.name = 'UnresolvableTenantParentError';
  }
}

/**
 * Why `child`'s parent does not resolve, or `null` when it does.
 *
 * Shared by the single resolution and the whole-registry reconciliation so the
 * two cannot come to disagree about what "resolves" means — and so neither has
 * to `catch` the other's throw.
 */
function describeChild(child: ClassificationMeta): string {
  return `${child.className} (fk '${child.fk ?? '?'}')`;
}

function transitiveParentIssue(child: ClassificationMeta): string | null {
  const where = describeChild(child);
  if (child.scope !== 'transitive' || child.parentClassName === undefined) {
    return `${where} is classified '${child.scope}' and names no transitive parent`;
  }
  const matches = registry.filter((meta) => meta.className === child.parentClassName);
  if (matches.length === 1) return null;
  if (matches.length === 0) {
    return (
      `${where} is scoped through '${child.parentClassName}', and no classified entity of ` +
      'that name is registered in this platform. Either the parent entity is not part of ' +
      'this composition — check the owning module is installed and that this module ' +
      'declares it in its manifest `dependencies` — or the name in the decorator is wrong.'
    );
  }
  return (
    `${where} is scoped through '${child.parentClassName}', and ${matches.length} classified ` +
    'entities carry that class name. A class name is the platform-wide key here, so an ' +
    'ambiguous one is refused rather than resolved to whichever registered first.'
  );
}

/**
 * The classification of `child`'s parent aggregate, resolved by class name.
 *
 * Lazy and order-independent by construction: it reads the registry when it is
 * called, never when the decorator ran. Throws {@link UnresolvableTenantParentError}
 * — see that class for why there is no other outcome.
 */
export function resolveTransitiveParent(child: ClassificationMeta): ClassificationMeta {
  const issue = transitiveParentIssue(child);
  if (issue !== null) throw new UnresolvableTenantParentError(issue);
  return registry.find((meta) => meta.className === child.parentClassName) as ClassificationMeta;
}

/** The outcome of walking one chain from a transitive child to wherever it ends. */
interface ChainWalk {
  /** Class names from the child to the last hop reached, in order. */
  readonly path: readonly string[];
  /** The classification the chain grounds at, when it grounds at one. */
  readonly terminus?: ClassificationMeta;
  /** Why the chain is refused, or `null` when it grounds. */
  readonly issue: string | null;
}

/** `A -> B -> C`, the shape every message below spells a chain in. */
function pathText(path: readonly string[]): string {
  return path.join(' -> ');
}

/**
 * Walk `child`'s chain of parents to a classification that carries a tenant key.
 *
 * **The rule is `parent.key !== undefined`** (D-170), true for exactly `org` and
 * `customer` — {@link ClassificationMeta} already encodes it, so nothing new is
 * stored and the two cannot come to disagree.
 *
 * Checking the *immediate* parent, which is what this used to do, leaves three
 * silences that are all the same failure with a different number of steps: a
 * `global` terminus, a cycle (`A -> B -> A` resolves at every step and grounds
 * nowhere), and a run of transitives reaching no keyed classification. In each
 * of them the entity is reachable with no tenant predicate anywhere on the path.
 *
 * **No depth limit.** The repeated-name guard is what terminates the walk — a
 * chain with no cycle is finite because the registry is — and a legitimate deep
 * chain is not wrong for being deep.
 */
function walkTenancyChain(child: ClassificationMeta): ChainWalk {
  const path: string[] = [child.className];
  const seen = new Set<string>([child.className]);
  let current = child;
  for (;;) {
    const issue = transitiveParentIssue(current);
    if (issue !== null) {
      // Beyond the first hop the broken decorator is somebody else's — and that
      // entity is transitive too, so it reports the same issue under its own
      // name. This one has to say which chain of its own brought it there.
      return {
        path,
        issue:
          current === child
            ? issue
            : `${describeChild(child)} is scoped through ${pathText(path)}, and that chain breaks: ${issue}`,
      };
    }
    const parent = registry.find(
      (meta) => meta.className === current.parentClassName,
    ) as ClassificationMeta;
    path.push(parent.className);
    if (seen.has(parent.className)) {
      return {
        path,
        issue:
          `${describeChild(child)} is scoped through ${pathText(path)}, which is a cycle. ` +
          'It resolves at every step and grounds nowhere, so no tenant predicate is ' +
          'reachable from it. One of the entities in the cycle owns the tenant and should ' +
          "carry a column for it — '@OrgScoped' or '@CustomerScoped' — rather than pointing " +
          'at the next.',
      };
    }
    seen.add(parent.className);
    if (parent.scope === 'transitive') {
      current = parent;
      continue;
    }
    if (parent.key !== undefined) return { path, terminus: parent, issue: null };
    if (parent.scope === 'rule') {
      return {
        path,
        issue:
          `${describeChild(child)} is scoped through ${pathText(path)}, which terminates at ` +
          `'${parent.className}' — classified 'rule', so it carries no tenant key. A transitive ` +
          'chain gives the child a foreign key and a foreign key cannot evaluate a rule: a ' +
          "rule-scoped entity's org targeting lives in a JSONB rule that 'derived-scope.ts' " +
          'makes the *query* intersect. This refusal retires the day a rule-scoped entity ' +
          "gains a resolved-org projection — that projection is '@OrgScoped', and a chain may " +
          'terminate there.',
      };
    }
    return {
      path,
      issue:
        `${describeChild(child)} is scoped through ${pathText(path)}, which terminates at ` +
        `'${parent.className}' — classified '${parent.scope}', so it carries no tenant key. A ` +
        'transitively scoped entity has no tenant column and no filter of its own, and a ' +
        'global parent has none either, so the chain delivers no tenant predicate anywhere ' +
        'on the path and no reader can recover one (Principle XI). If this entity genuinely ' +
        "has no tenant, classify it '@GlobalEntity' itself.",
    };
  }
}

/** Where the reconciliation's `info` lines go; a `PlatformLogger` satisfies it. */
export interface TenancyChainReporter {
  info(obj: object, msg: string): void;
}

/**
 * The default destination, for a caller that passes none.
 *
 * A real write and never a no-op, for the reason `kernel/logging.ts` gives its
 * own fallback: this runs before `buildServer`, so stdout is what a boot line
 * has. It is duplicated rather than imported because `kernel/logging.ts` reaches
 * `kernel/scope.ts`, which imports this directory — and this file is loaded by
 * every persisted entity class at decoration time, which is no place to drag
 * the container in behind an import cycle.
 *
 * (The ORM's entity decorator is deliberately not spelled out above: the
 * composer generator collects entity classes by a text match over these
 * sources, so writing it here would make this file one.)
 */
const consoleReporter: TenancyChainReporter = {
  // eslint-disable-next-line no-console -- the pre-`buildServer` destination; see above.
  info: (obj, msg) => console.info(obj, msg),
};

/**
 * Reconcile every transitive chain in the registry, and refuse if any is broken.
 *
 * **This is where the refusal lives, and the placement is the decision.** The
 * decorator cannot refuse — a child is routinely decorated before its parent is
 * imported, so an eager check would reject working chains. The *first
 * resolution* cannot be the only refusal either: nothing in this repository
 * resolves a parent on a request path today, so a chain that stopped resolving
 * would sit there unmeasured, which is the silence this exists to remove. So
 * the host reconciles the whole registry once, at the moment it enumerates the
 * entity classes it is about to configure the ORM with
 * (`backend/src/db/configured-entities.ts`) — the first instant at which every
 * classification decorator has run, core and installed package alike, and still
 * before a single query can be issued.
 *
 * It reports **every** broken chain, not the first: an author who renamed an
 * entity wants the whole list in one boot, not one per restart.
 *
 * ## Three outcomes (D-170)
 *
 * Silent for an `org` terminus. **Refused** for `global`, `rule`, a cycle or a
 * run of transitives that grounds nowhere — see {@link walkTenancyChain}.
 * **Accepted with one `info` line** for a `customer` terminus, which is legal
 * because it grounds (a real column, a default-on filter, and `CustomerAccount`
 * is itself `@OrgScoped`, so the customer axis narrows the org axis rather than
 * competing with it) and reported because of a measured circularity:
 * `customerFilterCond()` returns `{ customerAccountId: … }` in `single-org`
 * mode and **`{}` — no predicate at all — in `allowed-set`**, where that file's
 * own comment says an org-scoped admin "cannot be expressed as a
 * customer-account predicate… such rows are reached **via transitive scoping**
 * where needed". A chain terminating there is therefore unfiltered for an
 * org-scoped admin, and the recorded remedy for that is the very mechanism doing
 * the terminating. Worth a line; not worth a throw, since refusing would police
 * a defect the terminus did not cause — the `{}` applies to all customer-scoped
 * entities either way — and would forbid a shape with nowhere else to go, a
 * customer-scoped parent having no `organizationId` column to continue through.
 *
 * The notices are emitted before the refusal rather than instead of it: each
 * chain is judged on its own, and suppressing a true report about one because
 * another is broken would make the line come and go for unrelated reasons.
 */
export function assertTransitiveParentsResolve(
  report: TenancyChainReporter = consoleReporter,
): void {
  const failures: string[] = [];
  const notices: ChainWalk[] = [];
  for (const child of registry.filter((meta) => meta.scope === 'transitive')) {
    const walk = walkTenancyChain(child);
    if (walk.issue !== null) failures.push(walk.issue);
    else if (walk.terminus?.scope === 'customer') notices.push(walk);
  }
  for (const walk of notices) {
    report.info(
      {
        chain: pathText(walk.path),
        terminus: walk.terminus?.className,
        terminusScope: walk.terminus?.scope,
      },
      'tenancy chain terminates at a customer-scoped entity: filtered in `single-org` mode, ' +
        'unfiltered in `allowed-set`, where `customerFilterCond()` returns no predicate for an ' +
        'org-scoped admin',
    );
  }
  if (failures.length === 0) return;
  throw new UnresolvableTenantParentError(
    `${failures.length} tenancy chain(s) do not reach a tenant:\n  - ${failures.join('\n  - ')}`,
  );
}

/** Org targeting lives in a rule (e.g. price_lists `applicationRule`), not a column. */
export function RuleScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'rule' });
  };
}
