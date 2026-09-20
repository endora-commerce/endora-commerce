import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
 * `dhl_parcel` and `inpost` own their admin surfaces — feature 091's Phase 4
 * batch five, and the batch's **carrier pair**.
 *
 * ## Both carriers left with wave 1, and what is left here is the shell's half
 *
 * `specs/134-paid-module-extraction/` **T035** took `inpost` and **T036** took
 * `dhl_parcel`. This file has **two owners and therefore none** (ownership §1,
 * §1.1), so it never moved into either package — that much was ruled on 2026-09-19
 * and is unchanged. What the extraction changes is that **neither** subject is in
 * this tree, and the treatment is **ruling α**'s: whatever this file asserted about
 * a carrier's **own declaration** goes with that carrier, and whatever it asserts
 * about the **host's** machinery stays.
 *
 * ## The `describe.each(CARRIERS)` block is gone, and this is the argument, not an omission
 *
 * T035 wrote down what T036 had to decide: *"T036 empties `CARRIERS`, and it must
 * not answer that by narrowing this file to nothing. … the question becomes whose
 * the proof is — a stand-in contributor here, or a free module's zone test that
 * already has one … What it may not be is quietly deleted."*
 *
 * It is not quietly deleted; it is deleted for the reason this file's own previous
 * revision gave when it refused a hand-written `inpost` entry: *"Adding a
 * hand-written `inpost` entry beside it would have driven the same host code over a
 * literal written in this file, which is duplication rather than coverage."* With
 * the second carrier gone that sentence applies to the whole block.
 *
 * **And the host machinery it drove is proved elsewhere over real declarations that
 * stay, which was measured rather than assumed.** Its five cases were
 * `App.tsx`'s `ModuleRoute` gating a contributed route on presence and on
 * permission, and the screen coming back with no rebuild. **22** sibling
 * `*.module-owned-surface.test.tsx` files render the whole `App` and assert the
 * admin's own `app.notFound` treatment; `admin/test/modules/carts.module-owned-surface.test.tsx`
 * carries the same four case titles **verbatim** over
 * `@endora-commerce/mod-carts/admin` — a **free** module whose declaration is still
 * in this repository. So the gate keeps a real subject here; only this file's
 * subject left.
 *
 * The two cases that were genuinely a carrier's own — *"declares one lazily-loaded
 * route, one gate, no nav entry and its zones"* and the `@/`-reach assertion read
 * off the package's own source — have no subject in this repository at all and are
 * asked in the paid one.
 *
 * ## What stays, and why it is still worth running
 *
 * The `describe` below is untouched in substance and keeps naming both carriers:
 * **an absence assertion about the shell stays true and stays useful after a module
 * goes, because what it refuses is a *host file naming a paid module*, and the shell
 * can regain one.** The two positive `toContain` halves are the ones that had to go
 * as each package left — a positive assertion on a specifier that is no longer
 * installed refuses the extraction rather than reporting a defect — and the rule
 * they stated survives in `not.toContain('packages/modules')`, which is the half
 * that keeps working whatever the installed population is.
 *
 * ## The original reason the two were one file
 *
 * They are one file because they are one repair.
 * `backend/scripts/ledgers/cross-module-imports/orders.ts` recorded both
 * reaches and said so in the `inpost` entry: *"both carriers are one shipment
 * tab reaching two adapters, so the Phase 4 batch that moves this consumer
 * takes both or neither; a repair naming one is a repair that has not
 * understood the shape"*. `orders`' `OrderShipmentsTab.tsx`
 * imported `dhlParcelAdminClient` for the label, the handover protocol and the
 * courier booking, and `inpostAdminClient` for the label path. Batch five drained
 * both by having `orders` build those four calls itself, in
 * `orders/api/carrier-documents-client.ts`; **P7d finished it and deleted that file**,
 * because each carrier gained a zone to contribute to and took its own buttons —
 * and its own `apiClient` calls — home. So `orders` names neither carrier and both
 * ledger entries are deleted, which is what the last case below asserts.
 *
 * **Neither module contributed a sidebar entry, and neither was given one.**
 * That is `plan.md`'s Ruling 1 applied: the off-state test's subject is the
 * **route**, which `App.tsx`'s `ModuleRoute` gates on `useSurfaceVisibility` —
 * presence *and* permission — rendering the admin's own unknown-path answer. A
 * hidden route is what an operator following a stale deep link meets; a sidebar
 * that omits an entry is not evidence that a screen is unreachable. Adding a
 * sidebar row to two carrier settings screens that have never had one would be a
 * product change bought to make a test assertable.
 *
 * The **palette** — the third surface Constitution XVII item 5 lists — is the
 * server's answer, and for both carriers it is now the paid repository's
 * `host/backend/test/modules/<id>/module-owned-surface-off-state.test.ts`, the same
 * file under **D-252**: it composes a server from the host's install, so it is the
 * host's wherever it sits.
 */

