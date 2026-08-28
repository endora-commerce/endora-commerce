import { describe, expect, it } from 'vitest';
import {
  loadReducedDeploymentDeclarations,
  parseReducedDeploymentDeclarations,
} from '../../../src/lifecycle/services/reduced-deployment.js';

/**
 * The declared escape from D-101's refusal — the half that reads the disk.
 *
 * `assertLockedModulesPresent` is pure and takes the declarations as data; this
 * is what turns a committed per-deployment file into that data. The two halves
 * are tested apart for the reason they are written apart: the refusal's proof
 * must not need a deployment to exist, and the loader's must not need a boot.
 */
describe('loadReducedDeploymentDeclarations — a committed file, not a flag', () => {
  it('declares nothing for a bare-core build', async () => {
    await expect(loadReducedDeploymentDeclarations({})).resolves.toEqual([]);
  });

  it('declares nothing for a deployment that ships no ledger file', async () => {
    await expect(
      loadReducedDeploymentDeclarations({ DEPLOYMENT: 'no_such_deployment' }),
    ).resolves.toEqual([]);
  });

  it('reads `example`, which ships the full set and therefore declares nothing', async () => {
    // The empty-file case has its own test because it is the one that will be
    // running everywhere: an empty ledger and an absent ledger must mean the
    // same thing, or the file that exists to make the mechanism discoverable
    // becomes a file that changes behaviour by existing.
    await expect(
      loadReducedDeploymentDeclarations({ DEPLOYMENT: 'example' }),
    ).resolves.toEqual([]);
  });
});

describe('parseReducedDeploymentDeclarations — an entry is a reason or it is nothing', () => {
  const PATH = 'backend/src/apps/fixture/reduced-deployment.ts';

  it('takes an omission that says what the deployment does instead', () => {
    expect(
      parseReducedDeploymentDeclarations(
        [
          {
            moduleId: 'admin_users',
            reason:
              'This deployment authenticates operators through the parent tenant and ships no ' +
              'admin identity of its own.',
          },
        ],
        PATH,
      ),
    ).toEqual([{ moduleId: 'admin_users', reason: expect.stringContaining('parent tenant') }]);
  });

  it('refuses an entry with no reason, because the reason is the review', () => {
    expect(() =>
      parseReducedDeploymentDeclarations([{ moduleId: 'admin_users' }], PATH),
    ).toThrow(/reason/);
  });

  it('refuses a reason too short to be an argument', () => {
    expect(() =>
      parseReducedDeploymentDeclarations(
        [{ moduleId: 'admin_users', reason: 'not needed' }],
        PATH,
      ),
    ).toThrow(/reason/);
  });

  it('refuses an entry with no module id', () => {
    expect(() =>
      parseReducedDeploymentDeclarations([{ reason: 'a'.repeat(40) }], PATH),
    ).toThrow(/moduleId/);
  });

  it('refuses anything that is not a list of entries at all', () => {
    expect(() => parseReducedDeploymentDeclarations({ admin_users: true }, PATH)).toThrow(
      /array/,
    );
  });
});
