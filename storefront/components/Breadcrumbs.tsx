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
    <nav className="b2b-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {props.crumbs.map((c, idx) => (
          <li key={c.href}>
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
