import type { ReactNode } from 'react';
import type { ResolvedStorefrontTheme } from './theme';

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
 *
 * ## The third attribute, and why it is not decoration
 *
 * `data-theme-requested` appears **when and only when** the request fell back —
 * the channel named a theme this storefront does not have, so `data-theme`
 * carries the default instead. It is absent on every correct render and absent
 * when the channel names no theme at all.
 *
 * It exists because the mistake is made in the **admin** and the signal appears
 * in the **storefront's** container log: a different deployment, read by a
 * different person, hours later. This puts the answer in the artefact that
 * already carries the question, so "why is this channel not branded" is
 * answerable from `view-source` by whoever is asking. It replaces no log line —
 * `themeForChannel`'s once-per-process warning stays — and it reports nothing
 * anywhere: there is no channel from a storefront back to the platform, in
 * either direction (D-195).
 *
 * The component takes the whole decision rather than a code plus an optional
 * marker, so the "when and only when" is derived here and there is nothing for
 * a caller to forget. The one operator-typed lowercase token it discloses, on a
 * channel that is already misconfigured, is an accepted cost (owner ruling,
 * 2026-09-03).
 */
export function StorefrontDocument({
  lang,
  theme,
  children,
}: {
  lang: string;
  theme: ResolvedStorefrontTheme;
  children: ReactNode;
}): ReactNode {
  return (
    <html
      lang={lang}
      data-theme={theme.code}
      {...(theme.unknownRequest !== null ? { 'data-theme-requested': theme.unknownRequest } : {})}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, etc.) inject attributes onto <body> before React hydrates
          — e.g. data-gr-ext-installed. This suppresses the warning for the
          <body> element's own attributes only (not its descendants), so real
          mismatches inside the tree are still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
