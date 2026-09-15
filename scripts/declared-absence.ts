/**
 * What a test run declares about the **Docker daemon** it will have.
 *
 * `backend/test/declared-services.ts` applied to something that is not a
 * service, and its reason for existing is the same one read from the other end:
 * a run must fail for the reason the *target* will fail for, in the second the
 * author runs it, rather than one continuous-integration job later. The three
 * defects this file was written from were each green on a developer's machine
 * because that machine happened to carry something the job did not, and one of
 * them was a Docker daemon: **six** cases of `packages/cli/test/install.test.ts`
 * supplied no answer to `runInstall`'s Docker probe, so the probe asked the
 * machine — green on a laptop, and on `node:22.18-slim` six refusals where six
 * step-list assertions were meant to be.
 *
 * ## The default is inverted here, and that is not an inconsistency
 *
 * `declaredServices()` defaults to `all`, because a run that *inferred* "no
 * database" from a connection that failed would hand back a suite that is green
 * because it never ran. Nothing here can produce that shape. No test in this
 * repository may consult a Docker daemon — nothing under vitest does, and the
 * one probe that exists (`packages/cli/src/install/index.ts`) is injectable
 * precisely so a test answers it instead of asking the host. So the declaration
 * is a **policy**, not an inference: the absence is the default, a run that
 * wants a daemon says so, and a test that has started reaching for one fails
 * loudly rather than skipping. That is the direction `declared-services.ts`
 * refuses to travel in and this one is safe to, because the failure mode it
 * guards is "a dependency nobody declared", not "a suite that did not run".
 *
 * ## Why it lives at the repository root
 *
 * `vitest.config.base.ts` is the one file every workspace's vitest
 * configuration merges — the property `assertWorkspacePackagesAreLocal()`
 * already depends on, and that
 * `backend/test/unit/harness/workspace-resolution.test.ts` keeps true by
 * deriving the population rather than listing it. The failure this guards
 * happened in `packages/cli`, not in `backend`, so a backend-only seam would
 * have covered none of it.
 *
 * ## The address
 *
 * A unix socket path that cannot exist. The Docker CLI reads `DOCKER_HOST`
 * ahead of `DOCKER_CONTEXT` and ahead of the current context, so this wins on a
 * machine with a daemon, a rootless daemon and a remote context alike — which
 * is the whole point, since the machine that has one is the machine the
 * instrument has to fail on.
 */

export const DOCKER_DECLARATION_ENV = 'TEST_DOCKER';

export type DeclaredDocker = 'absent' | 'present';

/**
 * Where `DOCKER_HOST` points while a run declares the daemon absent. Under
 * `/nonexistent`, which is not a directory on any supported host, so the socket
 * beneath it cannot be created by accident either.
 */
export const UNREACHABLE_DOCKER_HOST = 'unix:///nonexistent/endora-declared-absence.sock';

export function declaredDocker(env: NodeJS.ProcessEnv = process.env): DeclaredDocker {
  const raw = env[DOCKER_DECLARATION_ENV]?.trim();
  if (raw === undefined || raw === '') return 'absent';
  if (raw === 'absent' || raw === 'present') return raw;
  throw new Error(
    `${DOCKER_DECLARATION_ENV} must be "absent" or "present" (got "${raw}"). ` +
      `A run declares whether it may consult a Docker daemon; it never guesses.`,
  );
}

/**
 * Point `DOCKER_HOST` at the unreachable address, unless this run declared it
 * has a daemon.
 *
 * Called from `vitest.config.base.ts`, in the parent process, before any worker
 * forks — workers inherit the environment, which is the same property
 * `test/global-setup.ts`'s `DATABASE_URL` lease depends on.
 *
 * Returns what it decided, so a caller that wants to report it can, and so the
 * test that proves this does not have to re-derive the condition.
 */
export function applyDeclaredDockerAbsence(env: NodeJS.ProcessEnv = process.env): DeclaredDocker {
  const declared = declaredDocker(env);
  if (declared === 'absent') env['DOCKER_HOST'] = UNREACHABLE_DOCKER_HOST;
  return declared;
}
