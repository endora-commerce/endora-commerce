import { describe, expect, it } from 'vitest';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import {
  assertLockedModulesPresent,
  ReducedDeploymentError,
} from '@endora-commerce/platform/lifecycle';

/**
 * D-101 — a deployment that does not ship what it composes refuses to boot.
 *
 * **This file is the refusal's only proof, and that is structural rather than a
 * choice.** The harness never calls `loadModulePresence`: it seeds the registry
 * cache directly (`test/helpers/test-server.ts`), so a refusal living inside the
 * boot step would be exercised by nothing in the suite. That is why the decision
 * puts the analysis in a **pure** function and the boot step only calls it —
 * every fixture below enters at the top of that analysis (issue #130), as the
 * three inputs a composition really has: what it ships, what the registry says,
 * and what it declared.
 *
 * The two triggers are the two absences F3 measured, and they are not the same
 * question:
 *
 *  - **not shipped** — answerable before the database is touched, so it is
 *    asked first and `rows` is `null`;
 *  - **not installed** — a `module_registrations` row the boot reconciler will
 *    not repair (it inserts only), so the message carries `module:enable`.
 *
 * Neither is the operator axis. `assertDeactivatable` refuses a *transition*
 * from present to absent; this refuses an *initial state*. Separate call sites,
 * separate error types, separate messages.
 */

function manifest(
  id: string,
  extra: Partial<ModuleManifest> = {},
): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    ...extra,
  } as ModuleManifest;
}

const LOCKED = {
  nonDeactivatable: true as const,
  reason: 'Answers the permission check behind every guarded admin route.',
};

/** `admin_roles` acknowledges `admin_users`; `_i18n` declares it. Both ends. */
function fullSet(): ModuleManifest[] {
  return [
    manifest('admin_users', { activation: LOCKED }),
    manifest('admin_roles', {
      activation: LOCKED,
      acknowledgedDependencies: [
        {
          moduleId: 'admin_users',
          port: 'adminUserReadPort',
          reason: 'The permission check starts from the admin row.',
        },
      ],
    }),
    manifest('_i18n', { dependencies: ['admin_users'] }),
    manifest('newsletter', {
      activation: { settingCode: 'newsletter.enabled', default: true },
    }),
  ];
}

/** The reduced deployment: everything except the module both ends need. */
function withoutAdminUsers(): ModuleManifest[] {
  return fullSet().filter((m) => m.id !== 'admin_users');
}

function rowsOf(
  entries: ReadonlyArray<readonly [string, RegistryState]>,
): ReadonlyMap<string, RegistryState> {
  return new Map(entries);
}

const NOTHING_DECLARED: ReadonlySet<string> = new Set();

function refusalFor(
  manifests: readonly ModuleManifest[],
  rows: ReadonlyMap<string, RegistryState> | null,
  declared: ReadonlySet<string> = NOTHING_DECLARED,
): ReducedDeploymentError {
  try {
    assertLockedModulesPresent(manifests, rows, declared);
  } catch (error) {
    if (error instanceof ReducedDeploymentError) return error;
    throw error;
  }
  throw new Error('expected a ReducedDeploymentError, and nothing was thrown');
}