describe('the shell no longer names either carrier by hand', () => {
  it('has no host route for either screen, and neither ever had a nav entry', () => {
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('DhlParcelSettingsPage');
    expect(app).not.toContain('InpostSettingsPage');
    expect(app).not.toContain('modules/dhl_parcel');
    expect(app).not.toContain('modules/inpost');
    expect(shell).not.toContain("to: '/settings/inpost'");
    expect(shell).not.toContain("to: '/delivery-methods/dhl-parcel'");
  });

  it('names this module nowhere in the shell — the `/settings/dhl-parcel` redirect included', () => {
    // **This assertion was inverted by feature 134's wave 1, and the inversion is
    // the finding rather than a consequence.** It read
    // `expect(app).toContain('path="/settings/dhl-parcel"')` and was titled
    // *"keeps the redirect, which is the admin application"* — a `<Navigate>` for
    // deep links predating the screen's move, counted as the host's own because
    // its element comes from `react-router-dom` rather than from a surface
    // directory.
    //
    // That is true about the **element** and says nothing about the
    // **destination**, which `dhl_parcel` alone declares. So the shell held a
    // route that cannot outlive this module being absent — W1's refusal, *a host
    // file may not name a route only a module declares* — and the old assertion
    // was **pinning the coupling in place**: the merge request that removed the
    // route would have reded here and looked like the mistake.
    //
    // Re-pointing it at a host-declared destination was refused: `/delivery-methods`
    // lists no DHL in an instance that does not install this module, so an operator
    // asking for DHL settings would land somewhere plausible and wrong, which is
    // harder to diagnose than an absent route. If the legacy path is wanted, the
    // module declares the redirect in its own admin layer and both ends travel
    // together — which is what T036 did **not** do, and deliberately: the option
    // `packages/modules/dhl_parcel/src/admin/index.ts` left open for the extraction
    // merge request is an option rather than an obligation, because nothing
    // measures how many deep links still point at the old path.
    //
    // Asserted as an absence in **both** spellings, so the route cannot come back
    // by either half.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    expect(app).not.toContain('path="/settings/dhl-parcel"');
    expect(app).not.toContain('to="/delivery-methods/dhl-parcel"');
  });

  it('resolves a module screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into a package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    //
    // **No positive assertion since wave 1 finished.** It named `mod-inpost` until
    // T035 and `mod-dhl-parcel` until T036; neither is installed here any more, so a
    // `toContain` on either specifier would refuse the extraction rather than report
    // a defect. What is left is the half that actually states the rule, and it states
    // it over the **whole** generated registry rather than over one entry — every
    // module admin surface in the tree, not just a carrier's.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).not.toContain('packages/modules');
    // The registry must not be empty, or the absence above proves nothing: a file
    // that imported nothing at all would pass it.
    expect(registry).toContain("from '@endora-commerce/mod-");
  });

  it('leaves orders reaching neither carrier package', () => {
    // The drain, asserted where it was paid. `OrderShipmentsTab.tsx` named both
    // adapters' admin clients and now names its own, so the two ledger entries
    // in `backend/scripts/ledgers/cross-module-imports/orders.ts` are deleted
    // rather than re-keyed. Deleting the entries without this assertion would
    // leave nothing in the tree saying the coupling is gone.
    // Re-keyed by feature 091's Phase 4 batch 15, not re-scoped: `orders` took
    // its admin surface into its own package and this file went with it. A
    // batch that moved the file and left the old address here would have
    // thrown `ENOENT` rather than reporting a coupling — this ledger is one
    // *about* the file rather than one of them, so the merge request that
    // moves it is structurally the one that cannot see it go stale.
    const tab = sourceOf(
      '../packages/modules/orders/src/admin/components/OrderShipmentsTab.tsx',
    );
    expect(tab).not.toContain('modules/dhl_parcel');
    expect(tab).not.toContain('modules/inpost');
    expect(tab).not.toContain('@endora-commerce/mod-dhl-parcel');
    expect(tab).not.toContain('@endora-commerce/mod-inpost');
    // **This line asserted the client file until P7d**, which is the half of
    // the drain batch five could pay: `orders` built the calls itself rather
    // than importing a carrier's client. P7d gave both carriers a place to
    // contribute to, so the calls went home and the file went with them — the
    // exit its own header ruled for when it said *"both carriers are one
    // shipment tab reaching two adapters"*.
    // The import, not the word: the file's own header still cites the client by
    // name to say where those calls went, which is the record this assertion
    // exists to keep rather than something to scrub.
    expect(tab).not.toContain("from './api/carrier-documents-client'");
    expect(tab).not.toContain('carrierDocumentsClient');
    expect(
      existsSync(
        resolve(
          process.cwd(),
          '../packages/modules/orders/src/admin/api/carrier-documents-client.ts',
        ),
      ),
    ).toBe(false);
    expect(tab).toContain('name="order.shipment.row.actions"');
    expect(tab).toContain('name="order.shipments.tab.actions"');
  });
});
