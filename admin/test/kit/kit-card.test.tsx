import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';

/**
 * Issue #1438 (UX audit 2026-11-17, DS-04) and #1502 (SHELL-18): one card
 * implementation on one set of density tokens, and card titles in the heading
 * outline (WCAG 2.2 SC 1.3.1, 2.4.6). jsdom lays nothing out, so the density is
 * asserted as the utilities and declarations that carry it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const themeCss = readFileSync(path.join(repoRoot, 'packages/admin-kit/theme.css'), 'utf8');

function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** The declarations of one rule, e.g. `.b2b-card__body`, as written in theme.css. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(themeCss);
  if (!match) throw new Error(`theme.css declares no rule for ${selector}`);
  return match[1] ?? '';
}

describe('density tokens (DS-04)', () => {
  it.each([
    ['--card-pad', '16px'],
    ['--card-pad-sm', '12px'],
    ['--card-gap', '16px'],
    ['--section-gap', '24px'],
    ['--fs-page-title', '20px'],
    ['--fs-section-title', '14px'],
    ['--fs-hint', '12px'],
  ])('theme.css declares %s: %s', (token, value) => {
    expect(themeCss).toMatch(new RegExp(`\\n\\s*${token}:\\s*${value};`));
  });

  it('the deprecated .b2b-card* classes read the same tokens', () => {
    expect(ruleBody('.b2b-card__body')).toContain('var(--card-pad)');
    expect(ruleBody('.b2b-card__head')).toContain('var(--card-pad)');
    expect(ruleBody('.b2b-card__title')).toContain('var(--fs-section-title)');
    expect(ruleBody('.b2b-card__sub')).toContain('var(--fs-hint)');
    expect(ruleBody('.b2b-card__foot')).toContain('var(--card-pad-sm)');
    expect(themeCss).toMatch(/@deprecated[^*]*\.b2b-card|\.b2b-card[^*]*@deprecated/);
  });
});

describe('Card', () => {
  it('pads header, content and footer with --card-pad, not p-6', () => {
    render(
      <Card data-testid="card">
        <CardHeader data-testid="header">
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent data-testid="content">Body</CardContent>
        <CardFooter data-testid="footer">Foot</CardFooter>
      </Card>,
    );
    for (const id of ['header', 'content', 'footer']) {
      const classes = classesOf(screen.getByTestId(id));
      expect(classes).toContain('p-(--card-pad)');
      expect(classes).not.toContain('p-6');
    }
  });

  it('CardContent drops its top padding only after a CardHeader', () => {
    render(
      <Card>
        <CardHeader data-testid="header">
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent data-testid="content">Body</CardContent>
      </Card>,
    );
    const content = classesOf(screen.getByTestId('content'));
    // An unconditional pt-0 is what forced the `pt-6` workaround on every header-less card.
    expect(content).not.toContain('pt-0');
    expect(content).toContain('[[data-slot=card-header]+&]:pt-0');
    expect(screen.getByTestId('header').getAttribute('data-slot')).toBe('card-header');
    expect(screen.getByTestId('content').getAttribute('data-slot')).toBe('card-content');
  });

  it('`flush` removes the content padding for a table and clips the corners', () => {
    render(
      <Card flush data-testid="card">
        <CardContent>table</CardContent>
      </Card>,
    );
    const card = screen.getByTestId('card');
    expect(card.hasAttribute('data-flush')).toBe(true);
    expect(classesOf(card)).toContain('overflow-hidden');
    expect(classesOf(card)).toContain('[&[data-flush]>[data-slot=card-content]]:p-0');
  });

  it('is not flush by default', () => {
    render(<Card data-testid="card" />);
    expect(screen.getByTestId('card').hasAttribute('data-flush')).toBe(false);
    expect(classesOf(screen.getByTestId('card'))).not.toContain('overflow-hidden');
  });
});

describe('CardTitle', () => {
  it('is an h2 by default, sized by --fs-section-title', () => {
    render(<CardTitle>Addresses</CardTitle>);
    const heading = screen.getByRole('heading', { level: 2, name: 'Addresses' });
    expect(classesOf(heading)).toContain('text-(length:--fs-section-title)');
  });

  it('`as` picks another level, and forwards the ref', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(
      <CardTitle as="h3" ref={ref} id="t">
        Nested
      </CardTitle>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Nested' })).toBe(ref.current);
    expect(ref.current?.id).toBe('t');
  });

  it('`as="div"` opts out of the outline', () => {
    render(<CardTitle as="div">Plain</CardTitle>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

/**
 * The `pt-6` workaround existed because `CardContent` always dropped its top
 * padding. It no longer does, so the workaround now draws 24 px above 16 px
 * sides — and a heading drawn inside a `CardTitle` is a heading in a heading.
 */
describe('call sites (DS-04 sweep)', () => {
  const roots = ['admin/src', 'packages/admin-kit/src', 'packages/admin-shell/src', 'packages/modules'];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) files.push(full);
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));

  it('no CardContent carries the pt-6 workaround', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<CardContent\b(?:[^>"{]|"[^"]*"|\{[^}]*\})*>/g)) {
        if (/\bpt-6\b/.test(match[0])) offenders.push(path.relative(repoRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no CardTitle wraps its own heading element', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<CardTitle\b[^>]*>\s*<h[1-6]\b/g)) {
        offenders.push(`${path.relative(repoRoot, file)}: ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
