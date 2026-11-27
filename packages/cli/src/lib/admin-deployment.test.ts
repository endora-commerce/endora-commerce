/**
 * Which deployment admin registry an admin build selects (`specs/190-overlay-full-modules/`
 * T044, FR-081, FR-084; `contracts/overlay-admin-layer.md` §3).
 *
 * The selection is one function both trees' `admin/vite.config.ts` call, so the
 * two cannot come to disagree about what an unset, a blank or a missing
 * deployment means.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  adminSingletons,
  DEPLOYMENT_ADMIN_ALIAS,
  DeploymentAdminRegistryError,
  selectDeploymentAdminRegistry,
} from './admin-deployment.js';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** An admin source root holding `none` and `acme` registries, and a root `.env`. */
function tree(envFile: string | null = null): { adminSourceRoot: string; envFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'admin-deployment-'));
  scratch.push(root);
  const adminSourceRoot = join(root, 'admin', 'src');
  mkdirSync(join(adminSourceRoot, 'deployments'), { recursive: true });
  for (const name of ['none', 'acme']) {
    writeFileSync(join(adminSourceRoot, 'deployments', `${name}.generated.ts`), 'export {};\n');
  }
  if (envFile !== null) writeFileSync(join(root, '.env'), envFile);
  return { adminSourceRoot, envFile: join(root, '.env') };
}

const REGENERATE = 'pnpm run generate';

describe('selectDeploymentAdminRegistry', () => {
  it('selects none.generated.ts when DEPLOYMENT is unset everywhere', () => {
    const { adminSourceRoot, envFile } = tree();
    expect(selectDeploymentAdminRegistry({ adminSourceRoot, env: {}, envFile, regenerate: REGENERATE })).toEqual({
      deployment: null,
      path: join(adminSourceRoot, 'deployments', 'none.generated.ts'),
    });
  });

  it('selects the named deployment from the process environment', () => {
    const { adminSourceRoot, envFile } = tree('DEPLOYMENT=other\n');
    expect(
      selectDeploymentAdminRegistry({ adminSourceRoot, env: { DEPLOYMENT: ' acme ' }, envFile, regenerate: REGENERATE }),
    ).toEqual({ deployment: 'acme', path: join(adminSourceRoot, 'deployments', 'acme.generated.ts') });
  });

  it("reads the root .env when the process environment does not set it — the backend's source", () => {
    const { adminSourceRoot, envFile } = tree('PORT=3001\nDEPLOYMENT=acme\n');
    expect(
      selectDeploymentAdminRegistry({ adminSourceRoot, env: {}, envFile, regenerate: REGENERATE }).deployment,
    ).toBe('acme');
  });

  it('treats a blank DEPLOYMENT in the environment as bare core, as Node does over an env file', () => {
    const { adminSourceRoot, envFile } = tree('DEPLOYMENT=acme\n');
    expect(
      selectDeploymentAdminRegistry({ adminSourceRoot, env: { DEPLOYMENT: '  ' }, envFile, regenerate: REGENERATE })
        .deployment,
    ).toBeNull();
  });

  it('refuses a named deployment with no registry, naming the file and the regenerate command', () => {
    const { adminSourceRoot, envFile } = tree();
    const select = (): unknown =>
      selectDeploymentAdminRegistry({ adminSourceRoot, env: { DEPLOYMENT: 'beta' }, envFile, regenerate: REGENERATE });

    expect(select).toThrow(DeploymentAdminRegistryError);
    expect(select).toThrow(/deployments\/beta\.generated\.ts/);
    expect(select).toThrow(/pnpm run generate/);
  });

  it('refuses bare core whose none registry is missing too', () => {
    const { adminSourceRoot, envFile } = tree();
    rmSync(join(adminSourceRoot, 'deployments', 'none.generated.ts'));
    expect(() =>
      selectDeploymentAdminRegistry({ adminSourceRoot, env: {}, envFile, regenerate: REGENERATE }),
    ).toThrow(/none\.generated\.ts/);
  });
});

describe('the alias and the single copies (FR-084)', () => {
  it('names the alias main.tsx imports', () => {
    expect(DEPLOYMENT_ADMIN_ALIAS).toBe('@endora-commerce-deployment/admin');
  });

  it('dedupes React, React DOM, the kit and the shell under the scope', () => {
    expect(adminSingletons()).toEqual([
      'react',
      'react-dom',
      '@endora-commerce/admin-kit',
      '@endora-commerce/admin-shell',
    ]);
    expect(adminSingletons('@acme/')).toContain('@acme/admin-kit');
  });
});
