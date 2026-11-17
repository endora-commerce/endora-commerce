import type { ReactNode } from 'react';

/**
 * The frame the admin shows while it boots (issues #1431, #1485).
 *
 * A cold load used to render the shell the moment the session arrived, before
 * the operator's i18n bundle and the module-presence projection had: the
 * navigation and the content read `core.appShell.nav…` for one to three
 * seconds, and a module route such as `/settings` said "not found" because the
 * presence gate fails closed while unresolved. This frame stands in for both.
 *
 * It borrows the shell's own layout classes — `b2b-app-layout`, `b2b-sidebar`,
 * `b2b-topbar`, `b2b-main` — so the real shell replaces it without the page
 * jumping, and on a narrow viewport the sidebar block is off-canvas exactly as
 * the drawer is. It carries no copy of its own beyond its accessible name, which
 * the caller supplies in a language it already knows, because no bundle is
 * there to translate one. The pulse is dropped under `prefers-reduced-motion`;
 * the information — that the admin is loading — is in the live region, which
 * does not depend on the motion.
 */
export function AdminBootSkeleton({ label }: { readonly label: string }): ReactNode {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="admin-boot-skeleton"
      className="b2b-app-layout b2b-app-layout--expanded"
    >
      <span className="sr-only">{label}</span>
      <div className="b2b-sidebar" aria-hidden="true">
        <div className="flex flex-col gap-3 p-4">
          <Bar className="mb-4 h-7 w-32 bg-white/10" />
          {NAV_WIDTHS.map((width, index) => (
            <Bar key={index} className={`h-4 bg-white/10 ${width}`} />
          ))}
        </div>
      </div>
      <div aria-hidden="true" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="b2b-topbar">
          <Bar className="h-4 w-40" />
        </div>
        <div className="b2b-main">
          <div className="flex flex-col gap-4">
            <Bar className="h-7 w-64" />
            <Bar className="h-40 w-full rounded-lg" />
            <Bar className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Varied widths, so the placeholder reads as a list of entries rather than a block. */
const NAV_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-24', 'w-32', 'w-28', 'w-36'] as const;

function Bar({ className }: { readonly className: string }): ReactNode {
  return <div className={`animate-pulse rounded bg-muted motion-reduce:animate-none ${className}`} />;
}
