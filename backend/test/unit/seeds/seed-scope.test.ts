import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { DEMO_RESET_SCOPE_REASON, DEMO_SEED_SCOPE_REASON } from '@endora-commerce/platform/demo';
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
 * Issue #228, second half — the demo seed runs inside a scope.
 *
 * The first half widened `check:entry-scope`'s population until it could see the
 * seed at all; this is the behaviour that answers it. The seed writes across a
 * dozen modules' tables in bulk, and a scope decides which tenant filters those
 * writes and the reads between them run under — so the assertion that carries
 * the weight here is not "a scope exists" but **"the scope adds no predicate"**.
 * A seed that quietly started producing a different database would be a worse
 * outcome than the gap it closes.
 *
 * **Its subject moved with feature 113's T226 and the assertions did not.** It
 * read `src/seeds/dev-catalog-seed.ts`, the developer seed script; that script
 * is deleted and `endora demo seed` is the entry point an operator has, so the
 * structural half reads `src/cli.ts` instead. Nothing else in the repository
 * asserts the ordering `contracts/module-demo-data-layer.md` §3.3 makes
 * contract — *"the guard first, before anything is composed, before a scope is
 * opened, and outside every `try`"* — and `backend/test/unit/cli/
 * demo-command.test.ts` deliberately does not: it holds what is decidable
 * without a database, and §3.3 is about where three statements sit relative to
 * one another.
 *
 * The file has two halves and needs both. The **structural** half pins the
 * calls the entry point makes and their order, because `check:entry-scope` is
 * deliberately coarse: it asks whether the entry file names a sanctioned entry
 * function, never whether that function wraps the work. The **behavioural**
 * half then runs the call the structural half pinned and asserts what it
 * establishes.
 *
 * `runWithoutTenantContext` is what makes the behavioural half mean anything.
 * The harness installs a system context around every test
 * (`test/tenancy-setup.ts`) — which is exactly the context under test — so
 * without stripping it first every assertion below would pass on the harness's
 * context and prove nothing about the seed's.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = readFileSync(join(BACKEND_ROOT, 'src/cli.ts'), 'utf8');

/** The call the entry point makes, run here so what it establishes can be asserted. */
function inSeedScope<T>(run: () => Promise<T>): Promise<T> {
  return enterSystemScope(DEMO_SEED_SCOPE_REASON, run, { entryPoint: 'cli' });
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

describe('the demo command enters the scope, and enters it around everything', () => {
  it('wraps the whole run rather than each step (§3.4)', () => {
    // One scope for the run, opened over the composition's own container, with
    // the body as its callback — so there is no path into the work that is
    // outside it and no module's demo body is its own entry point.
    expect(CLI).toMatch(/enterSystemScope\(\s*verb === 'seed' \? DEMO_SEED_SCOPE_REASON : DEMO_RESET_SCOPE_REASON,/);
    expect(CLI).toMatch(/\{ entryPoint: 'cli', container: composition\.container \}/);
  });

  it('refuses a production or non-disposable database first, and outside every `try` (§3.3)', () => {
    // The ordering that is the contract: the guard, then the composition, then
    // the scope. A refused run composes nothing and connects to nothing (#224),
    // and it cannot be reached through a `catch` that decided to continue
    // because there is no `try` above it.
    const body = CLI.slice(CLI.indexOf('async function runDemoCommand('));
    const guardAt = body.indexOf('mustBeNonProduction();');
    const composeAt = body.indexOf('await composeApp(');
    const scopeAt = body.indexOf('enterSystemScope(');
    const tryAt = body.indexOf('try {');
    expect(guardAt, 'the demo command no longer calls the guard — rewrite this assertion').toBeGreaterThan(-1);
    expect(composeAt).toBeGreaterThan(guardAt);
    expect(scopeAt).toBeGreaterThan(composeAt);
    expect(tryAt).toBeGreaterThan(guardAt);
  });

  it('runs the demo through the runner rather than seeding anything itself', () => {
    // T226: there is no host residue left. A `seedHostModuleResidue`-shaped
    // call here would be demo rows the manifests do not account for, which is
    // the state this feature exists to end.
    expect(CLI).toMatch(/await runDemo\(\{/);
    expect(CLI).not.toMatch(/HostModuleResidue/);
  });
});

describe('what that scope establishes', () => {
  it('starts from no ambient context at all — the seed`s real starting state', () => {
    // The premise. `endora demo seed` is a CLI process: nothing above the
    // command has established anything, so every filtered query a demo body
    // makes would fail closed. "It works today" was an accident of which
    // entities the seed happens to touch, not a property of the code.
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
        expect(customerFilterCond('absent')).toEqual({});
        expect(customerFilterCond('present')).toEqual({});
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
    expect(seen[0]?.reason).toBe(DEMO_SEED_SCOPE_REASON);
    expect(DEMO_SEED_SCOPE_REASON).toMatch(/seed/i);
    expect(DEMO_RESET_SCOPE_REASON).toMatch(/reset/i);
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
