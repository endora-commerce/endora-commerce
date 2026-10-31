import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { JsonLd } from '../../lib/seo/JsonLd';
import { absoluteUrl } from '../../lib/seo/site-url';

const STOREFRONT_ROOT = join(__dirname, '..', '..');
const SCANNED = ['app', 'components', 'lib'];
const HELPER = join('lib', 'seo', 'JsonLd.tsx');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('structured data blocks', () => {
  it('escape "<" so a value cannot close the script element', () => {
    const html = renderToString(
      <JsonLd data={{ name: '</script><script>alert(1)</script>', description: '<!-- x -->' }} />,
    );
    expect(html).not.toContain('</script><script>');
    expect(html).not.toContain('<!--');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('breadcrumb labels and links are escaped inside the BreadcrumbList block', () => {
    const html = renderToString(
      <Breadcrumbs locale="en-US"
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/p/x</script><script>alert(1)</script>', label: '</script><img src=x onerror=alert(1)>' },
        ]}
      />,
    );
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    expect(script![1]).not.toContain('<');
    const parsed = JSON.parse(script![1]!) as { itemListElement: Array<{ name: string; item: string }> };
    expect(parsed.itemListElement[1]!.name).toBe('</script><img src=x onerror=alert(1)>');
    // Feature 163 (T082): the item is absolute now (`absoluteUrl`), so the
    // path arrives percent-encoded — still never a raw `<` inside the block.
    expect(parsed.itemListElement[1]!.item).toBe(absoluteUrl('/p/x</script><script>alert(1)</script>'));
    expect(parsed.itemListElement[1]!.item).not.toContain('<');
  });

  it('every application/ld+json block in the storefront is rendered through the JsonLd helper', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(STOREFRONT_ROOT, dir)))
      .filter((file) => relative(STOREFRONT_ROOT, file) !== HELPER)
      .filter((file) => readFileSync(file, 'utf8').includes('application/ld+json'))
      .map((file) => relative(STOREFRONT_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
