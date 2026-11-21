import type { ReactNode } from 'react';
import { TabPanel } from '@endora-commerce/admin-kit/ui';

/**
 * Issue #1445 (UX audit 2026-11-17, DS-12) — the canvas as the panel of the
 * content-language strip above it, on an editor whose language switches the
 * canvas and nothing else (a block, a template). The strip passes the same
 * `idBase`, so every language tab names the canvas (`aria-controls`) and the
 * canvas is labelled by the selected tab.
 *
 * `language` is `null` while the scope offers no language: the strip then
 * draws its empty state and has no tab to label a panel, so the canvas is
 * rendered on its own rather than labelled by a tab that is not there.
 *
 * A page's language also switches its settings fields, so the page editor
 * leaves its strip without a panel (see `ContentLanguageTabs`).
 */
export function CanvasLanguagePanel({
  idBase,
  language,
  children,
}: {
  idBase: string;
  language: string | null;
  children: ReactNode;
}): ReactNode {
  if (language === null) return children;
  // The canvas holds its own focusable controls: the panel is not a tab stop.
  return (
    <TabPanel idBase={idBase} value={language} tabIndex={-1}>
      {children}
    </TabPanel>
  );
}
