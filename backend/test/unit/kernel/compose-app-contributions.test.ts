/**
 * The split T118 performed, asserted rather than reviewed
 * (`specs/110-instance-repository/` T118; `contracts/instance-repository.md`
 * R1.4 and R2.4).
 *
 * ## The question this file answers, and why it is not harness-parity's
 *
 * `harness-parity.test.ts` asks whether the **two roots agree**. This asks
 * something the two roots agree about perfectly either way: *which side of the
 * package boundary each contributed name is on*. Before T118 both roots wrote
 * all 61 out; a reader comparing them found no difference, because the
 * difference is between a deployment and the platform, not between two
 * deployments.
 *
 * Three properties, and each one fails in a different direction:
 *
 *   1. **Disjoint.** A name contributed on both sides is registered twice, and
 *      the second write silently wins. Which one that is depends on the order
 *      the platform calls the callback in, which is property 3.
 *   2. **The platform's set is exactly the names whose value expression names
 *      no module.** That is the classification the row enumerated, and it is
 *      the whole rule for what may cross: a value built out of a module's
 *      services cannot live in `@endora-commerce/platform` (D-52/D-53).
 *   3. **Ordered.** The platform contributes first and the caller second, so a
 *      deployment that genuinely wants a different answer for one of the
 *      platform's names can still say so. Reversed, the platform would
 *      overwrite a deployment's deliberate override with the default — which is
 *      exactly D-45's failure mode, one layer out.
 *
 * ## And the two shapes a client's tree needs, which are compile-time
 *
 * R2.4 says an instance holds no composition root: it calls `composeApp` and
 * supplies **no** contribute callback. That is a statement about the *type*, so
 * it is asserted where a type is asserted — the two declarations below compile
 * or they do not, and `pnpm --filter backend run typecheck` is the instrument.
 * A runtime proof would need a database, a Redis and an installed module set,
 * which is `boot-gate`'s job and not a unit test's.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { ComposeAppOptions } from '@endora-commerce/platform/composition';

const productionPath = fileURLToPath(new URL('../../../src/composition.ts', import.meta.url));
const platformPath = fileURLToPath(
  new URL('../../../../packages/platform/src/composition/compose-app.ts', import.meta.url),
);

/**
 * R2.4, as `tsc` reads it: a deployment root is the only argument an instance
 * has, and everything else is the platform's.
 *
 * The value is unused deliberately — the assertion is that the annotation
 * compiles. `contribute`, `composition`, `values`, `plugins`, `scopedPlugins`,
 * `buildTenantContext`, `decorationOrder` and `declaredOmissions` are every
 * other member, and a required one added to that list breaks this line rather
 * than an instance somebody scaffolds a month later.
 */
const INSTANCE_OPTIONS = { deploymentRoot: '/srv/endora' } satisfies ComposeAppOptions;

/**
 * And the reference deployment's shape, which is the other half of the same
 * claim: supplying a callback is *allowed*, so the fork D-207 refuses is a
 * thing this repository's root may do and an instance's may not.
 */
const REFERENCE_OPTIONS = {
  deploymentRoot: '/srv/endora',
  contribute: () => undefined,
} satisfies ComposeAppOptions;

/** Every name a `contribute({ … })` call in one source passes, in source order. */
function contributedNames(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'contribute' &&
      node.arguments[0] !== undefined &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
          names.push(property.name.text);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          names.push(property.name.text);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return names;
}

/**
 * The twenty the platform holds, enumerated rather than counted.
 *
 * The row that specified this work lists them by name and says why: *"the
 * classification is a reading of 61 value expressions and not a machine
 * derivation, and a reader has to be able to disagree with a member"*. So this
 * is a ledger, and the two-way comparison below is what makes disagreeing with
 * a member an edit to this file rather than a silent drift.
 *
 * Every one is a kernel sub-kernel's object, a host value or an environment
 * read. Two are worth naming because they are the soft edge of the
 * classification and a reader should meet it here rather than derive it:
 * `salesChannelCodeIdPort`'s `codeById` half reads `sales_channels`' own gated
 * `salesChannelsService` port by container name, and `credentialsSettingsPort`
 * hands over the settings kernel's service under a second name. Neither names
 * a module in an import, which is the criterion; both resolve a module's
 * registration lazily, which is what every port read in a composition does.
 */
const PLATFORM_CONTRIBUTIONS: readonly string[] = [
  // T118b — the nine actor-shaped names. They answer *who is asking?* off
  // `request.actor` and nothing else, and they stayed behind through T118 for a
  // reason that was never about their value expressions: the
  // `declare module 'fastify'` block that puts `actor` on `FastifyRequest` was
  // `auth`'s, so a platform file reading it depended on a module. The block is
  // `packages/platform/src/http/request-actor.ts` now and the shape is
  // `@endora-commerce/contracts`', so the criterion above admits them unchanged.
  'adminAuditActorResolver',
  'adminContextResolver',
  'cartActorResolver',
  'catalogAdminAuditContext',
  'customerAccountIdResolver',
  'customerActorResolver',
  'customerContextResolver',
  'inventoryAdminAuditContext',
  'priceListsAdminAuditContext',
  // T118's twenty.
  'blogStorefrontDeps',
  'catalogRunBulkOperationWorker',
  'credentialsSettingsPort',
  'lifecycleActivationPropagation',
  'mfaDefaultChannelIdResolver',
  'moduleQueueRedis',
  'modulePresenceProbe',
  'priceListsEnableStatusSweeper',
  'pwaRunWorkers',
  'salesChannelCodeIdPort',
  'salesChannelMembershipPort',
  'salesChannelResolutionPort',
  'salesChannelsCache',
  'searchRunWorkers',
  'settingsCache',
  'settingsChannelResolver',
  'settingsModulePresence',
  'settingsReadPort',
  'settingsSecretEncryptionKey',
  'webhooksRunWorkers',
];

