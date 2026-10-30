import type { ButtonSpec } from '@endora-commerce/page-builder-core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ButtonView } from './ButtonView.js';

/**
 * `specs/163-page-builder-marketing-pages/` research R-11 — one renderer for
 * every `ButtonSpec`: a class per style-and-fill and per size, an optional icon
 * from the curated catalog, and a round icon-only form named by its label.
 */

const link = { kind: 'page', slug: 'contact' } as const;

function spec(overrides: Partial<ButtonSpec> = {}): ButtonSpec {
  return { label: 'Contact us', link, style: 'primary', fill: 'solid', size: 'medium', ...overrides };
}

function classesOf(html: string): string[] {
  return (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');
}

describe('ButtonView', () => {
  it('gives cmsc-btn--<style>-<fill> for each style and fill', () => {
    for (const style of ['primary', 'secondary', 'light', 'dark'] as const) {
      for (const fill of ['solid', 'outline', 'text'] as const) {
        const classes = classesOf(renderToString(<ButtonView button={spec({ style, fill })} />));
        expect(classes).toContain('cmsc-btn');
        expect(classes).toContain(`cmsc-btn--${style}-${fill}`);
      }
    }
  });

  it('gives cmsc-btn--<size> for each size', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(classesOf(renderToString(<ButtonView button={spec({ size })} />))).toContain(`cmsc-btn--${size}`);
    }
  });

  it('adds a tier class where a responsive style or fill changes', () => {
    const classes = classesOf(
      renderToString(
        <ButtonView button={spec({ style: { base: 'primary', desktop: 'dark' }, fill: { base: 'solid', tablet: 'outline' } })} />,
      ),
    );
    expect(classes).toContain('cmsc-btn--primary-solid');
    expect(classes).toContain('cmsc-btn--md-primary-outline');
    expect(classes).toContain('cmsc-btn--lg-dark-outline');
  });

  it('renders the label and a link to the target', () => {
    const html = renderToString(<ButtonView button={spec()} />);
    expect(html).toMatch(/^<a [^>]*href="\/contact"/);
    expect(html).toContain('Contact us');
  });

  it('renders an anchor link as href="#…"', () => {
    const html = renderToString(<ButtonView button={spec({ link: { kind: 'anchor', anchor: 'pricing' } })} />);
    expect(html).toContain('href="#pricing"');
  });

  it('opens a _blank link with rel="noopener noreferrer"', () => {
    const html = renderToString(
      <ButtonView button={spec({ link: { kind: 'url', href: 'https://example.com', target: '_blank' } })} />,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders no link for an unsafe URL', () => {
    const html = renderToString(<ButtonView button={spec({ link: { kind: 'url', href: 'javascript:alert(1)' } })} />);
    expect(html).not.toContain('href=');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Contact us');
  });

  it('renders an icon before or after the label', () => {
    const start = renderToString(<ButtonView button={spec({ icon: 'download', iconPosition: 'start' })} />);
    expect(start).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg><span[^>]*>Contact us<\/span>/);
    const end = renderToString(<ButtonView button={spec({ icon: 'arrowRight', iconPosition: 'end' })} />);
    expect(end).toMatch(/<span[^>]*>Contact us<\/span><svg[^>]*aria-hidden="true"/);
  });

  it('renders iconPosition "only" as a round button whose aria-label is the label', () => {
    const html = renderToString(<ButtonView button={spec({ label: 'Next slide', icon: 'arrowRight', iconPosition: 'only' })} />);
    expect(classesOf(html)).toContain('cmsc-btn--icon-only');
    expect(html).toContain('aria-label="Next slide"');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/>Next slide</);
  });

  it('keeps per-button colour overrides, as hex or as a brand token', () => {
    const html = renderToString(
      <ButtonView button={spec({ backgroundColor: '#1d4ed8', textColor: 'token:on-primary' })} />,
    );
    expect(html).toContain('--cmsc-btn-c:#1d4ed8');
    expect(html).toContain('--cmsc-btn-on:var(--cmsb-color-on-primary, #ffffff)');
  });

  // Feature 169 (T109): a form's submit button — the same look, a `<button type="submit">`.
  it('renders a submit button with the classes of the link rendering, and no link', () => {
    const asLink = renderToString(<ButtonView button={spec({ style: 'dark', fill: 'outline', size: 'large' })} />);
    const asSubmit = renderToString(
      <ButtonView button={spec({ style: 'dark', fill: 'outline', size: 'large' })} type="submit" />,
    );
    expect(asSubmit).toMatch(/^<button type="submit"/);
    expect(asSubmit).not.toContain('href=');
    expect(classesOf(asSubmit)).toEqual(classesOf(asLink));
    expect(asSubmit).toContain('Contact us');
  });

  it('marks a busy submit button disabled', () => {
    const html = renderToString(<ButtonView button={spec()} type="submit" disabled />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it('keeps every existing rendering when no type is given', () => {
    expect(renderToString(<ButtonView button={spec()} />)).toMatch(/^<a href=/);
    expect(renderToString(<ButtonView button={spec({ link: { kind: 'url', href: '' } })} />)).toMatch(/^<span /);
  });
});
