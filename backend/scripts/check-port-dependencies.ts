/**
 * CI check — a module declares the modules whose ports it resolves
 * (feature 072, T061 / FR-040).
 *
 * The port rule says a module never imports another module's service: it
 * declares the shape it needs and resolves it from the container, and the
 * owning module registers the default. That leaves one thing unchecked, and it
 * is the thing that decides whether the platform is composable: **the resolving
 * module has to declare the owning module in `manifest.dependencies`.** Without
 * that declaration the dependency exists at runtime and nowhere else — the
 * lifecycle cannot fail closed on it, the migration order cannot correct for
 * it, and an operator switching the provider off finds out from a 503 in a
 * module whose manifest says it depends on nothing.
 *
 * Two properties are enforced:
 *
 *   1. Every name a module resolves is owned by *something* — a module, the
 *      kernel, or the platform. A name nobody registers is a wiring bug that
 *      currently surfaces as an `AwilixResolutionError` at boot, in whichever
 *      environment happens to compose that module first.
 *   2. When the owner is another module, that module is in the resolver's
 *      **transitive** `manifest.dependencies` closure — the same closure the
 *      migration ordering and the lifecycle dependency check use.
 *
 * **This is a hard failure, not a report-only ratchet**, and it can be because
 * it only sees modules that actually resolve through the container: the check
 * measures port resolutions, not imports. Research counted 261
 * imported-but-undeclared edges across the tree; this check found **one**
 * (`blog` → `auth`) on its first run, because three modules are converted. A
 * ratchet armed now, while the cost of clearing it is one line, is the only
 * version of this check that survives the sweep — each conversion pays for its
 * own declarations instead of leaving a 261-entry allow-list nobody will ever
 * drain.
 *
 * Static analysis through the TypeScript compiler API. Sits alongside
 * `check-container-imports.ts` and `check-kernel-boundary.ts`.
 *
 * Usage: `tsx scripts/check-port-dependencies.ts [--list]`
 * Exit 0 = every resolved port is declared; exit 1 = at least one is not.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Names the platform registers, owned by no module: the kernel's own
 * registrations and the process-level infrastructure a composition root
 * creates. Resolving one needs no dependency declaration — the kernel is the
 * part every deployment has, and there is no manifest it could be declared in.
 */
export const PLATFORM_OWNED_NAMES: ReadonlySet<string> = new Set([
  'orm',
  'em',
  'emFactory',
  'redis',
  // The one connection ioredis has put into subscriber mode. Process-level
  // infrastructure exactly as `redis` is, and shared for the same reason a
  // process has one of it: a subscriber connection cannot serve commands.
  'redisSubscriber',
  // The connection a module may build a BullMQ *producer* queue on. Process
  // infrastructure exactly as `redis` is, and a separate name from it because
  // "this composition wants no queues" is a statement a root makes — the test
  // harness registers `redis` but must hand out no queue, since one built per
  // `setupBackendServer()` is never closed.
  'moduleQueueRedis',
  'eventBus',
  'commandBus',
  'apiInterceptors',
  'settingsReadPort',
  // The resolved module registry is a composition-root input by nature: which
  // modules a deployment ships is not something a module may decide.
  'resolvedModuleRegistry',
  'auditLogService',
  'commandBus',
  // Who an admin actor is, resolved differently by production and the harness
  // — which is exactly the difference a composition root exists to hold.
  'adminContextResolver',
  // The cross-module configuration-type seam: which types exist is decided by
  // which modules a deployment ships, so the root creates and populates it.
  'configurationTypeRegistry',
  'credentialsSettingsPort',
  // Which channel a global-scope settings read resolves against: the
  // deployment's system-default channel, or its configured fallback. A
  // property of the deployment, not of any module.
  'settingsChannelResolver',
  'salesChannelResolutionPort',
  'salesChannelMembershipPort',
]);

/**
 * Ports a **composition root** still registers on behalf of a module that has
 * not been converted yet. Each entry is a temporary stand-in for a
 * `ctx.di.providePort` call in the owning module's `backend.ts`, and it is
 * deleted by that module's conversion — the check fails if an entry survives
 * its owner's conversion, so the list drains rather than accumulating.
 */
