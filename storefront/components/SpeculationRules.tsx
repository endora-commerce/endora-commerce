import type { ReactNode } from 'react';

/**
 * Emits a Speculation Rules script so supporting browsers can prerender the
 * likely next page for near-instant navigations.
 *
 * Eagerness assessment: "moderate" is the recommended default. It speculates
 * on hover / pointer intent rather than on every link discovered on the page
 * ("eager"), which on a link-dense B2B catalog would prerender far more pages
 * than the buyer visits and waste CPU/bandwidth; it is also earlier than
 * "conservative" (pointer-down), so the navigation still feels instant. The
 * level stays operator-configurable via the
 * `storefront.speculation_rules.eagerness` setting.
 *
 * Sensitive / side-effectful routes (checkout, account, cart, auth, API) are
 * excluded so prerendering never pre-runs an authenticated or mutating page.
 */
export function SpeculationRules({
  enabled,
  eagerness,
}: {
  enabled: boolean;
  eagerness: string;
}): ReactNode {
  if (!enabled) return null;
  const level = ['conservative', 'moderate', 'eager'].includes(eagerness) ? eagerness : 'moderate';
  const rules = {
    prerender: [
      {
        where: {
          and: [
            { href_matches: '/*' },
            { not: { href_matches: '/checkout*' } },
            { not: { href_matches: '/account*' } },
            { not: { href_matches: '/cart*' } },
            { not: { href_matches: '/login*' } },
            { not: { href_matches: '/logout*' } },
            { not: { href_matches: '/api/*' } },
          ],
        },
        eagerness: level,
      },
    ],
  };
  return (
    <script
      type="speculationrules"
      // Speculation Rules must be inline JSON; this is generated, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(rules) }}
    />
  );
}
