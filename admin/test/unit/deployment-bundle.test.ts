/**
 * SC-004 — an admin built for deployment A holds no code of deployment B
 * (`specs/190-overlay-full-modules/` T045, FR-080, FR-081).
 *
 * Two fixture deployments, each with one overlay admin layer carrying a marker
 * in its declarations and in its lazily imported screen. The registries are
 * rendered by the renderer both trees use, the registry is selected by the
 * function both trees' `vite.config.ts` call, and Vite builds the bundle — so
 * what is asserted is what a build ships, not what a registry file says.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { build, type Rolldown } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDeploymentAdminRegistriesInto } from '@endora-commerce/cli/lib/admin-artefacts.js';
import {
  DEPLOYMENT_ADMIN_ALIAS,
  selectDeploymentAdminRegistry,
} from '@endora-commerce/cli/lib/admin-deployment.js';

let root = '';

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function overlay(deployment: string, marker: string): void {
  const admin = join(root, 'apps', deployment, 'modules', `${deployment}_screens`, 'admin');
  write(
    join(admin, 'index.tsx'),
    `export const contributions = {\n` +
      `  routes: [{ path: '/${marker}', index: true, component: () => import('./Page.js') }],\n` +
      `};\n`,
  );
  write(join(admin, 'Page.tsx'), `export default function Page() { return '${marker}-screen'; }\n`);
}

/** Every chunk's code, joined: what the bundle ships. */
async function bundleFor(deployment: string | null): Promise<string> {
  const adminSourceRoot = join(root, 'admin', 'src');
  const selected = selectDeploymentAdminRegistry({
    adminSourceRoot,
    env: deployment === null ? {} : { DEPLOYMENT: deployment },
    envFile: join(root, '.env'),
    regenerate: 'pnpm run generate',
  });
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    root: join(root, 'admin'),
    resolve: { alias: { [DEPLOYMENT_ADMIN_ALIAS]: selected.path } },
    build: {
      write: false,
      lib: { entry: join(adminSourceRoot, 'main.ts'), formats: ['es'], fileName: 'main' },
    },
  })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
  const outputs = Array.isArray(output) ? output : [output];
  return outputs
    .flatMap((entry) => entry.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deployment-bundle-'));
  overlay('alpha', 'alpha-marker');
  overlay('bravo', 'bravo-marker');
  const adminSourceRoot = join(root, 'admin', 'src');
  write(
    join(adminSourceRoot, 'main.ts'),
    `import { DEPLOYMENT_ADMIN_CONTRIBUTIONS } from '${DEPLOYMENT_ADMIN_ALIAS}';\n` +
      `export const registry = DEPLOYMENT_ADMIN_CONTRIBUTIONS;\n`,
  );
  for (const registry of renderDeploymentAdminRegistriesInto(adminSourceRoot, join(root, 'apps'))) {
    write(registry.outputPath, registry.content);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SC-004 — a deployment bundle holds no other deployment’s overlay code', () => {
  it('builds alpha with alpha’s layer and screen, and nothing of bravo’s', async () => {
    const code = await bundleFor('alpha');
    expect(code).toContain('alpha-marker');
    expect(code).toContain('alpha-marker-screen');
    expect(code).not.toContain('bravo-marker');
  });

  it('builds bravo with bravo’s layer, and nothing of alpha’s', async () => {
    const code = await bundleFor('bravo');
    expect(code).toContain('bravo-marker-screen');
    expect(code).not.toContain('alpha-marker');
  });

  it('builds bare core with neither', async () => {
    const code = await bundleFor(null);
    expect(code).toContain('registry');
    expect(code).not.toContain('alpha-marker');
    expect(code).not.toContain('bravo-marker');
  });
});