export const HOST_REGISTERED_PORTS: Readonly<Record<string, string>> = {
  // `requireAdmin` and `requireAdminAny` are gone from here: `auth` provides
  // them itself since T078, and the staleness check below fails the build if an
  // entry outlives its owner's conversion.
  //
  dictionaryValidator: 'dictionaries',
  // Registered as `undefined` today: blog ships no storefront ports and both
  // composition roots pass nothing. The name is blog's own.
  blogStorefrontDeps: 'blog',
  // The two resolvers the auth plugin reads per request; their owners are
  // hand-wired and constructed after `auth`, so a root registers them.
  apiKeyResolver: 'api_keys',
  // `dictionaries` owns the validator + cache drop; `currencies` resolves it
  // per write so one CurrencyService can serve both admin surfaces.
  dictionaryInvalidator: 'dictionaries',
  // `_i18n` reads it to serve the per-admin language preference; `admin_users`
  // owns the audited instance and is still hand-wired.
  adminUserService: 'admin_users',
  // The lazy accessor `_i18n` walks to reconcile every module's bundles. The
  // registry does not exist until `_lifecycle` is constructed, which in a root
  // happens after the late pass, so a root supplies the accessor.
  lifecycleManifestRegistry: '_lifecycle',
  // The audited settings write path. `settingsReadPort` is platform-owned
  // because the kernel holds the store (D-32), but the *admin* service is still
  // the `settings` module's, and that module is hand-wired.
  settingsAdminService: 'settings',
  // `auth`'s customer-side guard, still declared inline in each root while the
  // harness runs a separate `requireTestCustomer()` — the divergence T011/T012
  // fixed for `requireAdmin` and never did for this one. Owner is `auth`; the
  // entry goes when the two implementations are unified.
  requireCustomer: 'auth',
  // How a composition names the acting admin on an audit record. Root-shaped
  // by nature — production reads `request.actor`, the harness `request.testActor`
  // — so it is a composition input rather than any module's property.
  adminAuditActorResolver: 'auth',
  // The sales-channel code⇄id lookup. Owned by `sales_channels`, which is still
  // hand-wired (T110); the entry goes when that module converts.
  salesChannelCodeIdPort: 'sales_channels',
};

export interface PortResolution {
  readonly moduleId: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface PortViolation {
  readonly kind: 'undeclared-dependency' | 'unowned-name';
  readonly resolution: PortResolution;
  readonly owner: string | null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The owning module id of a source file, core or overlay. */
export function moduleOf(file: string): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return null;
}

/** `ctx.di.register` → `di.register`; used to match on the tail, not the receiver name. */
function calleeTail(node: ts.CallExpression): string {
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
 * Every registration name a module resolves.
 *
 * Two shapes, because those are the two the kernel offers: the destructured
 * cradle parameter of a factory (`ctx.asFunction(({ a, b }: C) => …)`) and the
 * deferred surface (`ctx.cradle<C>()`), read either by destructuring or by
 * property access.
 */
export function resolvedNames(source: string, file: string): PortResolution[] {
  const moduleId = moduleOf(file);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: PortResolution[] = [];

  const record = (name: string, node: ts.Node): void => {
    found.push({
      moduleId,
      name,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    });
  };

  const recordBindingPattern = (pattern: ts.ObjectBindingPattern): void => {
    for (const element of pattern.elements) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property)) record(property.text, element);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const tail = calleeTail(node);

      // A factory's cradle parameter.
      if (tail.endsWith('asFunction')) {
        const [factory] = node.arguments;
        if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
          const [parameter] = factory.parameters;
          if (parameter && ts.isObjectBindingPattern(parameter.name)) {
            recordBindingPattern(parameter.name);
          }
        }
      }

