import type { ReactNode } from 'react';

/**
 * One `application/ld+json` block, server-rendered
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-014).
 *
 * A component rather than an inline `<script>` per route, so the escaping
 * decision is made once. Everything it serialises comes from the typed backend
 * API or from a literal in this repository — never from a query string or a
 * request body — which is what makes `dangerouslySetInnerHTML` correct here;
 * the `<` escape closes the one remaining path, a legitimate value containing
 * `</script>`.
 */
export function JsonLd(props: { data: unknown }): ReactNode {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(props.data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
