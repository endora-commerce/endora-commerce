import type { ReactNode } from 'react';
import { Section } from '@endora-commerce/admin-kit/ui';

/**
 * admin-kit's `Section` as a **named region**: the plain titled block a card body is made of (the
 * product editor's pattern — one card per tab panel, plain sections inside, no nested cards), with
 * its heading naming it for assistive technology and, when given, a description under the heading.
 * `titleId` lets a control inside be labelled by the same heading (a radio group).
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
    <div role="region" aria-labelledby={titleId} className={className}>
      <Section title={<span id={titleId}>{title}</span>} action={action}>
        {description !== undefined ? (
          <p id={`${titleId}-description`} className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </Section>
    </div>
  );
}
