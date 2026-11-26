import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { runInstallCommand } from './install.js';
import type { OperatorRuntime } from './operator-runtime.js';

/**
 * `specs/187-side-table-extensions/` T028 (FR-004, US2 scenario 3) — an
 * arriving package whose side-table host is owned by a module outside its
 * dependency closure is refused by `module:install` with
 * `host-not-a-dependency` and exit 65, before anything is opened — so before any
 * migration runs. The runtime's `resources` throws, which is what says so.
 */
const organizations = defineModuleManifest({ id: 'organizations', name: 'o', version: '1.0.0', dependencies: [] });
const blog = defineModuleManifest({ id: 'blog', name: 'b', version: '1.0.0', dependencies: [] });
const acmeLinks = (dependencies: string[]): ModuleManifest =>
  defineModuleManifest({
    id: 'acme_links',
    name: 'Acme links',
    version: '1.0.0',
    dependencies,
    extends: [{ entity: 'organizations.Organization', table: 'acme_links_organization_refs' }],
  });

function runtimeOver(manifests: readonly ModuleManifest[]): { rt: OperatorRuntime; err: string[] } {
  const err: string[] = [];
  return {
    err,
    rt: {
      resources: () => {
        throw new Error('the refusal must come before anything is opened');
      },
      entries: manifests.map((manifest) => ({
        manifest,
        filePath: `/instance/node_modules/${manifest.id}/package.json`,
        origin: manifest.id === 'acme_links' ? 'package' : 'core',
      })),
      out: () => {},
      err: (line: string) => err.push(line),
    } as unknown as OperatorRuntime,
  };
}

describe('module:install — a side-table declaration whose host is not a dependency', () => {
  it('is refused with host-not-a-dependency and exit 65, naming the module and the host owner', async () => {
    const { rt, err } = runtimeOver([organizations, blog, acmeLinks(['blog'])]);
    expect(await runInstallCommand(['acme_links'], rt)).toBe(65);
    const text = err.join('');
    expect(text).toContain('host-not-a-dependency');
    expect(text).toContain('module "acme_links" (package)');
    expect(text).toContain('"organizations"');
  });

  it('refuses --all too, before planning anything', async () => {
    const { rt } = runtimeOver([organizations, acmeLinks([])]);
    expect(await runInstallCommand(['--all', '--dry-run'], rt)).toBe(65);
  });

  it('plans the same install once the host owner is a dependency (the red proof’s other half)', async () => {
    const { rt } = runtimeOver([organizations, acmeLinks(['organizations'])]);
    expect(await runInstallCommand(['acme_links', '--dry-run'], rt)).toBe(0);
  });
});
