import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * Feature 037-cart-merge-on-login — storefront interaction test for the
 * post-login confirmation toast.
 *
 * Covers:
 *   - `outcome: 'adopted'` → toast renders with the adopted PL/EN copy;
 *   - `outcome: 'merged'`  → toast renders with the merged PL/EN copy;
 *   - flash cookie is cleared on render (the toast does not appear on
 *     the second mount);
 *   - no flash cookie → toast renders to empty (`null`).
 *
 * The component reads cookies via `lib/session`'s readers — those are
 * mocked here so the test exercises the toast in isolation from
 * Next's request-scoped runtime.
 */

interface CookieStore {
  flash: 'adopted' | 'merged' | null;
}

const cookieStore: CookieStore = { flash: null };

vi.mock('../../lib/session', () => ({
  readAndClearCartMergeFlash: vi.fn(async () => {
    const value = cookieStore.flash;
    cookieStore.flash = null;
    return value;
  }),
}));

let currentLocale = 'pl-PL';
vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({ locale: currentLocale })),
}));

// Import AFTER mocks so the component picks up the mocked modules.
const { CartMergeToast } = await import('../../components/CartMergeToast');

async function render(): Promise<string> {
  const node = await CartMergeToast();
  if (node === null) return '';
  return renderToString(node);
}

describe('CartMergeToast', () => {
  beforeEach(() => {
    cookieStore.flash = null;
    currentLocale = 'pl-PL';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the adopted (PL) copy when the flash holds "adopted"', async () => {
    cookieStore.flash = 'adopted';
    const html = await render();
    expect(html).toContain('cart-merge-toast');
    expect(html).toContain('data-outcome="adopted"');
    expect(html).toContain('Twoje produkty z koszyka sprzed logowania');
  });

  it('renders the merged (PL) copy when the flash holds "merged"', async () => {
    cookieStore.flash = 'merged';
    const html = await render();
    expect(html).toContain('data-outcome="merged"');
    expect(html).toContain('Dodaliśmy do Twojego koszyka');
  });

  it('renders the adopted (EN) copy when the locale is English', async () => {
    cookieStore.flash = 'adopted';
    currentLocale = 'en-US';
    const html = await render();
    expect(html).toContain('attached the basket');
  });

  it('renders the merged (EN) copy when the locale is English', async () => {
    cookieStore.flash = 'merged';
    currentLocale = 'en-US';
    const html = await render();
    expect(html).toContain('added the items');
  });

  it('clears the flash after the first render — the second render produces nothing', async () => {
    cookieStore.flash = 'adopted';
    const firstPass = await render();
    expect(firstPass).toContain('cart-merge-toast');
    const secondPass = await render();
    expect(secondPass).toBe('');
  });

  // Issue #85: the copy is read from the storefront catalogue rather than
  // chosen by a `startsWith('pl')` beside two inline sentences, so a locale
  // the catalogue does not carry gets the catalogue's English fallback.
  it('falls back to English for a locale the catalogue does not carry', async () => {
    cookieStore.flash = 'merged';
    currentLocale = 'de-DE';
    const html = await render();
    expect(html).toContain('added the items');
    expect(html).not.toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/);
  });

  it('renders nothing when no flash cookie was set', async () => {
    cookieStore.flash = null;
    const html = await render();
    expect(html).toBe('');
  });
});
