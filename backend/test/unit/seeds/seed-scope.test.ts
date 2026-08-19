import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { SEED_SCOPE_REASON } from '../../../src/seeds/seed-scope.js';
import { enterSystemScope, openPlatformScopeCount } from '../../../src/kernel/scope.js';
import {
  setEscapeHatchAuditSink,
  type EscapeHatchAuditRecord,
} from '../../../src/tenancy/escape-hatch.js';
import { orgFilterCond, customerFilterCond } from '../../../src/tenancy/filters.js';
import {
  MissingTenantContextError,
  getTenantContext,
  runWithoutTenantContext,
} from '../../../src/tenancy/tenant-context.js';

/**
 * Issue #228, second half — the dev seed runs inside a scope.
 *
 * The first half widened `check:entry-scope`'s population until it could see the
 * seed at all; this is the behaviour that answers it. The seed writes across a
 * dozen modules' tables in bulk, and a scope decides which tenant filters those
 * writes and the reads between them run under — so the assertion that carries
 * the weight here is not "a scope exists" but **"the scope adds no predicate"**.
 * A seed that quietly started producing a different database would be a worse
 * outcome than the gap it closes.
 *
 * The file has two halves and needs both. The **structural** half pins what the
 * seed does — the call it makes, its arguments, and that there is no way into
 * `main` around it — because the seed cannot be imported (it runs at import) and
 * because `check:entry-scope` is deliberately coarse: it asks whether the entry
 * file names a sanctioned entry function, never whether that function wraps the
 * work. The **behavioural** half then runs the call the structural half pinned
 * and asserts what it establishes.
 *
 * `runWithoutTenantContext` is what makes the behavioural half mean anything.
 * The harness installs a system context around every test
 * (`test/tenancy-setup.ts`) — which is exactly the context under test — so
 * without stripping it first every assertion below would pass on the harness's
 * context and prove nothing about the seed's.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED = readFileSync(join(BACKEND_ROOT, 'src/seeds/dev-catalog-seed.ts'), 'utf8');

/** The call the seed makes, run here so what it establishes can be asserted. */
function inSeedScope<T>(run: () => Promise<T>): Promise<T> {
  return enterSystemScope(SEED_SCOPE_REASON, run, { entryPoint: 'cli' });
}

/** Collect the escape-hatch records one call emits. */
async function recordsFrom(run: () => Promise<unknown>): Promise<EscapeHatchAuditRecord[]> {
  const seen: EscapeHatchAuditRecord[] = [];
  setEscapeHatchAuditSink((record) => seen.push(record));
  await run();
  return seen;
}

afterEach(() => {
  // Back to the default stderr sink, so a later test in this file — or any file
  // sharing the fork — is not writing into an array nobody reads.
  setEscapeHatchAuditSink((record) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'info', msg: 'tenant.escape_hatch', ...record })}\n`,
    );
  });
});

describe('the seed enters the scope, and enters it around everything', () => {
  it('wraps its top-level invocation rather than calling main bare', () => {
    // The shape `search:reindex` and `cart:abandonment-sweep` use. Asserted on
    // the *invocation* because that is what makes the scope inescapable: a
    // second, bare `main()` anywhere in the file would run the whole seed
    // outside it, and nothing else in the repository would notice.
    expect(SEED).toMatch(/enterSystemScope\(SEED_SCOPE_REASON, main, \{ entryPoint: 'cli' \}\)/);
    expect(SEED).not.toMatch(/^\s*(void )?main\(\)/m);
  });

  it('opens the scope before it opens the ORM', () => {
    const scopeAt = SEED.indexOf('enterSystemScope(SEED_SCOPE_REASON');
    const ormAt = SEED.indexOf('await initOrm()');
    expect(ormAt, 'the seed no longer opens the ORM — rewrite this assertion').toBeGreaterThan(-1);
    // The invocation sits at the bottom of the file, so "before" is causal and
    // not lexical: `main` is the callback, so nothing in it runs until the scope
    // is open. The lexical check that would matter is the one above.
    expect(scopeAt).toBeGreaterThan(-1);
  });

  it('still refuses a production or non-disposable database first', () => {
    // Ordering that has to survive this change: `mustBeNonProduction()` stays
    // `main`'s first statement, so a refused run connects to nothing (#224).
    const guardAt = SEED.indexOf('mustBeNonProduction();');
    const ormAt = SEED.indexOf('await initOrm()');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(ormAt);
  });
});

describe('what that scope establishes', () => {
  it('starts from no ambient context at all — the seed`s real starting state', () => {
    // The premise. `pnpm seed:dev` is a bare `tsx` process: nothing above
    // `main()` has established anything, so every filtered query it makes would
    // fail closed. "It works today" was an accident of which entities the seed
    // happens to touch, not a property of the code.
    runWithoutTenantContext(() => {
      expect(getTenantContext()).toBeUndefined();
      expect(() => orgFilterCond()).toThrow(MissingTenantContextError);
    });
  });

  it('establishes a system context for the body', async () => {
    await runWithoutTenantContext(() =>
      inSeedScope(async () => {
        expect(getTenantContext()?.mode).toBe('system');
      }),
    );
  });

  it('adds no predicate to either tenant filter', async () => {
    // The assertion the seeded row counts are the empirical half of: in `system`
    // mode both global filters contribute `{}`, so no read the seed makes can be
    // narrowed and no write it makes can be redirected. A scope that pinned an
    // organisation would show up here as a `{ organizationId: … }`.
    await runWithoutTenantContext(() =>
      inSeedScope(async () => {
        expect(orgFilterCond()).toEqual({});
        expect(customerFilterCond()).toEqual({});
      }),
    );
  });

  it('emits exactly one escape-hatch record, naming the seed', async () => {
    // Crossing every organisation is the point of the scope and has to be
    // observable — which is why `enterSystemScope` demands a reason at all.
    const seen = await runWithoutTenantContext(() =>
      recordsFrom(() => inSeedScope(async () => undefined)),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.scope).toBe('system');
    expect(seen[0]?.reason).toBe(SEED_SCOPE_REASON);
    expect(SEED_SCOPE_REASON).toMatch(/seed/i);
  });

  it('closes the scope on success and on failure alike', async () => {
    const before = openPlatformScopeCount();
    await runWithoutTenantContext(() => inSeedScope(async () => undefined));
    expect(openPlatformScopeCount()).toBe(before);

    await expect(
      runWithoutTenantContext(() =>
        inSeedScope(async () => {
          throw new Error('seed failed halfway');
        }),
      ),
    ).rejects.toThrow('seed failed halfway');
    expect(openPlatformScopeCount()).toBe(before);
  });

  it('leaves no context behind after it returns', async () => {
    await runWithoutTenantContext(async () => {
      await inSeedScope(async () => undefined);
      expect(getTenantContext()).toBeUndefined();
    });
  });
});
