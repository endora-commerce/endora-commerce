/**
 * The per-deployment admin registries and the overlay half of the stylesheet
 * enumeration (`specs/190-overlay-full-modules/` T040, FR-080, FR-082;
 * `contracts/overlay-admin-layer.md` §2).
 *
 * One renderer for both trees: this repository's `composer:generate` and an
 * instance's `endora generate` both call it, over `backend/src/apps` and `apps`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BARE_CORE_DEPLOYMENT_REGISTRY,
  collectDeploymentAdminLayers,
  collectOverlayAdminSources,
  DeploymentAdminLayerError,
  deploymentRegistryFileName,
  emitDeploymentAdminRegistry,
  emitTailwindRegistry,
  renderDeploymentAdminRegistriesInto,
} from './admin-artefacts.js';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** A tree with `apps/` and an admin source root, as both hosts have. */
function tree(): { root: string; apps: string; adminSrc: string } {
  const root = mkdtempSync(join(tmpdir(), 'deployment-admin-'));
  scratch.push(root);
  return { root, apps: join(root, 'apps'), adminSrc: join(root, 'admin', 'src') };
}

function overlay(apps: string, deployment: string, id: string, admin: boolean): void {
  const dir = join(apps, deployment, 'modules', id);
  write(join(dir, 'manifest.ts'), `export const manifest = { id: '${id}' };\n`);
  if (admin) write(join(dir, 'admin', 'index.tsx'), 'export const contributions = {};\n');
}

describe('collectDeploymentAdminLayers', () => {
  it('lists every deployment on disk, and in each the modules that ship admin/index.tsx, sorted', () => {
    const { apps } = tree();
    overlay(apps, 'beta', 'zeta_screens', true);
    overlay(apps, 'beta', 'alpha_screens', true);
    overlay(apps, 'beta', 'no_screens', false);
    overlay(apps, 'acme', 'acme_board', true);
    overlay(apps, 'bare', 'headless', false);
    mkdirSync(join(apps, '.hidden', 'modules', 'x', 'admin'), { recursive: true });

    const layers = collectDeploymentAdminLayers(apps);

    expect([...layers.keys()]).toEqual(['acme', 'bare', 'beta']);
    expect(layers.get('bare')).toEqual([]);
    expect(layers.get('beta')!.map((layer) => layer.moduleId)).toEqual(['alpha_screens', 'zeta_screens']);
    expect(layers.get('acme')![0]).toEqual({
      deployment: 'acme',
      moduleId: 'acme_board',
      directory: join(apps, 'acme', 'modules', 'acme_board', 'admin'),
      entry: join(apps, 'acme', 'modules', 'acme_board', 'admin', 'index.tsx'),
    });
  });

  it('is empty when there is no apps/ at all', () => {
    const { apps } = tree();
    expect(collectDeploymentAdminLayers(apps).size).toBe(0);
  });

  it('refuses an admin/ that holds index.ts rather than the fixed index.tsx', () => {
    const { apps } = tree();
    overlay(apps, 'acme', 'acme_board', false);
    write(join(apps, 'acme', 'modules', 'acme_board', 'admin', 'index.ts'), 'export {};\n');

    expect(() => collectDeploymentAdminLayers(apps)).toThrow(DeploymentAdminLayerError);
    expect(() => collectDeploymentAdminLayers(apps)).toThrow(/admin\/index\.tsx/);
  });

  it('refuses a deployment named like the bare-core registry', () => {
    const { apps } = tree();
    overlay(apps, BARE_CORE_DEPLOYMENT_REGISTRY, 'x_board', true);

    expect(() => collectDeploymentAdminLayers(apps)).toThrow(/none\.generated\.ts/);
  });
});

