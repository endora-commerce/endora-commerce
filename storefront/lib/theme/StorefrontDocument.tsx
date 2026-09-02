import type { ReactNode } from 'react';
import type { StorefrontThemeCode } from '@endora-commerce/contracts';

/**
 * The document element the root layout returns — feature `005-sales-channels`.
 *
 * It exists as its own component for one reason: `data-theme` is the entire
 * per-channel theming mechanism, and it has to be provable. A test can render
 * *this* server-side and read the attribute out of the emitted HTML, which is
 * the same string a browser receives on first paint; rendering `app/layout.tsx`
 * for the same assertion would drag in the dictionary provider, the megamenu,
 * the cart badge and six analytics configs, none of which have anything to do
 * with the theme.
 *
 * It lives under `lib/` rather than `components/`. `THEMING.md` says everything
 * under `components/` may be replaced freely, and a theme that replaced the
 * `<html>` element would silently drop the channel's brand along with it.
 *
 * Both attributes are stamped server-side and neither is ever set from the
 * client: `lang` for crawlers (Principle VII / FR-103), `data-theme` because a
 * theme applied after hydration is a flash of the wrong brand.
 */
export function StorefrontDocument({
  lang,
  theme,
  children,
}: {
  lang: string;
  theme: StorefrontThemeCode;
  children: ReactNode;
}): ReactNode {
  return (
    <html lang={lang} data-theme={theme}>
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, etc.) inject attributes onto <body> before React hydrates
          — e.g. data-gr-ext-installed. This suppresses the warning for the
          <body> element's own attributes only (not its descendants), so real
          mismatches inside the tree are still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
