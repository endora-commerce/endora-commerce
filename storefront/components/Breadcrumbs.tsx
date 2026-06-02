import Link from 'next/link';
import type { ReactNode } from 'react';

export interface BreadcrumbCrumb {
  href: string;
  label: string;
}

/**
 * Renders the navigation trail with `BreadcrumbList` JSON-LD so crawlers
 * pick the structured data up directly (Principle VII / FR-103).
 */
export function Breadcrumbs(props: { crumbs: BreadcrumbCrumb[] }): ReactNode {
  if (props.crumbs.length === 0) return null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: props.crumbs.map((c, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: c.label,
      item: c.href,
    })),
  };
  return (
    <nav aria-label="Breadcrumb">
      {/*
        Migrated to utilities (was .b2b-breadcrumbs). Spacing/size use arbitrary px to
        preserve exact parity — the storefront root font-size is 14px, so Tailwind's
        rem-based scales would not equal the original absolute px. Colours use semantic
        tokens. The '›' separator is a before: pseudo-element on every li except the first.
      */}
      <ol className="m-0 mb-[16px] flex list-none flex-wrap gap-[6px] p-0 text-[12px] text-muted">
        {props.crumbs.map((c, idx) => (
          <li
            key={c.href}
            className="before:mr-[6px] before:text-line-strong before:content-['›'] first:before:hidden"
          >
            {idx === props.crumbs.length - 1 ? (
              <span aria-current="page">{c.label}</span>
            ) : (
              <Link href={c.href}>{c.label}</Link>
            )}
          </li>
        ))}
      </ol>
      <script
        type="application/ld+json"
        // Server-rendered — no XSS risk because every label/href comes
        // from the typed catalog API, not from user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </nav>
  );
}
