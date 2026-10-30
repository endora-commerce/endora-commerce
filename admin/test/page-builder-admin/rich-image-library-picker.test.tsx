import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163, T195 — the rich text's image dialog (in `cms-components`, which
 * cannot import the admin) offers the asset library where the host provides a
 * picker. The admin provides one wherever the page builder's field controls
 * are mounted — `PageBuilderColorPaletteProvider`, which the page editor and
 * the e-mail editor both mount — and it answers with the chosen image's
 * stable, absolute address and its alternative text.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { PageBuilderColorPaletteProvider, pickedImageFromAsset } = await import('@endora-commerce/page-builder-admin');
const { useImagePicker } = await import('@endora-commerce/page-builder-core');

afterEach(() => cleanup());

function Probe(): ReactElement {
  return <output data-testid="probe">{useImagePicker() === null ? 'none' : 'picker'}</output>;
}

describe('the admin\'s image picker for the rich text (T195)', () => {
  it('is provided wherever the page builder\'s field controls are', () => {
    render(
      <TranslationProvider language="en" initialBundle={{ core: {} } as Bundle}>
        <PageBuilderColorPaletteProvider initialEntries={[]}>
          <Probe />
        </PageBuilderColorPaletteProvider>
      </TranslationProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('picker');
  });

  it('is absent elsewhere', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('none');
  });

  it('answers with the stable file address, made absolute, and the alternative text in the admin\'s language first', () => {
    expect(
      pickedImageFromAsset(
        { url: 'https://cdn.example.com/v2/logo.png', fileUrl: 'https://cdn.example.com/logo.png', altText: { 'en-US': 'Logo', 'pl-PL': 'Logotyp' } },
        'pl',
      ),
    ).toEqual({ url: 'https://cdn.example.com/logo.png', alt: 'Logotyp' });
    expect(pickedImageFromAsset({ url: 'https://cdn.example.com/a.png', altText: { 'en-US': '', de: 'Bild' } }, 'pl')).toEqual({
      url: 'https://cdn.example.com/a.png',
      alt: 'Bild',
    });
    expect(pickedImageFromAsset({ url: 'https://cdn.example.com/a.png', altText: null }, 'en')).toEqual({ url: 'https://cdn.example.com/a.png' });
    expect(pickedImageFromAsset({ url: '/assets/file/a.png', fileUrl: '/assets/file/a.png' }, 'en').url).toMatch(/^https?:\/\/.+\/assets\/file\/a\.png$/);
  });
});
