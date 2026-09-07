import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AppShell migration check (T030). After feature 020's US2 lands, the
 * two formerly-hardcoded palette actions are owned by the catalog and
 * import_export module manifests; the shell file must contain neither
 * the literal label strings nor a PALETTE_ITEMS entry of group:'Actions'.
 *
 * Locks the migration in place: a future contributor who reverts to a
 * hardcoded entry trips this test.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPSHELL_PATH = resolve(__dirname, '../../../../packages/admin-shell/src/components/AppShell.tsx');
const SOURCE = readFileSync(APPSHELL_PATH, 'utf8');

describe('AppShell.tsx migration after feature 020 US2', () => {
  it("does not hardcode the 'New product' palette label", () => {
    expect(SOURCE).not.toMatch(/label:\s*'New product'/);
  });

  it("does not hardcode the 'Import products' palette label", () => {
    expect(SOURCE).not.toMatch(/label:\s*'Import products'/);
  });

  it('does not declare any group:\'Actions\' entry inside the PALETTE_ITEMS literal', () => {
    // Extract the PALETTE_ITEMS array body and assert it carries no
    // Actions-group rows. References to `group: 'Actions'` elsewhere
    // (the registry mapper) are intentional.
    const match = SOURCE.match(/const PALETTE_ITEMS:[^=]*=\s*\[([\s\S]*?)\];/);
    expect(match, 'PALETTE_ITEMS array literal not found').toBeTruthy();
    const arrayBody = match![1];
    expect(arrayBody).not.toMatch(/group:\s*'Actions'/);
  });

  it("uses useAdminActions to read the registry", () => {
    expect(SOURCE).toMatch(/useAdminActions/);
  });
});
