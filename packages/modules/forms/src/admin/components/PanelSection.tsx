import type { ReactNode } from 'react';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { EditorSection } from '@endora-commerce/admin-kit/ui';

/**
 * admin-kit's `EditorSection` with the ids this module's panels name: the titled block a card body
 * is made of (the product editor's pattern — one card per tab panel, sections inside, no nested
 * cards), named by its heading for assistive technology and described by its description when given.
 * Sibling sections divide themselves with the section's own rule, so a panel puts no `Separator`
 * between them (issue #1437, DS-03).
 *
 * `titleId` is the section's base id: the heading is `${titleId}-title` — what a control inside is
 * labelled by (a radio group) — and the description `${titleId}-description`.
 *
 * `immediate` marks a section whose controls write at once, on their own, outside the builder's
 * Save / Publish bar (the retention period, the recipients): its heading carries admin-kit's
 * `ImmediateBadge`, so the bar is not read as covering it (issue #1512, CONTENT-09; DEC-08).
 */
export interface PanelSectionProps {
  readonly titleId: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  /** The section writes at once, outside the one Save: its heading says so. */
  readonly immediate?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function PanelSection({ titleId, title, description, action, immediate = false, className, children }: PanelSectionProps): ReactNode {
  return (
    <EditorSection
      id={titleId}
      title={
        immediate ? (
          <>
            {title}{' '}
            <ImmediateBadge className="align-middle" />
          </>
        ) : (
          title
        )
      }
      {...(description !== undefined ? { description } : {})}
      {...(action !== undefined ? { action } : {})}
      {...(className !== undefined ? { className } : {})}
    >
      {children}
    </EditorSection>
  );
}