describe('assertLockedModulesPresent — the module this deployment never shipped', () => {
  it('refuses a composition whose modules need a module it does not ship', () => {
    const error = refusalFor(withoutAdminUsers(), null);

    expect(error.findings.map((f) => f.kind)).toEqual(['not-shipped']);
    expect(error.findings[0]?.moduleId).toBe('admin_users');
  });

  it('names both ends — the module that needs it and the port it reads', () => {
    // The assertion the ruling names as part of the verdict. A message naming
    // only the absentee sends the reader hunting across three arrays in 65
    // manifests, and `adminUserReadPort` is the edge a `dependencies`-only
    // message would miss — the edge this whole record started from.
    const message = refusalFor(withoutAdminUsers(), null).message;

    expect(message).toContain('admin_users');
    expect(message).toContain('admin_roles');
    expect(message).toContain('adminUserReadPort');
    // …and the other end of the same absence, declared rather than acknowledged.
    expect(message).toContain('_i18n');
  });

  it('tells whoever composed the deployment what to do about it', () => {
    const message = refusalFor(withoutAdminUsers(), null).message;

    // The deployment's own declaration file, and the field inside it the
    // omission goes in — `divergence.ts` since D-205, which renamed the file
    // once it grew past omissions.
    expect(message).toContain('divergence.ts');
    expect(message).toContain('omittedModules');
  });

  it('accepts the omission once the deployment has declared it', () => {
    expect(() =>
      assertLockedModulesPresent(withoutAdminUsers(), null, new Set(['admin_users'])),
    ).not.toThrow();
  });

  it('says nothing about a complete deployment', () => {
    expect(() =>
      assertLockedModulesPresent(fullSet(), null, NOTHING_DECLARED),
    ).not.toThrow();
  });

  it('refuses a missing module whatever the lock says, because the lock is not readable', () => {
    // The absent module's manifest is absent with it, so "was it locked?" has
    // no answer at the seam that has to refuse — a packaging split ships
    // neither. What is readable is the declaration in the module that stays,
    // and that is what the refusal rests on. Deliberately wider than "locked
    // modules only", and D-100's reasoning points the same way: the argument
    // is the declared edge, not a lock nothing here can re-derive.
    const reduced = fullSet().filter((m) => m.id !== 'newsletter');
    reduced.push(manifest('blog', { dependencies: ['newsletter'] }));

    const error = refusalFor(reduced, null);
    expect(error.findings[0]?.moduleId).toBe('newsletter');
    expect(error.message).toContain('blog');
  });

  it('leaves a non-binding edge alone — its absence is already declared and handled', () => {
    const reduced = fullSet().filter((m) => m.id !== 'newsletter');
    reduced.push(
      manifest('blog', {
        nonBindingDependencies: [
          {
            moduleId: 'newsletter',
            name: 'newsletterSubscribePort',
            kind: 'degrades-without',
            whenAbsent: 'no subscribe box renders under a post',
            reason: 'The blog reads it when it is there and renders less when it is not.',
          },
        ],
      }),
    );

    expect(() => assertLockedModulesPresent(reduced, null, NOTHING_DECLARED)).not.toThrow();
  });
});

describe('assertLockedModulesPresent — the row the boot reconciler will not repair', () => {
  it('refuses a shipped locked module whose registry row is not `installed`', () => {
    const error = refusalFor(fullSet(), rowsOf([['admin_users', 'disabled']]));

    expect(error.findings.map((f) => f.kind)).toEqual(['not-installed']);
    expect(error.findings[0]?.moduleId).toBe('admin_users');
  });

  it('carries the remedy, because the reconciler inserts only and never updates a state', () => {
    const message = refusalFor(fullSet(), rowsOf([['admin_users', 'uninstalled']])).message;

    expect(message).toContain('module:enable admin_users');
    // The module's own sentence for why the platform cannot run without it.
    expect(message).toContain('Answers the permission check behind every guarded admin route');
  });

  it('says nothing about a module with no row at all — that one the reconciler does install', () => {
    expect(() =>
      assertLockedModulesPresent(fullSet(), rowsOf([]), NOTHING_DECLARED),
    ).not.toThrow();
  });

  it('says nothing about a switchable module whose row is disabled — that is the operator axis', () => {
    expect(() =>
      assertLockedModulesPresent(
        fullSet(),
        rowsOf([['newsletter', 'disabled']]),
        NOTHING_DECLARED,
      ),
    ).not.toThrow();
  });

  it('accepts a declared omission reached through a legacy row rather than a shipping set', () => {
    expect(() =>
      assertLockedModulesPresent(
        fullSet(),
        rowsOf([['admin_users', 'disabled']]),
        new Set(['admin_users']),
      ),
    ).not.toThrow();
  });
});

describe('assertLockedModulesPresent — the declaration is two-way', () => {
  it('refuses a declaration for a module the deployment does ship', () => {
    // A stale declaration is how a deployment silently reacquires the hazard it
    // once declared: the entry stays, the module comes back, and the ledger now
    // describes a deployment that no longer exists.
    const error = refusalFor(fullSet(), rowsOf([]), new Set(['newsletter']));

    expect(error.findings.map((f) => f.kind)).toEqual(['stale-declaration']);
    expect(error.message).toContain('newsletter');
  });

  it('does not call a declaration stale before the registry has been read', () => {
    // The shipping question is asked with `rows === null`, and a module that is
    // shipped but carries a legacy row is a live declaration, not a stale one.
    expect(() =>
      assertLockedModulesPresent(fullSet(), null, new Set(['admin_users'])),
    ).not.toThrow();
    expect(() =>
      assertLockedModulesPresent(
        fullSet(),
        rowsOf([['admin_users', 'disabled']]),
        new Set(['admin_users']),
      ),
    ).not.toThrow();
  });
});
