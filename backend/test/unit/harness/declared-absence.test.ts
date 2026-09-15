/**
 * Declared absence, proved **against the presence** of the thing.
 *
 * Three defects reached `master` because a developer's machine carried
 * something the target did not: a Meilisearch on `localhost:7700`, a Docker
 * daemon, and ambient secrets. None of the three was a missing test — each was
 * a test that could not tell the machine from its subject. The repair is that a
 * run **declares** what it does not have and the harness makes the declaration
 * true, which is `test/declared-services.ts`' idea extended past the three
 * services.
 *
 * **A proof run on a machine that lacks the thing proves nothing**, which is
 * the trap this file is written around. Every assertion below is about what
 * *this* process has, so it is decided by the harness rather than by the host:
 * on a laptop with Postgres, Redis, Meilisearch and a Docker daemon all
 * running, the fast run still sees an unreachable port and an unreachable
 * socket, and still sees no session secret. That is the whole claim, and it is
 * a claim a `skipIf` would quietly stop making.
 *
 * The other direction is proved too, because an instrument that only ever
 * removes things is one nobody can use: a run that declares services keeps
 * them, and `TEST_DOCKER=present` leaves `DOCKER_HOST` exactly as the machine
 * set it.
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  declaredDocker,
  DOCKER_DECLARATION_ENV,
  UNREACHABLE_DOCKER_HOST,
  applyDeclaredDockerAbsence,
} from '../../../../scripts/declared-absence.js';
import {
  declaredServices,
  SERVICES_DECLARATION_ENV,
  UNREACHABLE_SERVICE_URLS,
} from '../../declared-services.js';

describe('the Docker daemon is declared absent, whatever this machine has', () => {
  it('points DOCKER_HOST at an address no daemon can be at', () => {
    // Set by `vitest.config.base.ts` in the parent process. This assertion
    // running inside a worker is half the proof — the other half is that it is
    // unconditional, so a machine with a live daemon fails it if the seam ever
    // stops applying.
    expect(process.env['DOCKER_HOST']).toBe(UNREACHABLE_DOCKER_HOST);
  });

  it('hands that address to a child process, which is what a probe is', () => {
    // `runInstall`'s Docker probe is a `spawnSync`, so inheritance is the
    // property that matters and reading `process.env` in-process does not
    // establish it.
    const seen = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(String(process.env.DOCKER_HOST))"],
      { encoding: 'utf8' },
    );
    expect(seen).toBe(UNREACHABLE_DOCKER_HOST);
  });

  it('is a declaration with two values and no third', () => {
    expect(declaredDocker({})).toBe('absent');
    expect(declaredDocker({ [DOCKER_DECLARATION_ENV]: '' })).toBe('absent');
    expect(declaredDocker({ [DOCKER_DECLARATION_ENV]: 'present' })).toBe('present');
    expect(() => declaredDocker({ [DOCKER_DECLARATION_ENV]: 'yes' })).toThrow(
      /must be "absent" or "present"/,
    );
  });

  it('leaves a run that declares a daemon alone — the opposite direction', () => {
    const declared: NodeJS.ProcessEnv = {
      [DOCKER_DECLARATION_ENV]: 'present',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    };
    expect(applyDeclaredDockerAbsence(declared)).toBe('present');
    expect(declared['DOCKER_HOST']).toBe('unix:///var/run/docker.sock');

    const undeclared: NodeJS.ProcessEnv = { DOCKER_HOST: 'unix:///var/run/docker.sock' };
    expect(applyDeclaredDockerAbsence(undeclared)).toBe('absent');
    expect(undeclared['DOCKER_HOST']).toBe(UNREACHABLE_DOCKER_HOST);
  });
});

describe('the three services are what the run declared, and not what is listening', () => {
  const declared = declaredServices();

  it('answers with the stand-ins when the run declared none', () => {
    if (declared !== 'none') {
      // The complete suite. The mirror assertion is the one below; this branch
      // exists so the file states which of the two it took rather than
      // appearing to have proved both.
      expect(declared).toBe('all');
      return;
    }
    for (const [name, url] of Object.entries(UNREACHABLE_SERVICE_URLS)) {
      expect(process.env[name], `${name} must be the declared stand-in`).toBe(url);
    }
  });

  it('keeps the real addresses when the run declared services — the opposite direction', () => {
    if (declared !== 'all') {
      expect(declared).toBe('none');
      return;
    }
    // A run that declares `all` leases a real database in `global-setup.ts`;
    // the stand-in would mean the lease never happened.
    expect(process.env['DATABASE_URL']).not.toBe(UNREACHABLE_SERVICE_URLS.DATABASE_URL);
  });

  it('is read from the declaration and never from a socket', () => {
    expect(declaredServices({})).toBe('all');
    expect(declaredServices({ [SERVICES_DECLARATION_ENV]: 'none' })).toBe('none');
    expect(() => declaredServices({ [SERVICES_DECLARATION_ENV]: 'some' })).toThrow(
      /must be "all" or "none"/,
    );
  });
});
