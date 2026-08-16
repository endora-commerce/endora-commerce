import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';
import { CmsReferenceRegistry } from '../../../src/modules/cms/services/cms-reference-registry.js';
import { EmailDefaultsRegistry } from '../../../src/modules/transactional_emails/services/email-defaults-registry.js';
import { registerCmsAssetReferences } from '../../../src/modules/cms/services/asset-references.js';
import { registerCatalogAssetReferences } from '../../../src/modules/catalog/services/asset-references.js';
import { registerBlogAssetReferences } from '../../../src/modules/blog/services/blog-asset-references.js';
import { registerMegamenuAssetReferences } from '../../../src/modules/megamenu/services/asset-references.js';
import { registerMegamenuCmsReferences } from '../../../src/modules/megamenu/services/cms-references.js';
import type { MegamenuReferenceRegistry } from '../../../src/modules/megamenu/services/megamenu-reference-registry.js';

/**
 * The contribution seam (feature 072, D-39).
 *
 * > A registration whose whole contract is "add an inert descriptor to a table
 * > the host walks later" is `ctx.di.register` and is **never** gated. A
 * > registration that computes, decides, decrypts, sends or charges is a
 * > `providePort` and fails closed.
 * >
 * > The host records the contributing module id on every entry, and states **per
 * > registry** whether an entry is honoured while its owner is absent. Default:
 * > not honoured. Honouring it requires a written reason.
 *
 * Two halves are pinned here, and the third — that the platform still boots with
 * a host switched off — is `test/integration/kernel/deactivated-boot.test.ts`,
 * where it costs no extra composition.
 *
 *  1. **Ungated.** Source-level, like `module-owned-contributions.test.ts`: the
 *     four names are `ctx.di.register` and not `ctx.di.providePort`. The
 *     behavioural seams beside them stay ports, so this is not "the gate was
 *     inconvenient" — the same files still gate what sends and what decrypts.
 *  2. **Owner recorded, policy stated.** Every entry names its contributor, and
 *     each registry enumerates by the policy its own doc comment declares. All
 *     four honour; the reasons are written at the class and are load-bearing
 *     rather than decorative, so the assertions below phrase the property as
 *     "an absent owner's entry is still returned" — a future skip filter added
 *     without changing the stated policy fails here.
 */

const backendRoot = fileURLToPath(new URL('../../../', import.meta.url));

function backendSource(moduleId: string): string {
  return readFileSync(`${backendRoot}src/modules/${moduleId}/backend.ts`, 'utf8');
}

/** Whitespace-insensitive, so a reformat is not a wiring change. */
function flat(source: string): string {
  return source.replace(/\s+/g, '');
}

/** Never called: every assertion below reads registry bookkeeping, not the database. */
const noEm = (): EntityManager => {
  throw new Error('this test must not reach the database');
};

const SEAMS: ReadonlyArray<{ readonly owner: string; readonly name: string }> = [
  { owner: 'transactional_emails', name: 'emailDefaultsPort' },
  { owner: 'assets_library', name: 'assetReferenceRegistry' },
  { owner: 'cms', name: 'cmsReferenceRegistry' },
  { owner: 'megamenu', name: 'megamenuReferenceRegistry' },
];

/**
 * Behavioural seams in the same file, so "ungated" is a distinction rather than
 * a policy: `transactional_emails` gives away its registry and keeps the gate on
 * everything that sends.
 */
const STILL_PORTS: ReadonlyArray<{ readonly owner: string; readonly name: string }> = [
  { owner: 'transactional_emails', name: 'templateEmailPort' },
  { owner: 'transactional_emails', name: 'transactionalEmailSenderAccessor' },
  { owner: 'transactional_emails', name: 'emailBrandingAccessor' },
];

describe('D-39 — a contribution registry is registered, not provided as a port', () => {
  it.each(SEAMS)('$owner registers $name with ctx.di.register', ({ owner, name }) => {
    expect(flat(backendSource(owner))).toContain(flat(`${name}: ctx`));
  });

  it.each(SEAMS)('$owner does not gate $name', ({ owner, name }) => {
    // A gated port throws `MODULE_DISABLED` on resolution, and every one of
    // these names is resolved from a `ctx.onBoot` hook — which runs whatever the
    // module's effective state is. Gating one turns an operator's supported
    // off-switch into a backend that will not start.
    expect(flat(backendSource(owner))).not.toContain(flat(`providePort('${name}'`));
  });

  it.each(STILL_PORTS)('$owner still provides $name as a gated port', ({ owner, name }) => {
    expect(flat(backendSource(owner))).toContain(flat(`providePort('${name}'`));
  });
});