      // The deferred resolution surface.
      if (tail.endsWith('cradle')) {
        const parent = node.parent;
        if (parent && ts.isPropertyAccessExpression(parent)) {
          record(parent.name.text, parent);
        } else if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          ts.isObjectBindingPattern(parent.name)
        ) {
          recordBindingPattern(parent.name);
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/** Transitive `manifest.dependencies` closure — the closure ordering already uses. */
export function closureOf(
  moduleId: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const stack = [...(dependencies.get(moduleId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || next === moduleId || reachable.has(next)) continue;
    reachable.add(next);
    stack.push(...(dependencies.get(next) ?? []));
  }
  return reachable;
}

export interface CheckInput {
  readonly resolutions: readonly PortResolution[];
  readonly owners: ReadonlyMap<string, string>;
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

export function findViolations(input: CheckInput): PortViolation[] {
  const violations: PortViolation[] = [];
  for (const resolution of input.resolutions) {
    if (PLATFORM_OWNED_NAMES.has(resolution.name)) continue;
    const owner = input.owners.get(resolution.name) ?? null;
    if (owner === null) {
      violations.push({ kind: 'unowned-name', resolution, owner });
      continue;
    }
    if (owner === resolution.moduleId) continue;
    if (closureOf(resolution.moduleId, input.dependencies).has(owner)) continue;
    violations.push({ kind: 'undeclared-dependency', resolution, owner });
  }
  return violations;
}

export function describe(violation: PortViolation, srcRoot = SRC_ROOT): string {
  const { resolution, owner } = violation;
  const where = `${resolution.file.replace(`${srcRoot}/`, 'src/')}:${resolution.line}`;
  if (violation.kind === 'unowned-name') {
    return (
      `  - ${resolution.moduleId} resolves '${resolution.name}' (${where}), which no module ` +
      `registers.\n    Register it in the owning module's backend.ts, or — while that module ` +
      `is still hand-wired — declare its owner in HOST_REGISTERED_PORTS in this script.`
    );
  }
  return (
    `  - ${resolution.moduleId} resolves '${resolution.name}' (${where}), owned by ` +
    `'${owner}', which it does not declare.\n    Add '${owner}' to \`dependencies\` in ` +
    `src/modules/${resolution.moduleId}/manifest.ts.`
  );
}

async function main(): Promise<void> {
  const files = [...walk(join(SRC_ROOT, 'modules')), ...walk(join(SRC_ROOT, 'apps'))];

  const owners = new Map<string, string>(Object.entries(HOST_REGISTERED_PORTS));
  const resolutions: PortResolution[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const moduleId = moduleOf(file);
    if (moduleId === null) continue;
    for (const name of registeredNames(source, file)) owners.set(name, moduleId);
    resolutions.push(...resolvedNames(source, file));
  }

  const { DISCOVERED_MANIFESTS } = (await import(
    pathToFileURL(join(SRC_ROOT, 'modules/_lifecycle/manifest-index.generated.ts')).href
  )) as { DISCOVERED_MANIFESTS: ReadonlyArray<{ id: string; manifest: { dependencies?: readonly string[] } }> };
  const dependencies = new Map<string, readonly string[]>(
    DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  );

  // A host entry whose owner now registers the port itself is dead weight, and
  // dead weight in a bridging table is how the bridge outlives the gap.
  const stale = Object.entries(HOST_REGISTERED_PORTS).filter(([name, owner]) => {
    const backend = join(SRC_ROOT, 'modules', owner, 'backend.ts');
    return existsSync(backend) && registeredNames(readFileSync(backend, 'utf8'), backend).includes(name);
  });

  const violations = findViolations({ resolutions, owners, dependencies });

  if (process.argv.includes('--list')) {
    for (const resolution of resolutions.sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
      const owner = owners.get(resolution.name) ?? (PLATFORM_OWNED_NAMES.has(resolution.name) ? 'platform' : '?');
      console.log(`  ${resolution.moduleId} → ${resolution.name} [${owner}]`);
    }
  }

  console.log(
    `[port-deps] modules scanned=${new Set(files.map(moduleOf)).size} ` +
      `resolutions=${resolutions.length} violations=${violations.length}`,
  );

  if (stale.length > 0) {
    console.error(
      `\nHOST_REGISTERED_PORTS entries whose owner now registers the port itself — delete them:`,
    );
    for (const [name, owner] of stale) console.error(`  - ${name} (${owner})`);
  }

  if (violations.length > 0) {
    console.error(
      `\nA module resolves a port it does not declare. The declaration is what makes the ` +
        `dependency real to the lifecycle, to the migration order and to an operator ` +
        `switching the provider off:`,
    );
    for (const violation of violations) console.error(describe(violation));
  }

  process.exit(violations.length === 0 && stale.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
