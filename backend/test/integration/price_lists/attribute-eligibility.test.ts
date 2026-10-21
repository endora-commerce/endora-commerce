import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { findAttributeExtensionByKey } from '../../helpers/seed-catalog.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-007, D-287 §5.9) — an attribute selects prices only when it is
 * flagged *Price list rules*, has a closed vocabulary (single choice, multiple
 * choice, yes/no) and is neither per-language nor per-channel. A row on an
 * attribute that is not eligible is refused at write; one whose attribute
 * stops qualifying stops pricing without an error, and resumes when it
 * qualifies again.
 */
describe('price books — attribute eligibility', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  async function setFlags(key: string, flags: { isPriceRule?: boolean; languageScoped?: boolean; channelScoped?: boolean }) {
    const em = h.em().fork();
    const extension = await findAttributeExtensionByKey(em, key);
    if (!extension) throw new Error(`attribute ${key} missing`);
    Object.assign(extension, flags);
    await em.flush();
  }

  async function everyoneRow(attribute: readonly [string, string]) {
    return f.book({ audience: 'everyone', rows: [{ attribute, fixed: '1' }] });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
    await setFlags('color', { isPriceRule: true, languageScoped: false, channelScoped: false });
    await setFlags('material', { isPriceRule: false, languageScoped: false, channelScoped: false });
    await setFlags('internal_sku_notes', { isPriceRule: false });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a row on an unflagged attribute', async () => {
    await expect(everyoneRow(['material', 'steel'])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a row on a language-scoped or a channel-scoped attribute', async () => {
    await setFlags('material', { isPriceRule: true, languageScoped: true });
    await expect(everyoneRow(['material', 'steel'])).rejects.toMatchObject({ statusCode: 400 });
    await setFlags('material', { languageScoped: false, channelScoped: true });
    await expect(everyoneRow(['material', 'steel'])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a row on a free-text attribute', async () => {
    await setFlags('internal_sku_notes', { isPriceRule: true });
    await expect(everyoneRow(['internal_sku_notes', 'x'])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clearing the flag stops the row without an error; setting it resumes it', async () => {
    await f.book({ audience: 'everyone', rows: [{ attribute: ['color', 'red'], fixed: '120' }] });
    expect(await f.amount('guest', f.products.P1)).toBe('120.0000');
    await setFlags('color', { isPriceRule: false });
    expect(await f.price('guest', f.products.P1)).toMatchObject({ amount: '100.0000', source: 'base' });
    await setFlags('color', { isPriceRule: true });
    expect(await f.amount('guest', f.products.P1)).toBe('120.0000');
  });

  it('an attribute that becomes language-scoped stops its rows too', async () => {
    await f.book({ audience: 'everyone', rows: [{ attribute: ['color', 'red'], fixed: '120' }] });
    await setFlags('color', { languageScoped: true });
    expect(await f.amount('guest', f.products.P1)).toBe('100.0000');
  });
});
