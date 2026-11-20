import type { ReactNode } from 'react';
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
 */
export interface PanelSectionProps {
  readonly titleId: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

export function PanelSection({ titleId, title, description, action, className, children }: PanelSectionProps): ReactNode {
  return (
    <EditorSection
      id={titleId}
      title={title}
      {...(description !== undefined ? { description } : {})}
      {...(action !== undefined ? { action } : {})}
      {...(className !== undefined ? { className } : {})}
    >
      {children}
    </EditorSection>
  );
}
