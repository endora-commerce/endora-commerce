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
 * `orders/OrderStatusConfigPage.test.tsx` — each of which now mocks
 * `@/lib/api-client`, the seam the caller actually uses.
 */

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
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
    caller: 'src/modules/settings/pages/PwaPage.tsx',
    owner: 'sales_channels',
    binding: 'salesChannelsClient',
    clientPath: 'modules/sales_channels/api/sales-channels-client',
    endpoints: ['/api/v1/admin/sales-channels?'],
  },
  {
    caller: 'src/modules/settings/pages/SettingsPage.tsx',
    owner: 'sales_channels',
    binding: 'salesChannelsClient',
    clientPath: 'modules/sales_channels/api/sales-channels-client',
    endpoints: ['/api/v1/admin/sales-channels?'],
  },
  {
    caller: 'src/modules/transactional_emails/pages/EmailEditor.tsx',
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
    caller: 'src/modules/settings/components/ConfigurationReferenceInput.tsx',
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
    expect(source).toContain("from '@/lib/api-client'");
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
    ['src/modules/settings/api/settings-client.ts', 'settingsClient'],
    ['src/modules/sales_channels/api/sales-channels-client.ts', 'salesChannelsClient'],
    ['src/modules/dictionaries/client.ts', 'dictionaryClient'],
    ['src/modules/credentials/api/credentials-client.ts', 'credentialsClient'],
  ])('%s still exports %s', (path, binding) => {
    expect(sourceOf(path)).toContain(`export const ${binding}`);
  });
});
