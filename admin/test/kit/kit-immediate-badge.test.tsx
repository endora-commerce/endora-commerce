import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 180 (#407, after WP-9) — the one "Applies immediately" badge every editor puts on the
 * heading of a section whose controls write at once, outside the page's one Save (FR-061). It
 * used to be four local copies in `catalog`, `customers`, `organizations` and `inventory`, each
 * with its own string. Text, not only an icon; the copy is read off the shipped `core` bundles.
 */

function bundleOf(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

function renderBadge(language: 'en' | 'pl', className?: string): HTMLElement {
  const { container } = render(
    <TranslationProvider language={language} initialBundle={{ core: bundleOf(language) }}>
      <h3>
        Section <ImmediateBadge {...(className === undefined ? {} : { className })} />
      </h3>
    </TranslationProvider>,
  );
  return container;
}

describe('ImmediateBadge', () => {
  it('says "Applies immediately" in text, with a decorative icon', () => {
    const container = renderBadge('en');
    const badge = screen.getByText('Applies immediately');
    expect(screen.getByRole('heading')).toHaveTextContent('Section Applies immediately');
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('is drawn with the info tokens, as the product editor drew it', () => {
    renderBadge('en');
    const badge = screen.getByText('Applies immediately');
    for (const token of [
      'ml-2',
      'inline-flex',
      'items-center',
      'gap-1',
      'rounded-md',
      'border',
      'border-[var(--info)]/40',
      'bg-[var(--info-soft)]',
      'px-2',
      'py-0.5',
      'text-xs',
      'font-medium',
      'text-[var(--info-soft-fg)]',
    ]) {
      expect(badge.classList.contains(token), token).toBe(true);
    }
  });

  it('takes a placement class, which wins over its own margin', () => {
    renderBadge('en', 'ml-0 align-middle');
    const badge = screen.getByText('Applies immediately');
    expect(badge.classList.contains('ml-0')).toBe(true);
    expect(badge.classList.contains('ml-2')).toBe(false);
    expect(badge.classList.contains('align-middle')).toBe(true);
  });

  it('ships its string in English and Polish, Polish actually translated', () => {
    const en = bundleOf('en')['saveSession.immediateBadge'];
    const pl = bundleOf('pl')['saveSession.immediateBadge'];
    expect(en).toBe('Applies immediately');
    expect(pl).toBeTruthy();
    expect(pl).not.toBe(en);
    renderBadge('pl');
    expect(screen.getByText(pl!)).toBeInTheDocument();
  });
});
