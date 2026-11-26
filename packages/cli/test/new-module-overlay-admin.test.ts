/**
 * `endora new module --admin <section>` and `--action <id>=<route>` inside an
 * instance (`specs/190-overlay-full-modules/` T048, FR-059; `contracts/overlay-cli.md`
 * §1).
 *
 * Both were refused while an overlay module was in no admin registry. Since
 * #1855 an overlay module's `admin/index.tsx` is in its deployment's registry, so
 * the flags write the fixed files of FR-004 — the layer, its screen, the
 * manifest's palette action and both bundles' keys — and the backend registers
 * the gated route each screen reads. Every case runs over an instance on disk,
 * and the last goes on to `endora generate`, which renders the registry and
 * judges the palette over what was written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { generatePaletteRefusal, runGenerate } from '../src/generate/index.js';
import { runNewModule, type NewModuleOptions } from '../src/new-module/index.js';
import { cleanInstances, instance, SCOPE, write } from './support/overlay-instance.js';

afterEach(cleanInstances);

const NOTICE: NewModuleOptions = {
  id: 'store_notice',
  name: 'Store notice',
  description: 'A short notice the shop owner writes.',
  permissions: ['store_notice:read=View the store notice'],
};

const moduleDir = (root: string): string => join(root, 'apps', 'acme', 'modules', 'store_notice');
const read = (root: string, path: string): string => readFileSync(join(moduleDir(root), path), 'utf8');
const bundle = (root: string, language: string): Record<string, string> =>
  JSON.parse(read(root, `i18n/${language}.json`)) as Record<string, string>;

describe('--admin <section> writes the fixed admin layer of an overlay module', () => {
  it('writes admin/index.tsx and its screen, under the instance scope', async () => {
    const root = instance();
    const result = await runNewModule({ ...NOTICE, admin: 'catalog', cwd: root });

    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['admin/index.tsx', 'admin/pages/StoreNoticePage.tsx']),
    );
    const layer = read(root, 'admin/index.tsx');
    expect(layer).toContain(`import type { AdminContributions } from '${SCOPE}/admin-kit/contributions';`);
    expect(layer).toContain("const ROUTE_PATH = '/store-notice';");
    expect(layer).toContain("component: () => import('./pages/StoreNoticePage.js'),");
    expect(layer).toContain('index: true,');
    expect(layer).toContain("section: 'catalog',");
    expect(layer).toContain("requiredPermission: 'store_notice:read',");
    const page = read(root, 'admin/pages/StoreNoticePage.tsx');
    expect(page).toContain(`from '${SCOPE}/admin-kit/ui'`);
    expect(page).toContain("'/api/v1/admin/store-notice'");
  });

  it('labels the sidebar entry and the screen in both bundles', async () => {
    const root = instance();
    await runNewModule({ ...NOTICE, admin: 'catalog', cwd: root });
    for (const language of ['en', 'pl']) {
      expect(bundle(root, language)).toMatchObject({
        'nav.storeNotice.label': 'Store notice',
        'admin.title': 'Store notice',
        'admin.loading': expect.any(String),
        'adminRoles.permission.store_notice:read': 'View the store notice',
      });
    }
  });

  it('tells the author the screen needs a palette action until one is declared', async () => {
    const root = instance();
    const result = await runNewModule({ ...NOTICE, admin: 'catalog', cwd: root });
    expect(result.nextSteps.join('\n')).toContain('--action');
  });
});

describe('--action <id>=<route> declares a palette action the manifest validator accepts', () => {
  it('declares it under the gating permission, keyed in both bundles, and registers its route', async () => {
    const root = instance();
    await runNewModule({ ...NOTICE, actions: ['open-notice=/store-notice'], cwd: root });

    const loaded = (await import(pathToFileURL(join(moduleDir(root), 'manifest.ts')).href)) as {
      manifest: { actions?: ReadonlyArray<Record<string, unknown>> };
    };
    expect(loaded.manifest.actions).toEqual([
      expect.objectContaining({
        id: 'open-notice',
        labelKey: 'actions.openNotice.label',
        descriptionKey: 'actions.openNotice.description',
        targetRoute: '/store-notice',
        requiredPermission: 'store_notice:read',
      }),
    ]);
    for (const language of ['en', 'pl']) {
      expect(Object.keys(bundle(root, language))).toEqual(
        expect.arrayContaining(['actions.openNotice.label', 'actions.openNotice.description']),
      );
    }
    expect(read(root, 'backend.ts')).toContain("'/api/v1/admin/store-notice'");
  });

  it('registers a gated admin route per action target, and mounts the screen on the first', async () => {
    const root = instance();
    await runNewModule({
      ...NOTICE,
      admin: 'catalog',
      actions: ['open-notices=/notices', 'new-notice=/notices/new'],
      cwd: root,
    });
    const backend = read(root, 'backend.ts');
    expect(backend).toContain("'/api/v1/admin/notices'");
    expect(backend).toContain("'/api/v1/admin/notices/new'");
    expect(backend).not.toContain("'/api/v1/admin/store-notice'");
    expect(read(root, 'admin/index.tsx')).toContain("const ROUTE_PATH = '/notices';");
  });
});

describe('what the flags write is what endora generate composes', () => {
  /** The instance with an admin member, as `endora new instance` writes one. */
  function withAdminMember(): string {
    const root = instance();
    write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - backend\n  - admin\n');
    write(join(root, 'admin', 'package.json'), JSON.stringify({ name: 'acme-shop-admin' }));
    write(
      join(root, 'admin', 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
    );
    return root;
  }

  it('--admin with --action: in the deployment registry, palette clean', async () => {
    const root = withAdminMember();
    await runNewModule({ ...NOTICE, admin: 'catalog', actions: ['open-notice=/store-notice'], cwd: root });

    const result = await runGenerate({ cwd: root });
    expect(readFileSync(join(root, 'admin', 'src', 'deployments', 'acme.generated.ts'), 'utf8')).toContain(
      "from '../../../apps/acme/modules/store_notice/admin/index.js'",
    );
    expect(generatePaletteRefusal(result)).toBeNull();
  });

  it('--admin alone: generate writes the registry and then refuses the uncovered landing route', async () => {
    const root = withAdminMember();
    await runNewModule({ ...NOTICE, admin: 'catalog', cwd: root });

    const refusal = generatePaletteRefusal(await runGenerate({ cwd: root }));
    expect(refusal).toContain('store_notice: landing route /store-notice has no palette action');
  });
});
