import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Feature 091, P6 — the nine cross-module admin reaches that take the **client
 * exit**.
 *
 * Nine callers imported another module's admin API client for one `GET` each.
 * A client is the owner's **code**, which is what
 * `backend/scripts/ledgers/cross-module-imports/` recorded; an HTTP path plus a
 * response type out of `@endora-commerce/contracts` — a package both sides
 * already compile — is not
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` R6).
 * So each caller rebuilds its own request and neither endpoint moves. That is
 * the exit P2 landed and batch five repeated for five payment gateways.
 *
 * **Why this file asserts source text rather than only behaviour.**
 * `check:module-boundary` is the structural ratchet and it is two-way: the nine
 * keys are gone, so the reach coming back fails the build. What that check
 * cannot see is the **request** — it reads import specifiers, and a caller that
 * rebuilds `/api/v1/admin/dictionary/languages` as `/api/v1/admin/languages`
 * clears every boundary rule while fetching nothing. That is the one defect
 * this repair can introduce, so it is the one this file measures, at the
 * granularity where it can happen: the endpoint each caller now names. It is
 * the shape `payment-gateway-settings.module-owned-surface.test.tsx` uses for
 * the same repair, for the same reason.
 *
 * The behavioural half lives where each caller already had a test —
 * `components/IdleLogout.test.tsx`, `sales_channels/ChannelIdentityForm.theme
 * .test.tsx`, the three `settings/SettingsPage.*` files and
 * `orders/OrderStatusConfigPage.test.tsx` — each of which mocks the seam the
 * caller actually uses. Since feature 091's batch 10 that is two spellings of
 * one module: `@/lib/api-client` for a caller in `admin/src`, and
 * `@endora-commerce/admin-kit/lib` for one inside a module package, where the
 * `@/` alias resolves to nothing. Mocking the shim would leave the module a
 * packaged screen imports untouched.
 */

/**
 * One source file, read as text, relative to `admin/`.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one. Three of the paths
 * below start `../packages/modules/`: feature 091's batch 10 moved `settings`,
 * `dictionaries` and `credentials` into their packages and batch 11 moved
 * `transactional_emails`, so a caller and an owner named here can sit on
 * either side of that line. The assertion is
 * unchanged — this file's subject is the **request** each caller names, not
 * where the file lives. Batch 11 moved a fourth, `transactional_emails`, and
 * that entry follows its file for the same reason — this ledger is derived
 * *about* files another merge request moves, so the batch that frees an entry
 * is structurally the batch that cannot see it go stale unless it looks.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

interface ClientExit {
  /** The consumer, spelled as the ledger key spelled it, minus the repo root. */
  readonly caller: string;
  /** The module whose admin API client this caller used to import. */
  readonly owner: string;
  /** The binding it imported, and the specifier tail it imported it from. */
  readonly binding: string;
  readonly clientPath: string;
  /** The endpoint the caller now names for itself. */
  readonly endpoints: readonly string[];
}

const EXITS: readonly ClientExit[] = [
  {
    caller: 'src/modules/catalog/ProductInventoryTab.tsx',
    owner: 'settings',
    binding: 'settingsClient',
    clientPath: 'modules/settings/api/settings-client',
    endpoints: ['/api/v1/admin/settings/'],
  },
  {
    caller: 'src/components/IdleLogout.tsx',
    owner: 'settings',
    binding: 'settingsClient',
    clientPath: 'modules/settings/api/settings-client',
    endpoints: ['/api/v1/admin/settings/'],
  },
  {
    caller: 'src/modules/ksef/pages/KsefPage.tsx',
    owner: 'settings',
    binding: 'settingsClient',
    clientPath: 'modules/settings/api/settings-client',
    endpoints: ['/api/v1/admin/settings/'],
  },
  {
    caller: '../packages/modules/pwa/src/admin/pages/PwaPage.tsx',
    owner: 'sales_channels',
    binding: 'salesChannelsClient',
    clientPath: 'modules/sales_channels/api/sales-channels-client',
    endpoints: ['/api/v1/admin/sales-channels?'],
  },
  {
    caller: '../packages/modules/settings/src/admin/pages/SettingsPage.tsx',
    owner: 'sales_channels',
    binding: 'salesChannelsClient',
    clientPath: 'modules/sales_channels/api/sales-channels-client',
    endpoints: ['/api/v1/admin/sales-channels?'],
  },
  {
    caller: '../packages/modules/transactional_emails/src/admin/pages/EmailEditor.tsx',
    owner: 'sales_channels',
    binding: 'salesChannelsClient',
    clientPath: 'modules/sales_channels/api/sales-channels-client',
    endpoints: ['/api/v1/admin/sales-channels?activeOnly=true'],
  },
  {
    caller: 'src/modules/orders/OrderStatusConfigPage.tsx',
    owner: 'dictionaries',
    binding: 'dictionaryClient',
    clientPath: 'modules/dictionaries/client',
    endpoints: ['/api/v1/admin/dictionary/languages?pageSize='],
  },
  {
    caller: 'src/modules/sales_channels/components/ChannelIdentityForm.tsx',
    owner: 'dictionaries',
    binding: 'dictionaryClient',
    clientPath: 'modules/dictionaries/client',
    endpoints: ['/api/v1/admin/dictionary/'],
  },
  {
    caller: '../packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx',
    owner: 'credentials',
    binding: 'credentialsClient',
    clientPath: 'modules/credentials/api/credentials-client',
    endpoints: ['/api/v1/admin/credentials?type='],
  },
];

describe('feature 091 P6 — nine callers build their own request', () => {
  it.each(EXITS)('$caller no longer imports $owner’s admin API client', (exit) => {
    const source = sourceOf(exit.caller);
    expect(source).not.toContain(exit.binding);
    expect(source).not.toContain(exit.clientPath);
  });

  it.each(EXITS)('$caller names the endpoint itself', (exit) => {
    // The assertion the boundary check cannot make. A rebuilt request that
    // names the wrong path passes every import rule in the estate and fetches
    // nothing, which is the one regression this repair can introduce.
    const source = sourceOf(exit.caller);
    // `@/lib/api-client` for a caller still in `admin/src`, and the kit's own
    // barrel — the identical binding, forwarded by that shim — for one inside
    // a module package, where the `@/` alias does not resolve at all.
    expect(
      source.includes("from '@/lib/api-client'") ||
        source.includes("from '@endora-commerce/admin-kit/lib'"),
    ).toBe(true);
    for (const endpoint of exit.endpoints) {
      expect(source).toContain(endpoint);
    }
  });
});

describe('the owners keep their clients, because their own screens read them', () => {
  /**
   * The P6 row in `plan.md` says *"the four client modules that end with no
   * reader are deleted"*. Measured on the tree, **none** of the four does: each
   * is imported by its owner's own screens, which is what an admin API client
   * is for. Only the reach was cross-module, so only the reach is paid. This
   * case is here so the claim is settled by a measurement rather than repeated.
   */
  it.each([
    ['../packages/modules/settings/src/admin/api/settings-client.ts', 'settingsClient'],
    ['src/modules/sales_channels/api/sales-channels-client.ts', 'salesChannelsClient'],
    ['../packages/modules/dictionaries/src/admin/api/client.ts', 'dictionaryClient'],
    ['../packages/modules/credentials/src/admin/api/credentials-client.ts', 'credentialsClient'],
  ])('%s still exports %s', (path, binding) => {
    expect(sourceOf(path)).toContain(`export const ${binding}`);
  });
});