/**
 * The tenth actor-shaped name, and why it is on neither list above.
 *
 * `specs/110-instance-repository/` T118b's "Done when" enumerated **ten**
 * contributions to move and this file holds nine. `ordersAdminScopeResolver` is
 * the tenth and it stays with the reference deployment, measured rather than
 * deferred: `resolveAdminOrdersScope` reads `admin_users` and `admin_roles` in
 * raw SQL and branches on `admin_roles.code === 'sales_representative'`. That is
 * a module's table and a module's business rule, so its value expression **does**
 * name a module in the only sense the criterion cares about, and the actor
 * augmentation was never its only blocker. Moving it would have put the first SQL
 * read of a module-owned table into `@endora-commerce/platform` — refused by no
 * check in the estate, because every check that judges that boundary reads
 * *imports*.
 *
 * It is also the half that cannot travel alone: the deployment's
 * `buildTenantContext` calls the same function for the admin arm, and that
 * mapping stays behind for its own reasons (`customerRollupScopePort` and
 * `organizationTreeService`). Two copies of one query, or an export back out of
 * the platform for the deployment to call, are both worse than one function in
 * the root that owns both callers.
 */
const DEPLOYMENT_ACTOR_SHAPED: readonly string[] = ['ordersAdminScopeResolver'];

describe('T118 — the contribution wiring is the platform’s and the values are not', () => {
  it('leaves the tenth actor-shaped name with the deployment (T118b)', () => {
    // Two directions. It must still be contributed — a name silently dropped
    // is a module resolving a registration nobody wrote — and it must not have
    // been swept into the platform's set along with the nine.
    const deployment = new Set(contributedNames(productionPath));

    for (const name of DEPLOYMENT_ACTOR_SHAPED) {
      expect(deployment.has(name), `${name} is no longer contributed at all`).toBe(true);
      expect(PLATFORM_CONTRIBUTIONS).not.toContain(name);
    }
  });

  it('holds exactly the names whose value expression names no module', () => {
    // Both directions in one comparison. A name added to `composeApp` and not
    // here is a value that crossed the boundary with nobody deciding; a name
    // here that `composeApp` no longer contributes is a ledger entry describing
    // nothing, which is how a set like this comes to be believed.
    expect([...new Set(contributedNames(platformPath))].sort()).toEqual(
      [...PLATFORM_CONTRIBUTIONS].sort(),
    );
  });

  it('shares no name with the reference deployment’s own contributions', () => {
    // Two registrations of one name is not an error anywhere — `contribute`
    // overwrites — so the second write wins in silence and which one it is
    // depends on the order below. This is the assertion that makes that
    // impossible rather than merely unlikely.
    const deployment = new Set(contributedNames(productionPath));
    const both = PLATFORM_CONTRIBUTIONS.filter((name) => deployment.has(name)).sort();

    expect(both, 'contributed on both sides of the package boundary').toEqual([]);
  });

  it('leaves the reference deployment the rest of the sixty-one', () => {
    // The vacuous-pass guard, and the reason the number is here rather than in
    // the row: a `composition.ts` whose contributions the parser stopped seeing
    // would satisfy the disjointness above perfectly.
    const deployment = new Set(contributedNames(productionPath));

    expect(deployment.size, 'the reference deployment contributes nothing — the walk broke')
      .toBeGreaterThan(30);
    expect(deployment.size + PLATFORM_CONTRIBUTIONS.length).toBe(61);
  });

  it('contributes before the caller’s callback, so a deployment can still override', () => {
    // Position, not presence. `contribute` overwrites whatever a name held, so
    // the platform's own defaults have to land *first*; reversed, the platform
    // would overwrite a deployment's deliberate override with its default, and
    // nothing would report it.
    const source = readFileSync(platformPath, 'utf8');
    const firstPlatformContribution = source.indexOf('composedModules.contribute({');
    const callerCallback = source.indexOf('await options.contribute?.(composedContext);');

    expect(firstPlatformContribution, 'the platform contributes nothing').toBeGreaterThan(0);
    expect(callerCallback, 'the caller’s callback is never invoked').toBeGreaterThan(0);
    expect(callerCallback).toBeGreaterThan(firstPlatformContribution);
  });

  it('lets an instance compose with a deployment root and nothing else (R2.4)', () => {
    // The two `satisfies` declarations at the top of this file are the
    // assertion; `tsc` is the instrument and this case is what stops them being
    // deleted as unused. An instance that had to supply a callback would be a
    // client tree contributing over a name a module defaults, which is the fork
    // D-207 refuses arriving one registration at a time.
    expect(INSTANCE_OPTIONS.deploymentRoot).toBe('/srv/endora');
    expect(REFERENCE_OPTIONS.contribute).toBeTypeOf('function');
  });
});