describe('emitDeploymentAdminRegistry', () => {
  it('imports each layer by relative path, sorted by module id, under the one export name', () => {
    const content = emitDeploymentAdminRegistry('acme', [
      { moduleId: 'zeta', specifier: '../../../apps/acme/modules/zeta/admin/index.js' },
      { moduleId: 'alpha', specifier: '../../../apps/acme/modules/alpha/admin/index.js' },
    ]);

    expect(content).toContain(
      "import { contributions as contributions0 } from '../../../apps/acme/modules/alpha/admin/index.js';",
    );
    expect(content).toContain(
      "import { contributions as contributions1 } from '../../../apps/acme/modules/zeta/admin/index.js';",
    );
    expect(content.indexOf("moduleId: 'alpha'")).toBeLessThan(content.indexOf("moduleId: 'zeta'"));
    expect(content).toContain('export const DEPLOYMENT_ADMIN_CONTRIBUTIONS: readonly AdminRegistryEntry[] = [');
    expect(content).toContain("import type { AdminRegistryEntry } from '../modules.generated.js';");
  });

  it('renders bare core as an empty list with the same export', () => {
    const content = emitDeploymentAdminRegistry(null, []);

    expect(content).toContain('export const DEPLOYMENT_ADMIN_CONTRIBUTIONS: readonly AdminRegistryEntry[] = [\n];');
    expect(content).not.toMatch(/import \{ contributions/);
  });

  it('takes the header as a parameter, as the core registry does', () => {
    expect(emitDeploymentAdminRegistry(null, [], '// HEADER\n').startsWith('// HEADER\n')).toBe(true);
  });
});

describe('renderDeploymentAdminRegistriesInto', () => {
  it('renders one registry per deployment on disk plus none, each holding only its own layers', () => {
    const { apps, adminSrc } = tree();
    overlay(apps, 'acme', 'acme_board', true);
    overlay(apps, 'beta', 'beta_board', true);
    overlay(apps, 'bare', 'headless', false);

    const rendered = renderDeploymentAdminRegistriesInto(adminSrc, apps);

    expect(rendered.map((artefact) => artefact.outputPath)).toEqual([
      join(adminSrc, 'deployments', deploymentRegistryFileName(null)),
      join(adminSrc, 'deployments', 'acme.generated.ts'),
      join(adminSrc, 'deployments', 'bare.generated.ts'),
      join(adminSrc, 'deployments', 'beta.generated.ts'),
    ]);
    const [none, acme, bare, beta] = rendered.map((artefact) => artefact.content);
    expect(none).not.toContain('/apps/');
    expect(bare).not.toContain('/apps/');
    expect(acme).toContain("from '../../../apps/acme/modules/acme_board/admin/index.js'");
    expect(acme).not.toContain('beta_board');
    expect(beta).toContain("from '../../../apps/beta/modules/beta_board/admin/index.js'");
    expect(beta).not.toContain('acme_board');
    expect(rendered.map((artefact) => artefact.modules)).toEqual([0, 1, 0, 1]);
  });

  it('renders only none when no deployment is on disk', () => {
    const { apps, adminSrc } = tree();
    expect(renderDeploymentAdminRegistriesInto(adminSrc, apps).map((a) => a.deployment)).toEqual([null]);
  });
});

describe('the overlay half of the stylesheet enumeration (FR-082)', () => {
  it('names one @source per overlay admin layer of every deployment on disk, relative to the artefact', () => {
    const { apps, adminSrc } = tree();
    overlay(apps, 'beta', 'beta_board', true);
    overlay(apps, 'acme', 'acme_board', true);
    overlay(apps, 'acme', 'headless', false);

    expect(collectOverlayAdminSources(adminSrc, apps)).toEqual([
      '../../apps/acme/modules/acme_board/admin',
      '../../apps/beta/modules/beta_board/admin',
    ]);
  });

  it('writes the @source lines after the package imports', () => {
    const content = emitTailwindRegistry(
      [{ name: '@x/mod-blog', specifier: '@x/mod-blog/tailwind.css' }],
      undefined,
      [],
      ['../../apps/acme/modules/acme_board/admin'],
    );

    expect(content).toContain('@source "../../apps/acme/modules/acme_board/admin";');
    expect(content.indexOf('@import "@x/mod-blog/tailwind.css";')).toBeLessThan(
      content.indexOf('@source "../../apps/acme'),
    );
  });

  it('renders the bytes it rendered before when no overlay ships an admin layer', () => {
    const entries = [{ name: '@x/mod-blog', specifier: '@x/mod-blog/tailwind.css' }];
    expect(emitTailwindRegistry(entries, undefined, [], [])).toBe(emitTailwindRegistry(entries));
  });
});
