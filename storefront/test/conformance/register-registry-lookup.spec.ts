/* eslint-disable no-console -- a conformance run: stdout is its interface. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The business registration page with the company registry lookup, under axe at
 * WCAG 2.2 AA (`specs/173-registration-registry-lookup/` T057; FR-014,
 * `contracts/storefront-ux.md` §5).
 *
 * The page is `noindex`, so the derived page set of `conformance.spec.ts` never
 * reaches it; this measures it on a built storefront in front of a real backend,
 * as `locale-path.spec.ts` does, and changes no setting:
 *
 *     STOREFRONT_URL=http://127.0.0.1:3000 pnpm --filter storefront run conformance -- register-registry-lookup
 *
 * - The page as served, whatever state the lookup is in.
 * - With the lookup on: an invalid NIP fetched with JavaScript — the answer the
 *   checksum gives without contacting any registry — and the announced outcome.
 * - The **found** state needs a registry, and no conformance run may open a
 *   socket to one. It runs only when `REGISTRY_LOOKUP_FOUND_TAX_ID` names a tax
 *   ID the deployment can find — a deployment with *Polish sources* `gus` and a
 *   GUS credential in the **test** environment (GUS's public test key) — and is
 *   skipped otherwise, saying so.
 */

const STOREFRONT_URL = process.env['STOREFRONT_URL'] ?? 'http://127.0.0.1:3000';
const FOUND_TAX_ID = process.env['REGISTRY_LOOKUP_FOUND_TAX_ID'];
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PREFIX = '[register-registry-lookup]';

async function axe(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  for (const violation of results.violations) {
    console.log(`${PREFIX} ${state}: ${violation.id} — ${violation.help} (${violation.nodes.length} node(s))`);
  }
  expect(results.violations.map((v) => v.id), `${state}: axe WCAG 2.2 AA violations`).toEqual([]);
}

const lookupButton = (page: Page) => page.locator('button[name="intent"][value="lookup"]');
const statusRegion = (page: Page) => page.locator('#org-lookup-status');

test('the registration page meets WCAG 2.2 AA, with the registry lookup in every state it can reach', async ({
  page,
}) => {
  await page.goto(`${STOREFRONT_URL}/register`, { waitUntil: 'networkidle' });
  await axe(page, 'served');

  if ((await lookupButton(page).count()) === 0) {
    console.log(`${PREFIX} the lookup is off on this deployment: only the manual form was measured`);
    return;
  }

  // The outcome region is mounted empty, before any lookup (WCAG 4.1.3).
  await expect(statusRegion(page)).toHaveAttribute('role', 'status');
  await expect(statusRegion(page)).toHaveAttribute('aria-live', 'polite');
  await expect(statusRegion(page)).toBeEmpty();

  // An invalid NIP: the checksum answers, no registry is contacted. Enter in the
  // tax ID field fetches; focus stays where the buyer was.
  await page.locator('#addr-country').selectOption('PL');
  await page.locator('#org-tax').fill('1234567890');
  await page.locator('#org-tax').press('Enter');
  await expect(statusRegion(page)).not.toBeEmpty();
  await expect(page.locator('#org-tax')).toBeFocused();
  await axe(page, 'invalid tax ID');

  if (FOUND_TAX_ID === undefined || FOUND_TAX_ID === '') {
    console.log(`${PREFIX} REGISTRY_LOOKUP_FOUND_TAX_ID is unset: the found state was not measured`);
    return;
  }
  await page.locator('#org-tax').fill(FOUND_TAX_ID);
  await lookupButton(page).click();
  await expect(page.locator('input[name="registryLookupId"]')).not.toHaveValue('', { timeout: 15_000 });
  await expect(page.locator('#org-name')).not.toHaveValue('');
  await expect(lookupButton(page)).toBeFocused();
  await axe(page, 'found');
});
