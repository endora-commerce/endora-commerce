import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newsletterSignupText } from '../../lib/page-builder/newsletter-signup-text';

/**
 * Feature 169 (US7 scenario 3, FR-026, data-model §5.4) — the message
 * `newsletter.Signup` shows when a required subscriber attribute is left empty
 * is in the page's language. `cms-components` has no translation layer;
 * `CmsPageRenderer` hands the catalogue's `newsletter.signup.fields` to the
 * render context, and the block falls back to English without it (the editor).
 */
describe('newsletter sign-up text in the page language (T179)', () => {
  it('a Polish page reads Polish', () => {
    const text = newsletterSignupText('pl-PL');
    expect(text.fields).toBeTruthy();
    expect(text.fields).not.toBe(newsletterSignupText('en-US').fields);
  });

  it('an English page, and a language the catalogue does not carry, read English', () => {
    expect(newsletterSignupText('en-US').fields).toBe('Please fill in the required fields.');
    expect(newsletterSignupText('de-DE').fields).toBe('Please fill in the required fields.');
  });

  it('CmsPageRenderer hands it to the render context', () => {
    const source = readFileSync(resolve(__dirname, '../../components/CmsPageRenderer.tsx'), 'utf8');
    expect(source).toMatch(/newsletterSignupText=\{newsletterSignupText\(page\.language\)\}/);
  });
});
