/**
 * The invariants `composeApp`'s own request pipeline depends on are
 * `composeApp`'s to establish — not a deployment's.
 *
 * ## The defect this file was written from
 *
 * `specs/117-instance-bring-up/tasks.md` Phase 6 recorded that every request on
 * a scaffolded instance answered `500 INTERNAL` with **nothing logged**,
 * `/api/v1/_openapi.json` included — a route that touches no module and no
 * database. Reproduced on 2026-09-13 against an instance the acceptance
 * criterion built, the error was:
 *
 * > `NoSystemDefaultChannel: No sales channel holds the system-default flag;
 * > the boot-time default-channel reconciler has not run or could not repair the
 * > registry.`
 *
 * thrown from `SalesChannelResolverService.getSystemDefault` inside the
 * **global `onRequest` hook** `registerSalesChannelResolverMiddleware` installs.
 * It is an `HttpError`, and the error envelope's `HttpError` branch answers
 * without logging — which is the whole of "nothing logged". `/api/v1/_health`
 * was the one path that answered anything else, because `shouldResolve` excludes
 * it; it answered 404 for its own unrelated reason (D-229).
 *
 * ## Why a source-level assertion, and why here
 *
 * The root cause is a **split between the two things a root does**:
 * `compose-app.ts` registers the middleware, and the boot step the middleware
 * depends on stood in `contributeReferenceDeployment` — the reference
 * deployment's contribution callback. `harness-parity.test.ts` could not see it:
 * its population is *production versus the harness*, and both of them ran the
 * reconciler. The root that had none was the third one — an instance, which
 * calls `composeApp` with **no** contribute callback (R2.4) and is exactly the
 * root this repository never composes.
 *
 * So the property is a property of the *wiring*, and the source is what the
 * wiring is — the same reasoning `compose-app-contributions.test.ts` states for
 * itself: *"a runtime proof would need a database, a Redis and an installed
 * module set"*. The runtime proof of this repair exists and is not a vitest
 * file: `pnpm --filter backend run acceptance:instance`, whose booted instance
 * answers the request that used to be a 500.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Comments removed by the parser rather than by a pair of regexes — issue #241,
// and `harness-parity.test.ts` is where the pair was wrong.
import { codeOnly } from '../../../scripts/lib/source-text.js';
// Where the platform's own source lives, derived from the one workspace member
// declaring `endora.type: "platform"` rather than spelled, so this file follows
// the host wherever it moves (feature 112).
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';

const BACKEND_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const REPO_ROOT = resolve(BACKEND_ROOT, '..');

const platformSrc = platformSourceRootAt(REPO_ROOT);
if (platformSrc === null) {
  throw new Error(
    '[compose-app-boot-invariants] no workspace member declares `endora.type: "platform"`. ' +
      'The subject of this file is the platform composition root and it cannot be located.',
  );
}

const composeAppPath = join(platformSrc, 'composition', 'compose-app.ts');
const composeApp = codeOnly(readFileSync(composeAppPath, 'utf8'));
const referenceDeployment = codeOnly(
  readFileSync(join(BACKEND_ROOT, 'src', 'composition.ts'), 'utf8'),
);

describe('composeApp establishes the invariants its own request hooks depend on', () => {
  it('registers the sales-channel resolver, which is why the invariant is its own', () => {
    // The premise of every assertion below. If the middleware ever stops being
    // registered by this root, the reasoning has to be re-derived rather than
    // inherited — so it is asserted rather than assumed.
    expect(
      composeApp,
      'composeApp no longer mounts the sales-channel resolver; re-derive who owns the ' +
        'system-default invariant before trusting the assertions below',
    ).toContain('salesChannels.plugin');
  });

  it('runs the boot-time default-channel reconciliation itself', () => {
    // The repair. Without this line a root that supplies no contribution
    // callback — which is every instance (R2.4) — serves `500 INTERNAL` on
    // every `/api/v1/*` path except `/api/v1/_health`, and logs none of them.
    expect(
      composeApp,
      'the root that mounts the sales-channel resolver must be the root that guarantees a ' +
        'system-default channel exists, or an instance answers 500 INTERNAL to every request',
    ).toContain('new DefaultChannelReconciler(');
    expect(composeApp).toContain('boot: reconcile the default sales channel');
  });

  it('reconciles before the modules compose, so a boot hook can rely on the channel', () => {
    // `inventory`'s `ctx.onBoot` warehouse/channel reconciler and
    // `mfaDefaultChannelIdResolver` both read the system default; a boot hook
    // runs after `composeModules` and a module registration must not be able to
    // observe the registry mid-repair.
    const reconciled = composeApp.indexOf('new DefaultChannelReconciler(');
    const composed = composeApp.indexOf('composeModules(moduleEntries');
    expect(reconciled).toBeGreaterThan(-1);
    expect(composed).toBeGreaterThan(-1);
    expect(
      reconciled,
      'the default-channel reconciliation must precede composeModules',
    ).toBeLessThan(composed);
  });

  it('leaves the reference deployment nothing to reconcile — one home, not two', () => {
    // Not a style point. A second call in a deployment's contribution callback
    // runs *after* `composeModules`, so the two would disagree about when the
    // invariant holds, and the one that arrives second is the one a reader
    // finds first.
    expect(
      referenceDeployment,
      'the reference deployment builds its own DefaultChannelReconciler again; the boot step ' +
        'is the platform composition root’s since the instance 500 of 2026-09-13',
    ).not.toContain('new DefaultChannelReconciler(');
  });
});