/**
 * The other wiring a contribution seam takes in this tree: a **process
 * singleton a contributor imports** and pushes into, rather than a container
 * name it resolves. The payment family is wired that way, and the hazard is
 * identical — an entry that outlives the module that pushed it — so the same
 * requirement holds: the entry names its contributor and the host states what
 * it does with an absent one.
 *
 * What is pinned here is the half a class-level test cannot see. Each class
 * takes its presence probe as a constructor argument and defaults it to
 * always-present, so a class that skips perfectly still skips *nothing* in
 * production unless the singleton is given the kernel's effective state. That
 * wiring is one line, in one file per module, and it is the line that makes the
 * stated policy real.
 */
const IMPORTED_SEAMS: ReadonlyArray<{ readonly owner: string; readonly name: string }> = [
  { owner: 'payments', name: 'gatewayRefundRegistry' },
  { owner: 'payment_methods', name: 'paymentAdapterRegistry' },
  { owner: 'delivery_methods', name: 'shippingAdapterRegistry' },
];

describe('the imported contribution seams carry the presence probe', () => {
  it.each(IMPORTED_SEAMS)('$owner wires $name to the kernel effective state', ({ owner, name }) => {
    const source = readFileSync(
      `${backendRoot}src/modules/${owner}/services/registry-singleton.ts`,
      'utf8',
    );
    expect(source).toContain(`export const ${name}`);
    expect(flat(source)).toContain(flat('effectiveState.isPresent(moduleId)'));
  });
});

describe('EmailDefaultsRegistry — owner recorded, entries honoured', () => {
  it('records the contributing module on every entry', () => {
    const registry = new EmailDefaultsRegistry();
    registry.register('order_confirmation', { defaultSubject: {}, defaultContent: {} }, 'orders');
    registry.register('invoice_issued', { defaultSubject: {}, defaultContent: {} }, 'invoices');

    expect([...registry.owners()]).toEqual([
      ['order_confirmation', 'orders'],
      ['invoice_issued', 'invoices'],
    ]);
    expect(registry.ownerOf('order_confirmation')).toBe('orders');
  });

  it('still answers for a code whose owner is switched off', () => {
    // Honoured, and the reason is written at the class: the definition row is
    // created from the platform axis regardless, so skipping the defaults would
    // not remove the row — it would create it with an empty subject and an empty
    // content envelope. An activation flip must not rewrite persisted content.
    const registry = new EmailDefaultsRegistry();
    const defaults = { defaultSubject: { 'en-US': 'Your order' }, defaultContent: {} };
    registry.register('order_confirmation', defaults, 'orders');

    expect(registry.has('order_confirmation')).toBe(true);
    expect(registry.get('order_confirmation')).toBe(defaults);
  });
});

describe('AssetReferenceRegistry — owner recorded, entries honoured', () => {
  it('records the contributing module of all eight descriptors', () => {
    const registry = new AssetReferenceRegistry();
    registerCatalogAssetReferences(registry, noEm);
    registerCmsAssetReferences(registry, noEm);
    registerBlogAssetReferences(registry, noEm);
    registerMegamenuAssetReferences(registry, noEm);

    expect(registry.owners()).toEqual([
      'catalog',
      'catalog',
      'catalog',
      'catalog',
      'cms',
      'blog',
      'blog',
      'megamenu',
    ]);
  });

  it('consults a descriptor whose owner is absent', async () => {
    // Referential integrity, not a surface: a switched-off `blog` still owns
    // posts that embed the asset, so skipping its scanner would let an operator
    // delete an asset that comes back broken when `blog` is switched on again.
    const registry = new AssetReferenceRegistry();
    registry.register({
      ownerModuleId: 'blog',
      findReferences: async () => [
        { kind: 'blog_post_content' as const, entityId: 'p1', label: 'A post' },
      ],
    });

    await expect(registry.findReferences('asset-1')).resolves.toEqual([
      { kind: 'blog_post_content', entityId: 'p1', label: 'A post' },
    ]);
  });
});

describe('CmsReferenceRegistry — owner recorded, external scanners honoured', () => {
  it('records the contributing module of the external scanner', () => {
    const registry = new CmsReferenceRegistry(noEm);
    registerMegamenuCmsReferences(registry, {} as MegamenuReferenceRegistry);

    expect(registry.externalOwners()).toEqual(['megamenu']);
  });

  it('consults an external scanner whose owner is absent', async () => {
    // Same reason as the asset registry: the menu items still hold the
    // reference, so a page deleted while `megamenu` is off comes back pointing
    // at nothing. A confusing 409 beats a broken link.
    const registry = new CmsReferenceRegistry(noEm);
    registry.register({
      ownerModuleId: 'megamenu',
      findPageReferences: async () => [
        { kind: 'megamenu', entityId: 'm1', label: 'Megamenu "Main"' },
      ],
    });

    await expect(registry.findPageReferences('page-1')).resolves.toEqual([
      { kind: 'megamenu', entityId: 'm1', label: 'Megamenu "Main"' },
    ]);
  });
});
