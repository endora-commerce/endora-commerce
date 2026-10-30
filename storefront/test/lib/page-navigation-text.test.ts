import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageNavigationText } from '../../lib/page-builder/page-navigation-text';

/**
 * `specs/169-page-builder-contact-form/` T059, US5 — the page navigation's
 * accessible name, when the block sets none, is in the page's language:
 * `cms-components` has no translation layer, so `CmsPageRenderer` hands the
 * storefront catalogue's `cms.pageNavigation.label` to the render context.
 */
describe('page navigation text in the page language (T059)', () => {
  it('a Polish page names the navigation in Polish', () => {
    expect(pageNavigationText('pl-PL')).toEqual({ label: 'Na tej stronie' });
  });

  it('English, and a language the catalogue does not carry, read English', () => {
    expect(pageNavigationText('en-US')).toEqual({ label: 'On this page' });
    expect(pageNavigationText('de-DE')).toEqual({ label: 'On this page' });
  });

  it('CmsPageRenderer hands the page language\'s words to the render context', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/CmsPageRenderer.tsx'), 'utf8');
    expect(source).toContain("from '../lib/page-builder/page-navigation-text'");
    expect(source).toMatch(/pageNavigationText=\{pageNavigationText\(page\.language\)\}/);
  });
});
