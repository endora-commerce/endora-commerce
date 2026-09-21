import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * The **host's** half of the five payment gateways' admin surfaces — feature
 * 091's Phase 4 batch five, narrowed by feature 134 **W2.2** (**D-262** clause
 * 3) so that the gateways can leave without taking the shell's proof with them.
 *
 * ## The four subjects, and where each of them went
 *
 * An admin test of a departing module is dispositioned by **subject**; it is not
 * carried, not moved wholesale and not deleted wholesale. This file carried all
 * four, for `autopay`, `paypal`, `payu`, `stripe` and `tpay` at once:
 *
 * | subject | where it is now |
 * | --- | --- |
 * | each module's **declaration** — its one route, its gate, its absent nav and zones, and that the lazy page resolves | inside each package, at `src/admin/index.test.ts`, under the package's own `environment: 'node'` config. The shipped precedent is `packages/modules/invoice_ledger/src/admin/index.test.ts` |
 * | each package's own **source hygiene** — no `@/` reach out of the package, no `dictionaryClient`, its own `listCountries` built from the published `apiClient` | the same file in each package, the `readFileSync` over `admin/` becoming a read relative to the package's own sources |
 * | **host hygiene** — `App.tsx`, `AppShell.tsx` and `src/modules.generated.ts` never naming a gateway by hand | **here**, below, and unchanged in substance |
 * | the **rendered** off-state and permission cases | deleted, under W2.3's condition and against the named drivers in the next section |
 *
 * The first two travel because they are answerable with no jsdom, no RTL and no
 * `admin/test/helpers/` — none of which a package may name
 * (`module-test-ownership.md` §3) and none of which is published. The third
 * stays because **an absence assertion about the shell stays true and stays
 * useful after a module goes: what it refuses is a host file *regaining* a paid
 * name**, which is the `carrier-settings.module-owned-surface.test.tsx`
 * precedent, now applied a third time.
 *
 * ## What was deleted, the driver that survives it, and how to read it back
 *
 * Twenty rendered cases went — four per gateway, `describe.each(GATEWAYS)`:
 * *renders the screen while the module is present and the code is held*,
 * *renders the not-found treatment while the module is switched off*, *renders
 * the not-found treatment for an operator holding only the write code*, and
 * *restores the screen when the module comes back, with no rebuild*. They
 * rendered the whole `App` and drove `ModuleRoute`'s `useSurfaceVisibility`
 * gate.
 *
 * W2.3 permits that deletion **only against a module that is staying and still
 * drives the same member of the same mechanism over a real declaration**, named
 * per case. Both named drivers are free modules whose declarations are in this
 * repository:
 *
 *  * `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx`
 *    over **`cms`** and **`blog`** — *renders every one of its screens at its own
 *    route while present*, *contributes no surface while the module is absent
 *    from the platform*, *contributes no surface to an operator without the code
 *    its route enforces* (driven over each module's **own write code**, which is
 *    the near-miss shape the deleted third case used), and *restores both
 *    surfaces when the code is granted again*;
 *  * `admin/test/modules/carts.module-owned-surface.test.tsx` over **`carts`**,
 *    which carries three of the four case titles verbatim and the fourth in the
 *    code-absent spelling.
 *
 * The recovery address for everything deleted here is
 * `git show 7d6b1500b:admin/test/modules/payment-gateway-settings.module-owned-surface.test.tsx`.
 *
 * **What is genuinely lost is stated rather than smuggled**: the *conjunction*
 * over these five modules' **real** declarations. The mechanism keeps real
 * subjects here, and each module's declaration keeps a test — a stronger one,
 * because it now runs in the module's own suite as well. The paid repository
 * holds no admin off-state proof for any module it receives and will hold none
 * until it has an admin test host; that is D-262 clause 3's accepted reduction
 * in the admin half of Constitution XVII item 6's proof, and when it is repaired
 * is the owner's decision. `check:off-state-coverage`'s counter does not measure
 * any of this — its walk root is `backend/test` alone — so a green
 * `switchable=N proven=N findings=0` after this change is not a claim about the
 * admin half.
 *
 * **None of the five contributes a sidebar entry, and none is given one.** That
 * is `specs/091-module-owned-admin-surfaces/` `plan.md`'s Ruling 1: adding a
 * sidebar row to make a test assertable would be a product change bought for a
 * test. The **palette** is the server's answer and is driven in each module's
 * `backend/test/integration/<id>/module-owned-surface-off-state.test.ts`, which
 * is a host file under D-252 and travels to the paid repository's host.
 */

/**
 * The five, identified by id and route — string literals, never specifiers, so
 * that the absences below keep working once the five are installed from
 * tarballs rather than resolved in this workspace.
 */
const GATEWAYS: readonly { readonly id: string; readonly route: string }[] = [
  { id: 'autopay', route: '/settings/autopay' },
  { id: 'paypal', route: '/settings/paypal' },
  { id: 'payu', route: '/settings/payu' },
  { id: 'stripe', route: '/settings/stripe' },
  { id: 'tpay', route: '/settings/tpay' },
];

describe('the shell no longer names any of the five by hand', () => {
  it('has no host route for any of the screens, and none ever had a nav entry', () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    for (const gateway of GATEWAYS) {
      expect(app).not.toContain(`modules/${gateway.id}`);
      expect(app).not.toContain(`path="${gateway.route}"`);
      expect(shell).not.toContain(`to: '${gateway.route}'`);
    }
  });

  it('resolves a module screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into a package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    //
    // **No per-gateway positive assertion.** It named each of the five
    // specifiers until this narrowing; a `toContain` on a specifier that is no
    // longer installed would refuse the extraction rather than report a defect,
    // which is the half `carrier-settings.module-owned-surface.test.tsx` had to
    // drop twice. What is left states the rule over the **whole** generated
    // registry rather than over one entry.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).not.toContain('packages/modules');
    // The registry must not be empty, or the absence above proves nothing: a
    // file that imported nothing at all would pass it.
    expect(registry).toContain("from '@endora-commerce/mod-");
  });
});
