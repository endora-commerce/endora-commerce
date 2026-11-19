import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';

/**
 * Feature 174 (FR-070, `contracts/editor-ui.md` §3 and §11) — the badge a product-editor section
 * heading carries: a section whose controls run at once as their own audited Commands (structural
 * operations, price-book rows, membership, stock) carries the kit's "Applies immediately" badge
 * (feature 180, #407); outside Global a structural section carries "Global only" instead.
 *
 * Issue #1488 (UX audit CAT-06): the heading itself is the kit's `EditorSection` — one heading
 * component at one level for every tab of the editor. This file keeps only what is the editor's:
 * which badge goes beside the title.
 */

/** The heading badge of a structural section outside Global: the set itself is Global only. */
export function GlobalOnlyBadge({ label }: { label: string }): ReactNode {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-normal text-muted-foreground">
      <Lock className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** The badge for the scope, or nothing: "Applies immediately", else "Global only" when labelled. */
export function SectionBadge({
  immediate,
  globalOnlyLabel,
}: {
  /** The section's structural controls are rendered (Global, `catalog:write`). */
  immediate: boolean;
  /** Shown outside Global instead of the immediate badge. */
  globalOnlyLabel?: string | undefined;
}): ReactNode {
  if (immediate) return <ImmediateBadge />;
  return globalOnlyLabel ? <GlobalOnlyBadge label={globalOnlyLabel} /> : null;
}

/** A section title with its badge, for `EditorSection`'s `title`. */
export function sectionTitle(title: ReactNode, immediate: boolean, globalOnlyLabel?: string): ReactNode {
  return (
    <>
      {title}
      <SectionBadge immediate={immediate} globalOnlyLabel={globalOnlyLabel} />
    </>
  );
}
